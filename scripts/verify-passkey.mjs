// Software authenticator used only by this test client. No test bypass exists in the server.
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, createHash, sign } from 'node:crypto';
const base=process.env.ALINK_TEST_ORIGIN||'http://localhost:3000';let cookie='';
async function call(path,body,method='POST',extra={}){
 const response=await fetch(base+'/api'+path,{method,headers:{Origin:base,...(cookie?{Cookie:cookie}:{}),...(Buffer.isBuffer(body)?{'Content-Type':'audio/wav'}:body?{'Content-Type':'application/json'}:{}),...extra},body:Buffer.isBuffer(body)?body:body?JSON.stringify(body):undefined});
 if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];return {status:response.status,data:await response.json()};
}
const b64=b=>Buffer.from(b).toString('base64url'),hash=b=>createHash('sha256').update(b).digest();
function head(major,value){if(value<24)return Buffer.from([(major<<5)|value]);if(value<256)return Buffer.from([(major<<5)|24,value]);const b=Buffer.alloc(3);b[0]=(major<<5)|25;b.writeUInt16BE(value,1);return b;}
function cbor(value){if(typeof value==='number')return value>=0?head(0,value):head(1,-1-value);if(typeof value==='string'){const b=Buffer.from(value);return Buffer.concat([head(3,b.length),b]);}if(Buffer.isBuffer(value))return Buffer.concat([head(2,value.length),value]);if(value instanceof Map)return Buffer.concat([head(5,value.size),...[...value].flatMap(([k,v])=>[cbor(k),cbor(v)])]);throw new Error('Unsupported test CBOR');}
await call('/state',undefined,'GET');
const {privateKey,publicKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'}),credentialId=randomBytes(32),id=b64(credentialId);
const options=(await call('/auth/register/options')).data;
const client=Buffer.from(JSON.stringify({type:'webauthn.create',challenge:options.challenge,origin:base,crossOrigin:false}));
const cose=cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
const prefix=Buffer.alloc(55);hash('localhost').copy(prefix);prefix[32]=0x45;prefix.writeUInt16BE(credentialId.length,53);
const authData=Buffer.concat([prefix,credentialId,cose]);
const attestation=cbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',authData]]));
let result=await call('/auth/register/verify',{id,rawId:id,type:'public-key',response:{clientDataJSON:b64(client),attestationObject:b64(attestation),transports:['internal']},clientExtensionResults:{},authenticatorAttachment:'platform'});
assert.equal(result.status,200,JSON.stringify(result.data));
let counter=0;
async function approve(purpose,actionId){
 const options=(await call('/auth/options',{purpose,actionId})).data;assert.ok(options.challenge);
 const client=Buffer.from(JSON.stringify({type:'webauthn.get',challenge:options.challenge,origin:base,crossOrigin:false}));
 const auth=Buffer.alloc(37);hash('localhost').copy(auth);auth[32]=0x05;auth.writeUInt32BE(++counter,33);
 const signature=sign('sha256',Buffer.concat([auth,hash(client)]),privateKey);
 const result=await call('/auth/verify',{id,rawId:id,type:'public-key',response:{clientDataJSON:b64(client),authenticatorData:b64(auth),signature:b64(signature)},clientExtensionResults:{}});
 assert.equal(result.status,200,JSON.stringify(result.data));return result.data;
}
await approve('profile');
// Generated tone tests storage/decoder transport only, not identity or speaker accuracy.
const wav=Buffer.alloc(44+3*32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=44;i<wav.length;i+=2)wav.writeInt16LE(Math.round(Math.sin(i*.1)*6000),i);
result=await call('/voices?variation=natural',wav,'POST',{'X-Recording-Consent':'yes'});assert.equal(result.status,200,JSON.stringify(result.data));const recording=result.data.profile.voices[0].id;
if(process.env.ALINK_TEST_VOICE==='1'){
 assert.equal(result.data.profile.voices[0].transcript,'the rain in spain falls mainly on the plain');
 const persisted=await call('/state',undefined,'GET');assert.equal(persisted.data.profile.voices[0].transcript,result.data.profile.voices[0].transcript);
 const checked=await call('/voices/verify',wav,'POST',{'X-Recording-Consent':'yes'});assert.equal(checked.data.status,'consistent');assert.equal(checked.data.baselineSampleId,recording);assert.equal(checked.data.phrase.expected,persisted.data.profile.voices[0].transcript);
}
const audio=await fetch(base+`/api/voices/${recording}/audio`,{headers:{Cookie:cookie}});assert.equal(audio.status,200);assert.deepEqual(Buffer.from(await audio.arrayBuffer()),wav);
result=await call('/voices/'+recording,undefined,'DELETE');assert.equal(result.status,200);assert.equal(result.data.profile.voices.length,0);
result=await call('/actions',{orderId:'ORD-1042',amountCents:5000,destination:'external-account'});assert.equal(result.status,200);
result=await call('/actions',{orderId:'ORD-1042',amountCents:5000,destination:'original-card-4242'});assert.equal(result.status,200);const actionId=result.data.id;
const proof=await approve('refund',actionId);result=await call(`/actions/${actionId}/execute`,{approvalId:proof.approvalId});assert.equal(result.status,200);assert.equal(result.data.orders[0].refundedCents,5000);
result=await call(`/actions/${actionId}/execute`,{approvalId:proof.approvalId});assert.equal(result.status,400);
console.log('Software-authenticator integration passed: WebAuthn registration/signatures, owner-scoped WAV save/playback/delete, refund approval/execution/reuse denial. Not a physical authenticator or voice-accuracy test.');
