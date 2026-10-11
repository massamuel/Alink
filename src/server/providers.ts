import { backendLog, requestContext } from './logger.ts';
import { z } from 'zod';
import type { VoiceSample, VoiceResult, Variation } from '../shared/types.ts';
const embeddingSchema = z.object({ embedding:z.array(z.number().finite()).min(16).max(4096), model:z.string().min(1) });
const voiceURL = () => process.env.VOICE_SERVICE_URL || 'http://127.0.0.1:8001';
export async function speakerStatus() {
  try { const res=await fetch(voiceURL()+'/health',{signal:AbortSignal.timeout(1500)}); const body=await res.json();return {ready:res.ok&&body.ready===true,model:typeof body.model==='string'?body.model:null}; }
  catch{return {ready:false,model:null};}
}
export async function encodeVoice(audio:Buffer):Promise<{embedding:number[];model:string}|null> {
  const started=performance.now();backendLog('voice.embedding_started',{bytes:audio.length});
  try {
    const response=await fetch(voiceURL()+'/embed',{method:'POST',headers:{'Content-Type':'audio/wav','X-Request-ID':requestContext.getStore()?.requestId??''},body:new Uint8Array(audio),signal:AbortSignal.timeout(90000)});
    if(!response.ok){backendLog('voice.embedding_failed',{status:response.status});return null;} const result=embeddingSchema.parse(await response.json());backendLog('voice.embedding_completed',{durationMs:Math.round(performance.now()-started)});return result;
  } catch{backendLog('voice.embedding_failed',{reason:'transport_or_invalid_response'});return null;}
}
export function cosine(a:number[],b:number[]):number {
  if(a.length!==b.length || !a.length)throw new Error('Incompatible voice embeddings.');
  let dot=0,x=0,y=0; for(let i=0;i<a.length;i++){dot+=a[i]*b[i];x+=a[i]**2;y+=b[i]**2;}
  if(!x||!y)throw new Error('Invalid zero-vector embedding.');return Math.max(-1,Math.min(1,dot/Math.sqrt(x*y)));
}
export function compareVoice(candidate:{embedding:number[];model:string}|null,samples:VoiceSample[],referenceVariation:Variation='natural'):VoiceResult {
  const threshold=Number(process.env.VOICE_THRESHOLD || 0.65);
  const base={score:null,scores:[],threshold,model:candidate?.model??null};
  if(!candidate)return {...base,status:'unavailable',message:'Speaker model unavailable. Configure the local voice service; use passkey verification meanwhile.'};
  const compatible=samples.filter(s=>s.embedding&&s.model===candidate.model&&s.embedding.length===candidate.embedding.length);
  // Compare the explicitly selected pitch; other styles cannot override its score.
  const natural=compatible.filter(s=>s.variation===referenceVariation);
  if(!natural.length)return {...base,status:'unavailable',message:'No compatible enrollment for the selected pitch. Authenticate and record that pitch with the model running.'};
  const scores=compatible.map(s=>({variation:s.variation,score:cosine(candidate.embedding,s.embedding!)}));
  const naturalScores=scores.filter(s=>s.variation===referenceVariation);
  const score=naturalScores.reduce((sum,s)=>sum+s.score,0)/naturalScores.length;
  return {status:score>=threshold?'consistent':'uncertain',score,scores,threshold,model:candidate.model,
    message:score>=threshold?'Voice is consistent with the selected pitch enrollment. This is not liveness or deepfake verification.':'Voice is uncertain. Illness or recording conditions may affect matching. Verify with your passkey; the threshold is unchanged.'};
}
export function validateWav(bytes:Buffer):{duration:number;rms:number} {
  if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw new Error('Upload a PCM WAV recording.');
  let format=0,channels=0,rate=0,bits=0,data:Buffer|undefined;
  for(let offset=12;offset+8<=bytes.length;) {
    const id=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8;
    if(start+size>bytes.length)throw new Error('Truncated WAV recording.');
    if(id==='fmt '&&size>=16){format=bytes.readUInt16LE(start);channels=bytes.readUInt16LE(start+2);rate=bytes.readUInt32LE(start+4);bits=bytes.readUInt16LE(start+14);}
    if(id==='data')data=bytes.subarray(start,start+size);
    offset=start+size+(size%2);
  }
  if(format!==1||channels!==1||rate!==16000||bits!==16||!data||data.length%2)throw new Error('Use mono, 16 kHz, 16-bit PCM WAV. The browser recorder converts automatically.');
  const duration=data.length/32000;
  if(duration<2||duration>30)throw new Error('Record between 2 and 30 seconds.');
  let energy=0;for(let i=0;i<data.length;i+=2)energy+=(data.readInt16LE(i)/32768)**2;
  const rms=Math.sqrt(energy/(data.length/2));if(rms<0.003)throw new Error('Recording is too quiet. Try again near the microphone.');
  return {duration,rms};
}
export async function transcribe(audio:Buffer) {
  if(!process.env.ELEVENLABS_API_KEY)throw new Error('ElevenLabs is not configured. Add ELEVENLABS_API_KEY to .env.');
  const form=new FormData();form.set('file',new Blob([new Uint8Array(audio)],{type:'audio/wav'}),'request.wav');
  form.set('model_id',process.env.ELEVENLABS_STT_MODEL || 'scribe_v2');form.set('language_code','eng');
  const res=await fetch('https://api.elevenlabs.io/v1/speech-to-text?enable_logging=false',{method:'POST',headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY},body:form,signal:AbortSignal.timeout(45000)});
  if(!res.ok)throw new Error(`ElevenLabs transcription failed (${res.status}). Check your key and account.`);
  return z.object({text:z.string()}).parse(await res.json()).text;
}
export const EXPECTED_PHRASE = 'The rain in Spain falls mainly on the plain';
function normalizedWords(text:string) { return text.toLowerCase().normalize('NFKC').replace(/[^a-z0-9\s]/g,' ').trim().split(/\s+/).filter(Boolean).join(' '); }
export function checkPhrase(transcript:string|null,expected=EXPECTED_PHRASE):import('../shared/types.ts').PhraseCheck {
  if(transcript===null)return {status:'unavailable',expected,transcript:null,message:'Local transcription unavailable. Start the updated voice service with its Vosk model installed.'};
  const matched=normalizedWords(transcript)===normalizedWords(expected);
  return {status:matched?'matched':'mismatch',expected,transcript,message:matched?'All expected words match in order.':'Phrase did not match. Say the complete displayed phrase once; check the transcript for recognition errors.'};
}
export function combineVoiceAndPhrase(speaker:VoiceResult,transcript:string|null):VoiceResult {
  const phrase=checkPhrase(transcript),speakerStatus=speaker.status;
  const status=speakerStatus==='unavailable'||phrase.status==='unavailable'?'unavailable':speakerStatus==='consistent'&&phrase.status==='matched'?'consistent':'uncertain';
  return {...speaker,speakerStatus,phrase,status,message:status==='consistent'?'Speaker and complete phrase are consistent. This is not liveness or deepfake verification.':speakerStatus==='unavailable'?speaker.message:phrase.status!=='matched'?phrase.message:speaker.message};
}
export async function transcribeLocal(audio:Buffer):Promise<string|null> {
  const started=performance.now();backendLog('voice.transcription_started',{bytes:audio.length});
  try {
    const res=await fetch(voiceURL()+'/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav','X-Request-ID':requestContext.getStore()?.requestId??''},body:new Uint8Array(audio),signal:AbortSignal.timeout(90000)});
    if(!res.ok){backendLog('voice.transcription_failed',{status:res.status});return null;}
    const text=z.object({text:z.string().max(10000)}).parse(await res.json()).text;backendLog('voice.transcription_completed',{durationMs:Math.round(performance.now()-started)});return text;
  }catch{backendLog('voice.transcription_failed',{reason:'transport_or_invalid_response'});return null;}
}

