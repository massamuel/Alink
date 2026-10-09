import { useState } from 'react';
import Recorder from './Recorder.tsx';
import { sendAudio } from '../api.ts';
import type { AppState, Variation, VoiceResult } from '../shared/types.ts';

export default function AgentImplementation({state,onRefresh}:{state:AppState;onRefresh:()=>Promise<unknown>}){
  const [request,setRequest]=useState<Blob|null>(null),[proof,setProof]=useState<Blob|null>(null);
  const [consent,setConsent]=useState(false),[pitch,setPitch]=useState<Variation>('natural');
  const [requestId,setRequestId]=useState(''),[agentText,setAgentText]=useState('');
  const [draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [result,setResult]=useState<VoiceResult|null>(null);
  const baseline=state.profile.voices.find(v=>v.variation===pitch&&v.model===state.integrations.speaker.model&&v.transcript?.trim());
  function reset(){setRequestId('');setAgentText('');setDraft('');setProof(null);setResult(null);setError('');}
  async function prepare(){
    if(!request||busy)return;setBusy(true);reset();
    try{const response=await sendAudio<{text:string;requestId:string}>('/agent/file-request',request);setDraft(response.text);setRequestId(response.requestId);}
    catch(e){setError(e instanceof Error?e.message:'Request transcription failed.');}finally{setBusy(false);}
  }
  async function verify(){
    if(!proof||!draft||!state.profile.userId||busy)return;setBusy(true);setResult(null);setAgentText('');setError('');
    try{const checked=await sendAudio<{result:VoiceResult;agent?:{text:string}}>('/agent/file-request/'+requestId+'/verify?user_id='+state.profile.userId+'&variation='+pitch,proof);setResult(checked.result);setAgentText(checked.agent?.text??'');await onRefresh();}
    catch(e){setError(e instanceof Error?e.message:'Verification failed.');}finally{setBusy(false);}
  }
  const success=result?.status==='consistent';
  return <>
    <div className="info-banner"><div><b>Mock file creation agent</b><p>Record your message, then verify your voice before the agent displays the simulated file. No file is written to your computer.</p></div></div>
    <div className="two-columns">
      <section className="card"><div className="card-heading"><div><h2>1. Record a file request</h2><p>Example: “Create a file with my meeting notes for tomorrow.”</p></div></div>
        <label className="checkbox"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>{setConsent(e.target.checked);reset();}}/>I consent to local transcription and voice verification, and to sending my request text to Guild after successful verification. Recordings stay local and will not be retained.</label>
        <Recorder onClip={clip=>{setRequest(clip);reset();}} disabled={busy||!consent}/>
        <button className="primary full" disabled={busy||!request||!consent} onClick={()=>void prepare()}>{busy?'Processing…':'Send request to agent'}</button>
      </section>
      <section className="card"><div className="card-heading"><div><h2>2. Verify your voice</h2><p>{draft?'Your agent is waiting for voice verification.':'Record and send a request to continue.'}</p></div></div>
        {draft&&<><div className="phrase" role="status"><small>VOICE VERIFICATION REQUIRED</small><p>{state.profile.name}, please verify your voice to create this file.</p></div>
          <label className="field-label" htmlFor="agent-pitch">Verification baseline</label><select id="agent-pitch" value={pitch} disabled={busy} onChange={e=>{setPitch(e.target.value as Variation);setProof(null);setResult(null);setAgentText('');setError('');}}><option value="natural">Normal pitch</option><option value="higher">High pitch</option><option value="lower">Low pitch</option></select>
          <div className="phrase"><small>VOICE VERIFICATION</small><p>Please record baseline.</p>{!baseline&&<span>Verify your passkey on Voice profile and enroll this pitch before continuing.</span>}</div>
          <Recorder onClip={clip=>{setProof(clip);setResult(null);setError('');}} disabled={busy||!consent||!baseline}/>
          <button className="primary full" disabled={busy||!proof||!consent||!baseline} onClick={()=>void verify()}>{busy?'Verifying your voice…':'Verify and create mock file'}</button>
        </>}
        {(result||error)&&<div className={`result-box ${success&&!error?'good':'warn'}`} role="status"><b>{success&&!error?'Verification successful — mock file created':result?.status==='unavailable'?'Verification unavailable — file not created':'Verification failure — file not created'}</b><p>{error||result?.message}</p>{result?.phrase&&<p>Phrase check: {result.phrase.status}. Speaker check: {result.speakerStatus}.</p>}</div>}
      </section>
    </div>
    {success&&!error&&<section className="card spaced"><div className="card-heading"><div><h2>agent-message.txt</h2><p>Simulated file · verified request text</p></div></div><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{draft}</pre><div className="transcript"><small>GUILD AGENT RESPONSE</small><p style={{whiteSpace:'pre-wrap'}}>{agentText}</p></div></section>}
  </>;
}
