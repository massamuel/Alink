import test from 'node:test';import assert from 'node:assert/strict';
import { compareVoice, cosine, validateWav } from '../src/server/providers.ts';
import type { VoiceSample } from '../src/shared/types.ts';
const sample=(embedding:number[],variation:VoiceSample['variation']='natural'):VoiceSample=>({id:'sample',variation,embedding,model:'test-model',createdAt:'',bytes:1});
test('unavailable model never fabricates a voice match',()=>assert.equal(compareVoice(null,[sample([1,0])]).status,'unavailable'));
test('high pitched matching sample cannot override uncertain natural reference',()=>{const result=compareVoice({embedding:[1,0],model:'test-model'},[sample([0,1]),sample([1,0],'higher')]);assert.equal(result.status,'uncertain');assert.equal(result.score,0);assert.equal(result.scores[1].score,1);});
test('natural same-speaker vector is consistent but grants no authorization token',()=>{const result=compareVoice({embedding:[1,0],model:'test-model'},[sample([1,0])]);assert.equal(result.status,'consistent');assert.equal('approvalId' in result,false);});
test('incompatible model versions require enrollment again',()=>assert.equal(compareVoice({embedding:[1,0],model:'different'},[sample([1,0])]).status,'unavailable'));
test('cosine rejects incompatible and zero vectors',()=>{assert.throws(()=>cosine([1,0],[1]));assert.throws(()=>cosine([0,0],[1,0]));});
function wav(seconds:number,amplitude=5000){const b=Buffer.alloc(44+seconds*32000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(seconds*32000,40);for(let i=44;i<b.length;i+=2)b.writeInt16LE(Math.round(Math.sin(i)*amplitude),i);return b;}
test('WAV validation accepts valid speech-level signal; rejects silence, truncation, and wrong sample rate',()=>{assert.equal(validateWav(wav(3)).duration,3);assert.throws(()=>validateWav(wav(3,0)),/quiet/);assert.throws(()=>validateWav(wav(1)),/2 and 30/);const wrong=wav(3);wrong.writeUInt32LE(44100,24);assert.throws(()=>validateWav(wrong),/16 kHz/);assert.throws(()=>validateWav(wav(3).subarray(0,50)),/Truncated/);});

test('phrase matching ignores case and punctuation but requires every word in order',async()=>{
  const {checkPhrase}=await import('../src/server/providers.ts');
  assert.equal(checkPhrase('THE RAIN IN SPAIN FALLS MAINLY ON THE PLAIN.').status,'matched');
  for(const text of ['the rain in spain','the rain in spain falls on the plain','the plain in spain falls mainly on the rain','the rain in spain falls mainly on the plane','hello the rain in spain falls mainly on the plain',''])assert.equal(checkPhrase(text).status,'mismatch');
});
test('strong speaker match cannot override wrong or unavailable transcription',async()=>{
  const {combineVoiceAndPhrase,EXPECTED_PHRASE}=await import('../src/server/providers.ts');
  const speaker=compareVoice({embedding:[1,0],model:'test-model'},[sample([1,0])]);
  assert.equal(combineVoiceAndPhrase(speaker,'the rain').status,'uncertain');
  assert.equal(combineVoiceAndPhrase(speaker,null).status,'unavailable');
  assert.equal(combineVoiceAndPhrase(speaker,EXPECTED_PHRASE).status,'consistent');
  assert.equal(combineVoiceAndPhrase({...speaker,status:'uncertain'},EXPECTED_PHRASE).status,'uncertain');
  assert.equal(combineVoiceAndPhrase({...speaker,status:'unavailable'},EXPECTED_PHRASE).status,'unavailable');
});

test('verification uses stored enrollment words rather than the default phrase',async()=>{
  const {verifyEnrollment}=await import('../src/server/providers.ts');
  const baseline={...sample([1,0]),transcript:'My custom baseline phrase'};
  const candidate={embedding:[1,0],model:'test-model'};
  const result=verifyEnrollment(candidate,'MY custom baseline phrase!',[baseline]);
  assert.equal(result.status,'consistent');assert.equal(result.baselineSampleId,baseline.id);assert.equal(result.phrase?.expected,baseline.transcript);assert.match(result.message,/Verification successful/);
  assert.equal(verifyEnrollment(candidate,'my custom phrase',[baseline]).status,'uncertain');
  assert.equal(verifyEnrollment(candidate,'the rain in spain falls mainly on the plain',[baseline]).status,'uncertain');
  assert.equal(verifyEnrollment(candidate,'My custom baseline phrase',[{...baseline,embedding:[0,1]}]).status,'uncertain');
});
test('legacy enrollment and missing transcription cannot pass stored-baseline verification',async()=>{
  const {verifyEnrollment}=await import('../src/server/providers.ts');const candidate={embedding:[1,0],model:'test-model'};
  assert.equal(verifyEnrollment(candidate,'the rain',[sample([1,0])]).status,'unavailable');
  assert.equal(verifyEnrollment(candidate,null,[{...sample([1,0]),transcript:'the rain'}]).status,'unavailable');
  assert.equal(verifyEnrollment(candidate,'the rain',[{...sample([1,0]),transcript:'   '}]).status,'unavailable');
});
test('cannot combine matching text from one baseline with matching voice from another phrase',async()=>{
  const {verifyEnrollment}=await import('../src/server/providers.ts');
  const samples=[{...sample([0,1]),id:'text-only',transcript:'my baseline phrase'},{...sample([1,0]),id:'speaker-only',transcript:'different spoken words'}];
  const result=verifyEnrollment({embedding:[1,0],model:'test-model'},'my baseline phrase',samples);
  assert.equal(result.phrase?.status,'matched');assert.equal(result.speakerStatus,'uncertain');assert.equal(result.status,'uncertain');assert.match(result.message,/Verification failure/);
});
