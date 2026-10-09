import type { Profile, Variation } from '../shared/types.ts';
export class ApiError extends Error { constructor(public status:number,message:string){super(message);} }
export function pitchVariation(pitch:unknown):Variation {
  const pitches:Record<string,Variation>={normal:'natural',high:'higher',low:'lower',natural:'natural',higher:'higher',lower:'lower'};
  if(typeof pitch!=='string'||!Object.hasOwn(pitches,pitch))throw new ApiError(400,'Pitch must be normal, high, or low.');
  return pitches[pitch];
}
export function requireUser(profile:Profile,userId:unknown){
  if(typeof userId!=='string'||!profile.userId||profile.userId!==userId)throw new ApiError(404,'User not found.');
}
export function checkEmbeddingSlot(profile:Profile,variation:Variation){
  if(profile.voices.length>=3)throw new ApiError(409,'User has reached voice embedding limit');
  if(variation==='singing')throw new ApiError(400,'Pitch must be normal, high, or low.');
  if(profile.voices.some(v=>v.variation===variation))throw new ApiError(409,'An embedding for this pitch already exists. Delete it before enrolling again.');
}