// Select one baseline phrase, then compare only recordings carrying that same text.
// Do not combine text from one sample with speaker evidence from another phrase.
function verifyEnrollmentResult(candidate:{embedding:number[];model:string}|null,transcript:string|null,samples:VoiceSample[],referenceVariation:Variation='natural'):VoiceResult {
  const baseline=samples.find(s=>s.variation===referenceVariation&&s.embedding&&s.model===candidate?.model&&s.embedding.length===candidate?.embedding.length&&s.transcript&&normalizedWords(s.transcript));
  if(!candidate)return combineVoiceAndPhrase(compareVoice(candidate,samples,referenceVariation),transcript);
  if(!baseline){
    const speaker=compareVoice(candidate,[],referenceVariation);
    return {...speaker,speakerStatus:'unavailable',phrase:{status:'unavailable',expected:'',transcript,message:'No complete stored baseline.'},message:'No compatible baseline for the selected pitch with both transcript and embedding. Verify your passkey and enroll this pitch.'};
  }
  const references=samples.filter(s=>s.transcript&&normalizedWords(s.transcript)===normalizedWords(baseline.transcript!));
  const speaker=compareVoice(candidate,references,referenceVariation),phrase=checkPhrase(transcript,baseline.transcript!),speakerStatus=speaker.status;
  const status=speakerStatus==='unavailable'||phrase.status==='unavailable'?'unavailable':speakerStatus==='consistent'&&phrase.status==='matched'?'consistent':'uncertain';
  return {...speaker,baselineSampleId:baseline.id,speakerStatus,phrase,status,message:status==='consistent'?'Verification successful. Speaker and spoken text match the stored enrollment baseline.':status==='unavailable'?'Verification unavailable. '+(phrase.status==='unavailable'?phrase.message:speaker.message):'Verification failure. '+(phrase.status==='mismatch'?'The spoken words differ from the stored baseline.':speaker.message)};
}

export function verifyEnrollment(candidate:{embedding:number[];model:string}|null,transcript:string|null,samples:VoiceSample[],referenceVariation:Variation='natural'):VoiceResult {
  const result=verifyEnrollmentResult(candidate,transcript,samples,referenceVariation);
  backendLog('voice.baseline_checked',{variation:referenceVariation,sampleCount:samples.length,baselineFound:!!result.baselineSampleId,speakerStatus:result.speakerStatus,phraseStatus:result.phrase?.status,status:result.status,score:result.score,threshold:result.threshold});
  return result;
}
