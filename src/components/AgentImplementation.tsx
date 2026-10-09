import { useState } from 'react';
import Recorder from './Recorder.tsx';
import { sendAudio } from '../api.ts';
import type { AppState, Variation, AgentCommandResult, AgentApproveResult } from '../shared/types.ts';

// The Guild agent proposes a file action; the server runs it only after voice verification.
export default function AgentImplementation({state,onRefresh}:{state:AppState;onRefresh:()=>Promise<unknown>}){
  const [request,setRequest]=useState<Blob|null>(null),[proof,setProof]=useState<Blob|null>(null);
  const [consent,setConsent]=useState(false),[pitch,setPitch]=useState<Variation>('natural');
  const [command,setCommand]=useState<AgentCommandResult|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [result,setResult]=useState<AgentApproveResult|null>(null);
  const baseline=state.profile.voices.find(v=>v.variation===pitch&&v.model===state.integrations.speaker.model&&v.transcript?.trim());
  const pending=!!command?.needsVoice&&!result;
  function reset(){setCommand(null);setProof(null);setResult(null);setError('');}
  async function prepare(){
    if(!request||busy)return;setBusy(true);reset();
    try{setCommand(await sendAudio<AgentCommandResult>('/agent/command',request));await onRefresh();}
    catch(e){setError(e instanceof Error?e.message:'The agent could not process the request.');}finally{setBusy(false);}
  }
  async function verify(){
    if(!proof||!pending||busy)return;setBusy(true);setError('');
    try{setResult(await sendAudio<AgentApproveResult>('/agent/approve?variation='+pitch,proof));await onRefresh();}
    catch(e){setError(e instanceof Error?e.message:'Verification failed.');}finally{setBusy(false);}
  }
  const action=command?.action,label=action&&action.type!=='none'?`${action.type} ${action.filename}`:'';
  return <>
    <div className="info-banner"><div><b>Voice-gated file agent</b><p>A Guild.ai agent interprets your request. The file is only created or deleted in the local sandbox folder after your voice is verified.</p></div>{!state.integrations.guild.configured&&<span className="badge warn">GUILD NOT CONFIGURED</span>}</div>
    <div className="two-columns">
      <section className="card"><div className="card-heading"><div><h2>1. Record a file request</h2><p>Example: “Create a file called notes.txt that says buy milk” or “Delete notes.txt”.</p></div></div>
        <label className="checkbox"><input type="checkbox" checked={consent} disabled={busy} onChange={e=>{setConsent(e.target.checked);reset();}}/>I consent to local transcription and voice verification, and to sending the request text to the Guild agent. Recordings are not retained.</label>
        <Recorder onClip={clip=>{setRequest(clip);reset();}} disabled={busy||!consent}/>
        <button className="primary full" disabled={busy||!request||!consent} onClick={()=>void prepare()}>{busy&&!command?'Asking the agent…':'Send request to agent'}</button>
        {command&&<div className="transcript"><small>YOU SAID</small><p>{command.transcript}</p><small>AGENT</small><p>{command.agentMessage}</p></div>}
      </section>
      <section className="card"><div className="card-heading"><div><h2>2. Verify your voice</h2><p>{pending?'Your agent is waiting for voice verification.':command&&!command.needsVoice?'No file action to approve.':'Record and send a request to continue.'}</p></div></div>
        {pending&&<><div className="phrase" role="status"><small>VOICE VERIFICATION REQUIRED</small><p>{state.profile.name}, please verify your voice to {label}.</p></div>
          <label className="field-label" htmlFor="agent-pitch">Verification baseline</label><select id="agent-pitch" value={pitch} disabled={busy} onChange={e=>{setPitch(e.target.value as Variation);setProof(null);setError('');}}><option value="natural">Normal pitch</option><option value="higher">High pitch</option><option value="lower">Low pitch</option></select>
          <div className="phrase"><small>VOICE VERIFICATION</small><p>Please record baseline.</p>{!baseline&&<span>Verify your passkey on Voice profile and enroll this pitch before continuing.</span>}</div>
          <Recorder onClip={clip=>{setProof(clip);setError('');}} disabled={busy||!consent||!baseline}/>
          <button className="primary full" disabled={busy||!proof||!consent||!baseline} onClick={()=>void verify()}>{busy?'Verifying your voice…':'Verify and run'}</button>
        </>}
        {(result||error)&&<div className={`result-box ${result?.approved&&!error?'good':'warn'}`} role="status"><b>{error?'Request failed':result!.approved?'Verification successful':result!.voice.status==='unavailable'?'Verification unavailable — nothing changed':'Verification failure — nothing changed'}</b><p>{error||result!.voice.message}</p>{result?.voice.phrase&&<p>Phrase check: {result.voice.phrase.status}. Speaker check: {result.voice.speakerStatus}.</p>}{result&&<><p><b>{result.outcome}</b></p><p>{result.agentMessage}</p></>}</div>}
      </section>
    </div>
  </>;
}
