import 'dotenv/config';
import express from 'express';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';
import { ApiError, pitchVariation, requireUser, checkEmbeddingSlot } from './src/server/users.ts';
import { runFileAgent } from './src/server/guild.ts';
import { Store } from './src/server/store.ts';
import { checkRefund, executeRefund, makeApproval, digest, log, draftRefund } from './src/server/engine.ts';
import { speakerStatus, encodeVoice, verifyEnrollment, transcribeLocal, validateWav, transcribe } from './src/server/providers.ts';
import type { AppState, RefundAction } from './src/shared/types.ts';
const port=Number(process.env.PORT || 3000), origin=process.env.APP_ORIGIN || `http://localhost:${port}`, rpID=new URL(origin).hostname;
if(!['localhost','127.0.0.1'].includes(rpID))throw new Error('This prototype only supports a localhost origin. Production identity provisioning is not implemented.');
const store=new Store();await store.init();
const app=express();app.disable('x-powered-by');
app.use((req,res,next)=>{
  if(req.headers.host!==new URL(origin).host){res.status(400).json({error:`Open ${origin}; host is not allowed.`});return;}
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  if(req.path.startsWith('/api')&&req.method!=='GET'&&req.headers.origin!==origin){res.status(403).json({error:'A same-origin browser request is required.'});return;}
  next();
});
app.use(express.json({limit:'256kb'}));
const keys=new WeakMap<express.Request,string>();
const attempts=new Map<string,{count:number;start:number}>();
const authenticated=new Map<string,number>();
interface Challenge { challenge:string;expires:number;purpose:string;digest?:string;version?:number }
const challenges=new Map<string,Challenge>();
app.use('/api',(req,res,next)=>{
  let token=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('alink_session='))?.slice(14);
  if(!token||!/^[a-f0-9]{64}$/.test(token)){token=randomBytes(32).toString('hex');res.cookie('alink_session',token,{httpOnly:true,sameSite:'strict',maxAge:7*24*3600000,path:'/'});}
  const key=createHash('sha256').update(token).digest('hex');keys.set(req,key);
  const record=attempts.get(key),now=Date.now();
  if(!record||now-record.start>60000)attempts.set(key,{count:1,start:now});
  else if(++record.count>120){res.status(429).json({error:'Too many requests. Wait a minute.'});return;}
  next();
});
const owner=(req:express.Request)=>keys.get(req)!;
function requireVerified(req:express.Request){if((authenticated.get(owner(req))??0)<Date.now())throw new Error('Verify your registered passkey before changing enrollment or viewing recordings.');}
async function state(key:string):Promise<AppState> {
  const ws=await store.get(key),speaker=await speakerStatus();
  const {profile}=ws;
  return {revision:ws.revision,orders:ws.orders,policy:ws.policy,actions:ws.actions.filter(a=>!a.requiresVoice),audit:ws.audit,profile:{userId:profile.userId,name:profile.name,hasPasskey:!!profile.credential,voices:profile.voices.map(({embedding:_embedding,transcript,...v})=>({...v,transcript:(authenticated.get(key)??0)>Date.now()?transcript:undefined}))},
    authenticated:(authenticated.get(key)??0)>Date.now(),integrations:{mongodb:{mode:store.mode,connected:true},elevenlabs:{configured:!!process.env.ELEVENLABS_API_KEY},speaker}};
}
app.post('/api/users',async(req,res)=>{
  z.object({name:z.literal('Jordan Example').optional()}).parse(req.body??{});
  const key=owner(req);let created=false;
  const user=await store.update(key,ws=>{created=!ws.profile.userId;if(created){ws.profile.userId=randomUUID();log(ws,'Demo user registered','Persistent user identity assigned to the existing profile.');}return {user_id:ws.profile.userId!,name:ws.profile.name};});
  res.status(created?201:200).json(user);
});
app.get('/api/state' ,async(req,res)=>{res.json(await state(owner(req)));});
app.post('/api/auth/register/options',async(req,res)=>{
  const key=owner(req),ws=await store.get(key);if(ws.profile.credential)throw new Error('A passkey already exists. Use Verify passkey.');
  const options=await generateRegistrationOptions({rpName:'Alink local demo',rpID,userID:new Uint8Array(Buffer.from(key,'hex')),userName:ws.profile.name,attestationType:'none',authenticatorSelection:{residentKey:'preferred',userVerification:'required'}});
  challenges.set(key,{challenge:options.challenge,expires:Date.now()+120000,purpose:'register'});res.json(options);
});
app.post('/api/auth/register/verify',async(req,res)=>{
  const key=owner(req),challenge=challenges.get(key);challenges.delete(key);
  if(!challenge||challenge.purpose!=='register'||challenge.expires<Date.now())throw new Error('Registration challenge missing or expired.');
  const result=await verifyRegistrationResponse({response:req.body as RegistrationResponseJSON,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true});
  if(!result.verified||!result.registrationInfo)throw new Error('Passkey registration failed.');
  const credential=result.registrationInfo.credential;
  await store.update(key,ws=>{if(ws.profile.credential)throw new Error('A passkey already exists.');ws.profile.credential={id:credential.id,publicKey:Buffer.from(credential.publicKey).toString('base64url'),counter:credential.counter};log(ws,'Passkey registered','Local demo profile provisioned with authenticator user verification.');});
  authenticated.set(key,Date.now()+300000);res.json({verified:true});
});
const authPurpose=z.object({purpose:z.enum(['profile','refund']),actionId:z.string().uuid().optional()});
app.post('/api/auth/options',async(req,res)=>{
  const key=owner(req),body=authPurpose.parse(req.body),ws=await store.get(key),credential=ws.profile.credential;
  if(!credential)throw new Error('Register a passkey first.');
  let bound:Challenge={challenge:'',expires:Date.now()+120000,purpose:body.purpose,version:ws.policy.version};
  if(body.purpose==='refund'){
    const action=ws.actions.find(a=>a.id===body.actionId);if(!action)throw new Error('Action not found.');
    const denied=checkRefund(ws,action);if(denied)throw new Error(denied);
    bound={...bound,purpose:'refund:'+action.id,digest:digest(action)};
  }
  const options=await generateAuthenticationOptions({rpID,userVerification:'required',allowCredentials:[{id:credential.id}]});
  bound.challenge=options.challenge;challenges.set(key,bound);res.json(options);
});
app.post('/api/auth/verify',async(req,res)=>{
  const key=owner(req),challenge=challenges.get(key);challenges.delete(key);
  if(!challenge||challenge.expires<Date.now()||challenge.purpose==='register')throw new Error('Authentication challenge missing or expired.');
  const ws=await store.get(key),credential=ws.profile.credential;
  if(!credential||req.body.id!==credential.id)throw new Error('Credential not registered to this profile.');
  const result=await verifyAuthenticationResponse({response:req.body as AuthenticationResponseJSON,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,
    credential:{id:credential.id,publicKey:new Uint8Array(Buffer.from(credential.publicKey,'base64url')),counter:credential.counter}});
  if(!result.verified)throw new Error('Passkey verification failed.');
  let proofId:string|undefined;
  await store.update(key,current=>{
    if(!current.profile.credential||current.profile.credential.counter!==credential.counter)throw new Error('Credential changed; retry verification.');
    current.profile.credential.counter=result.authenticationInfo.newCounter;
    if(challenge.purpose.startsWith('refund:')){
      const action=current.actions.find(a=>a.id===challenge.purpose.slice(7));if(!action||digest(action)!==challenge.digest||current.policy.version!==challenge.version)throw new Error('Transaction details changed during approval.');
      const denied=checkRefund(current,action);if(denied)throw new Error(denied);
      const approval=makeApproval(action);proofId=approval.id;current.approvals.push(approval);current.approvals=current.approvals.slice(-100);
      log(current,'Exact action approved',`${action.id} · $${(action.amountCents/100).toFixed(2)} · ${action.destination}`);
    }else log(current,'Passkey verified',`Verified purpose: ${challenge.purpose}`);
  });
  if(challenge.purpose==='profile')authenticated.set(key,Date.now()+300000);
  res.json({verified:true,approvalId:proofId});
});
const raw=express.raw({type:'audio/wav',limit:'2mb'});
function audio(req:express.Request){if(!Buffer.isBuffer(req.body))throw new Error('Send audio/wav bytes.');validateWav(req.body);return req.body as Buffer;}
app.post(['/api/voices','/api/users/:user_id/embeddings'],raw,async(req,res)=>{
  requireVerified(req);if(req.headers['x-recording-consent']!=='yes')throw new Error('Recording consent required.');
  const variation=pitchVariation(req.query.pitch??req.query.variation??'normal'),key=owner(req),bytes=audio(req);
  const existing=await store.get(key);if(req.params.user_id)requireUser(existing.profile,req.params.user_id);checkEmbeddingSlot(existing.profile,variation);
  const [embedding,transcript]=await Promise.all([encodeVoice(bytes),transcribeLocal(bytes)]);
  if(!embedding)throw new Error('Enrollment not saved: speaker embedding unavailable. Start the local voice service and retry.');
  if(!transcript?.trim())throw new Error('Enrollment not saved: no baseline text recognized. Check local transcription and record the full phrase clearly.');
  const id=randomUUID();await store.saveAudio(key,id,bytes);
  try{await store.update(key,ws=>{if(req.params.user_id)requireUser(ws.profile,req.params.user_id);checkEmbeddingSlot(ws.profile,variation);ws.profile.voices.push({id,variation,createdAt:new Date().toISOString(),bytes:bytes.length,transcript,embedding:embedding.embedding,model:embedding.model});log(ws,'Voice enrolled',`${variation} sample saved; ${embedding?'speaker embedding generated':'speaker model unavailable'}.`);});}
  catch(error){await store.removeAudio(key,id);throw error;}
  res.json(await state(key));
});
app.get('/api/voices/:id/audio',async(req,res)=>{requireVerified(req);const key=owner(req),id=z.string().uuid().parse(req.params.id);const ws=await store.get(key);if(!ws.profile.voices.some(v=>v.id===id)){res.status(404).json({error:'Recording not found.'});return;}const bytes=await store.audio(key,id);if(!bytes){res.sendStatus(404);return;}res.type('audio/wav').send(bytes);});
app.delete('/api/voices/:id',async(req,res)=>{requireVerified(req);const key=owner(req),id=z.string().uuid().parse(req.params.id);await store.update(key,ws=>{ws.profile.voices=ws.profile.voices.filter(v=>v.id!==id);log(ws,'Voice sample deleted','Recording and derived embedding removed.');});await store.removeAudio(key,id);res.json(await state(key));});
app.post(['/api/voices/verify','/api/users/:user_id/embeddings/verify'],raw,async(req,res)=>{
  if(req.headers['x-recording-consent']!=='yes')throw new Error('Consent to process this recording required.');
  const key=owner(req),bytes=audio(req),ws=await store.get(key);
  if(req.params.user_id)requireUser(ws.profile,req.params.user_id);
  const variation=pitchVariation(req.query.pitch??req.query.variation??'normal');
  const [embedding,transcript]=await Promise.all([encodeVoice(bytes),transcribeLocal(bytes)]);
  const result=verifyEnrollment(embedding,transcript,ws.profile.voices,variation);
  await store.update(key,w=>log(w,'Voice consistency checked',`${result.status}; verification audio was not retained. Voice alone grants no approval.`));res.json({...result,user_id:ws.profile.userId,name:ws.profile.name,verification:result.status==='consistent'?'Verification successful':result.status==='uncertain'?'Verification failure':'Verification unavailable'});
});
const fileRequests=new Map<string,{id:string;text:string;expires:number}>();
app.post('/api/agent/file-request',raw,async(req,res)=>{
  if(req.headers['x-recording-consent']!=='yes')throw new Error('Recording consent required.');
  const text=await transcribeLocal(audio(req));
  if(!text?.trim())throw new Error('Request transcription unavailable or no speech recognized. Start the local voice service and record your message again.');
  await store.update(owner(req),ws=>log(ws,'Mock file request recorded','Request transcribed locally; waiting for voice verification. Audio was not retained.'));
  const requestId=randomUUID();fileRequests.set(owner(req),{id:requestId,text,expires:Date.now()+300000});
  res.json({text,requestId});
});
app.post('/api/agent/file-request/:id/verify',raw,async(req,res)=>{
  if(req.headers['x-recording-consent']!=='yes')throw new Error('Recording consent required.');
  const key=owner(req),pending=fileRequests.get(key),ws=await store.get(key);
  if(!pending||pending.id!==req.params.id||pending.expires<Date.now())throw new Error('File request expired or missing. Record your request again.');
  requireUser(ws.profile,req.query.user_id);
  const variation=pitchVariation(req.query.variation??'normal'),bytes=audio(req);
  fileRequests.delete(key);
  const [embedding,transcript]=await Promise.all([encodeVoice(bytes),transcribeLocal(bytes)]);
  const result=verifyEnrollment(embedding,transcript,ws.profile.voices,variation);
  await store.update(key,w=>log(w,'Agent voice verification',`${result.status}; voice and phrase checked locally. Verification audio not retained.`));
  if(result.status!=='consistent'){res.json({result});return;}
  const agent=await runFileAgent(ws.profile.name,pending.text);
  await store.update(key,w=>log(w,'Guild mock file completed',`Guild session ${agent.sessionId}; no filesystem write performed.`));
  res.json({result,agent,file:{name:'agent-message.txt',text:pending.text}});
});
app.post('/api/transcribe',raw,async(req,res)=>{
  if(req.headers['x-elevenlabs-consent']!=='yes')throw new Error('Explicit consent to send this clip to ElevenLabs is required.');
  const text=await transcribe(audio(req));await store.update(owner(req),ws=>log(ws,'ElevenLabs transcription','User explicitly sent a request clip; transcript returned for review.'));res.json({text});
});
app.post('/api/agent/draft',async(req,res)=>{const text=z.string().min(1).max(2000).parse(req.body.text);const draft=draftRefund(text);await store.update(owner(req),ws=>log(ws,'Voice request drafted','Narrow transcript planner prepared fields for human review; no action executed.'));res.json(draft);});
const actionInput=z.object({orderId:z.string(),amountCents:z.number().int().positive().max(1000000),destination:z.string().min(1).max(100)});
app.post('/api/actions',async(req,res)=>{
  const key=owner(req),body=actionInput.parse(req.body);let id='';
  await store.update(key,ws=>{if(ws.actions.filter(a=>a.status==='pending'&&Date.parse(a.expiresAt)>Date.now()).length>=20)throw new Error('Too many pending requests.');
    const action:RefundAction={...body,id:randomUUID(),currency:'USD',status:'pending',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),policyVersion:ws.policy.version};
    const denied=checkRefund(ws,action);if(denied)throw new Error(denied);ws.actions.unshift(action);ws.actions=ws.actions.slice(0,100);id=action.id;log(ws,'Refund proposed',`$${(body.amountCents/100).toFixed(2)} · ${body.destination} · awaiting exact-action passkey approval.`);
  });res.json({id,state:await state(key)});
});
app.post('/api/actions/:id/execute',async(req,res)=>{
  const key=owner(req),id=z.string().uuid().parse(req.params.id),approvalId=z.string().uuid().parse(req.body.approvalId);
  try{await store.update(key,ws=>executeRefund(ws,id,approvalId));}
  catch(error){await store.update(key,ws=>log(ws,'Execution blocked',error instanceof Error?error.message:'Request denied.'));throw error;}
  res.json(await state(key));
});
app.use('/api',(_req,res)=>{res.status(404).json({error:'API endpoint not found.'});});
const server=createServer(app);
const vite=process.argv.includes('--dev')?await(await import('vite')).createServer({server:{middlewareMode:true,ws:{server}},appType:'spa'}):null;
if(vite)app.use(vite.middlewares);else app.use(express.static(resolve('dist'),{dotfiles:'deny'}));
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  const message=error instanceof z.ZodError?'Invalid request data.':error instanceof Error?error.message:'Request failed.';
  res.status(error instanceof ApiError?error.status:400).json({error:message});
});
server.listen(port,'127.0.0.1',()=>console.log(`Alink: ${origin} · storage=${store.mode} · local prototype, simulated refunds`));
const cleanup=setInterval(()=>{const now=Date.now();for(const [key,v]of fileRequests)if(v.expires<now)fileRequests.delete(key);for(const [key,v]of challenges)if(v.expires<now)challenges.delete(key);for(const [key,v]of authenticated)if(v<now)authenticated.delete(key);for(const [key,v]of attempts)if(now-v.start>60000)attempts.delete(key);},60000);cleanup.unref();
async function stop(){clearInterval(cleanup);await vite?.close();server.close(async()=>{await store.close();process.exit(0);});}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
