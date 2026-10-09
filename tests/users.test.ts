import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, checkEmbeddingSlot, pitchVariation, requireUser } from '../src/server/users.ts';
import { verifyEnrollment } from '../src/server/providers.ts';
import type { Profile, VoiceSample } from '../src/shared/types.ts';
const sample=(variation:VoiceSample['variation'],embedding=[1,0],transcript='the rain in spain'):VoiceSample=>({id:variation,variation,embedding,transcript,model:'test',createdAt:'',bytes:100});
const profile=(voices:VoiceSample[]=[]):Profile=>({userId:'owned-user',name:'Jordan Example',credential:null,voices});
test('three saved samples reject any fourth with exact error and conflict status',()=>{
  assert.throws(()=>checkEmbeddingSlot(profile([sample('natural'),sample('higher'),sample('lower')]),'natural'),e=>e instanceof ApiError&&e.status===409&&e.message==='User has reached voice embedding limit');
});
test('one slot per pitch, with deletion allowing replacement',()=>{
  assert.throws(()=>checkEmbeddingSlot(profile([sample('higher')]),'higher'),/already exists/);
  checkEmbeddingSlot(profile([sample('higher')]),'lower');
  checkEmbeddingSlot(profile(),'higher');
});
test('legacy samples count toward the limit and singing is not accepted',()=>{
  assert.throws(()=>checkEmbeddingSlot(profile([sample('singing'),sample('natural'),sample('natural')]),'lower'),/limit/);
  assert.throws(()=>pitchVariation('singing'),/Pitch must/);
  assert.equal(pitchVariation('normal'),'natural');assert.equal(pitchVariation('high'),'higher');assert.equal(pitchVariation('low'),'lower');
  assert.throws(()=>pitchVariation('constructor'),/Pitch must/);
});
test('a user ID cannot select another session profile',()=>{
  requireUser(profile(),'owned-user');assert.throws(()=>requireUser(profile(),'another-user'),e=>e instanceof ApiError&&e.status===404);
  assert.throws(()=>requireUser({...profile(),userId:undefined},'owned-user'),/User not found/);
});
test('selected pitch must match both its own embedding and its stored words',()=>{
  const voices=[sample('natural',[0,1],'normal baseline'),sample('higher',[1,0],'high baseline')];
  const candidate={embedding:[1,0],model:'test'};
  assert.equal(verifyEnrollment(candidate,'high baseline',voices,'higher').status,'consistent');
  assert.equal(verifyEnrollment(candidate,'normal baseline',voices,'higher').status,'uncertain');
  assert.equal(verifyEnrollment(candidate,'normal baseline',voices).status,'uncertain');
  assert.equal(verifyEnrollment(candidate,'high baseline',voices,'lower').status,'unavailable');
});
