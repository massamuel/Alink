import { useEffect, useRef, useState } from 'react';
import { ConversationProvider, useConversation, useConversationClientTool } from '@elevenlabs/react';
import { AudioLines, Check, X } from 'lucide-react';
import { api, sendAudio } from '../api.ts';
import type { AppState, VoiceResult, RefundAction } from '../shared/types.ts';
import Recorder from './Recorder.tsx';
type Props={state:AppState;onState:(s:AppState)=>void;authenticate:(purpose:'refund',id:string)=>Promise<{verified:boolean;approvalId?:string}>};
export default function BankAgent(props:Props){return <ConversationProvider><BankConversation {...props}/></ConversationProvider>;}
function BankConversation({state,onState,authenticate}:Props){
  const [configured,setConfigured]=useState(false),[consent,setConsent]=useState(false),[localConsent,setLocalConsent]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[amount,setAmount]=useState('50.00');
  const [action,setAction]=useState<RefundAction|null>(null),[clip,setClip]=useState<Blob|null>(null),[result,setResult]=useState<VoiceResult|null>(null),[approved,setApproved]=useState<RefundAction|null>(null);
  const pending=useRef(false),alive=useRef(true),finish=useRef<((s:string)=>void)|null>(null),messages=useRef<string[]>([]);
  const [conversationText,setConversationText]=useState<string[]>([]);
  function settle(value:string){finish.current?.(value);finish.current=null;}
  const conversation=useConversation({micMuted:!!action,volume:action?0:1,onError:message=>{setError(String(message));settle('Conversation failed; no approval.');},onDisconnect:()=>settle('Conversation ended. No additional transaction approval granted.'),onMessage:message=>{messages.current=[...messages.current,`${message.source}: ${message.message}`].slice(-8);setConversationText(messages.current);}});
  useEffect(()=>{alive.current=true;api<{configured:boolean}>('/bank/config',undefined,'GET').then(v=>{if(alive.current)setConfigured(v.configured);}).catch(()=>{});return()=>{alive.current=false;settle('User left the bank demo.');};},[]);
  async function propose(cents:number){
    if(pending.current)throw new Error('Finish or cancel the pending transaction first.');
    pending.current=true;
    try{const response=await api<{id:string;state:AppState}>('/bank/actions',{amountCents:cents});if(!alive.current)throw new Error('Bank page closed.');onState(response.state);setAction(response.state.actions.find(a=>a.id===response.id)!);setClip(null);setResult(null);setApproved(null);return response.id;}
    catch(e){pending.current=false;throw e;}
  }
  useConversationClientTool('request_transaction',async(parameters)=>{
    try{
      const usd=parameters.amount_usd;
      if(typeof usd!=='number'||!Number.isFinite(usd)||usd<=0||Math.abs(usd*100-Math.round(usd*100))>0.000001)return 'Invalid amount. Ask for a positive USD amount with at most two decimal places.';
      const id=await propose(Math.round(usd*100));
      return await new Promise<string>(resolve=>{finish.current=resolve;setTimeout(()=>{if(finish.current===resolve){settle('Verification timed out. This transaction is not approved.');if(alive.current)setError('Transaction timed out. Cancel and start again.');}},300000);});
    }catch(e){return e instanceof Error?e.message:'Transaction request failed.';}
  });
  async function run(task:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await task();}catch(e){setError(e instanceof Error?e.message:'Request failed.');}finally{if(alive.current)setBusy(false);}}
  function cancel(){settle('User canceled. Transaction not approved.');pending.current=false;setAction(null);setResult(null);setClip(null);}
  const baseline=state.profile.voices.find(v=>v.variation==='natural'&&v.model===state.integrations.speaker.model&&v.transcript?.trim());
  const money=(c:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(c/100);
  return <section className="card bank-agent"><div className="card-heading"><div><h2>Alink U.S. bank demo</h2><p>Selected client: {state.profile.name} · simulated original-card refund</p></div><span className="badge">NO REAL MONEY</span></div>
    <p>The agent asks for your amount. Speaker matching, the full phrase, and a passkey must all succeed before approval. Current remaining balance: {money(state.orders[0].paidCents-state.orders[0].refundedCents)}.</p>
    <label className="checkbox"><input type="checkbox" checked={consent} disabled={conversation.status!=='disconnected'} onChange={e=>setConsent(e.target.checked)}/>I consent to sending conversation audio to ElevenLabs. The separate verification phrase is processed locally.</label>
    <div className="recorder-actions"><button className="primary" disabled={busy||!consent||!configured||!state.authenticated||conversation.status!=='disconnected'||!!action} onClick={()=>void run(async()=>{const session=await api<{signedUrl:string;clientName:string}>('/bank/agent/session',{consent:true});conversation.startSession({signedUrl:session.signedUrl,connectionType:'websocket',dynamicVariables:{client_name:session.clientName}});})}><AudioLines size={16}/>Start bank voice agent</button><button className="secondary" disabled={conversation.status==='disconnected'} onClick={()=>{conversation.endSession();settle('Conversation stopped.');}}>End conversation</button><span className="badge">{conversation.status}</span></div>
    {!configured&&<p className="footnote">Add ELEVENLABS_AGENT_ID and ELEVENLABS_API_KEY to .env and configure the agent using docs/BANK_AGENT.md. The manual demo below uses the same backend checks.</p>}
    {!state.authenticated&&<p className="footnote">Register or verify your passkey using the controls above before starting the voice agent.</p>}
    {!!conversationText.length&&<div className="transcript"><small>CONVERSATION · NOT AN APPROVAL</small>{conversationText.map((m,i)=><p key={i}>{m}</p>)}</div>}
    {!action&&<div className="form-row"><div><label className="field-label" htmlFor="bank-amount">Manual demo amount (USD)</label><input id="bank-amount" type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></div><button className="secondary" disabled={busy} onClick={()=>void run(async()=>{const usd=Number(amount);if(!Number.isFinite(usd)||usd<=0||Math.abs(usd*100-Math.round(usd*100))>0.000001)throw new Error('Use a positive amount with at most two decimal places.');await propose(Math.round(usd*100));})}>Test transaction workflow</button></div>}
    {action&&<div className="spaced"><div className="info-banner"><AudioLines size={20}/><div><b>{busy?'Please wait. We’re verifying your transaction.':'Please wait while we verify your voice.'}</b><p>{money(action.amountCents)} · {action.orderId} · {action.destination} · {state.profile.name}</p></div></div>
      <div className="phrase"><small>SAY THIS COMPLETE PHRASE ONCE</small><p>“{baseline?.transcript??'Verify your passkey and enroll a natural baseline first'}”</p><span>The agent audio is muted during this step so only your microphone is recorded.</span></div>
      <label className="checkbox"><input type="checkbox" checked={localConsent} disabled={busy} onChange={e=>setLocalConsent(e.target.checked)}/>I consent to processing this verification clip locally against my enrolled voice. The clip and transcript are not retained.</label>
      <Recorder disabled={busy||!localConsent} onClip={b=>{setClip(b);setResult(null);}}/>
      <button className="primary" disabled={busy||!clip||!localConsent} onClick={()=>void run(async()=>{setResult(await sendAudio<VoiceResult>(`/bank/actions/${action.id}/verify`,clip!));})}>Verify speaker & phrase</button>
      {result&&<div className={`result-box ${result.status==='consistent'?'good':'warn'}`}><b>{result.status==='consistent'?'Verification successful':result.status==='unavailable'?'Verification unavailable':'Verification failure'}</b><p>{result.message}</p><p>Heard: {result.phrase?.transcript??'Unavailable'}</p><small>Speaker: {result.speakerStatus} · phrase: {result.phrase?.status}</small></div>}
      <div className="recorder-actions spaced"><button className="primary" disabled={busy||result?.status!=='consistent'||!state.profile.hasPasskey} onClick={()=>void run(async()=>{
        const proof=await authenticate('refund',action.id);if(!proof.approvalId)throw new Error('Exact transaction approval missing.');
        const updated=await api<AppState>(`/actions/${action.id}/execute`,{approvalId:proof.approvalId});
        const executed=updated.actions.find(a=>a.id===action.id);if(executed?.status!=='executed')throw new Error('Transaction execution was not confirmed.');
        onState(updated);setApproved(executed);settle(`The simulated transaction ${executed.id} for ${money(executed.amountCents)} is approved. All required checks passed.`);pending.current=false;setAction(null);setResult(null);setClip(null);
      })}><Check size={16}/>Approve {money(action.amountCents)} with passkey</button><button className="secondary" disabled={busy} onClick={cancel}>Cancel request</button></div>
    </div>}
    {error&&<p className="error" role="alert">{error}</p>}
    {approved&&<div className="bank-modal-backdrop"><section className="card bank-modal" role="dialog" aria-modal="true" onKeyDown={e=>{if(e.key==='Escape')setApproved(null);}} aria-labelledby="bank-approved-title"><button autoFocus className="icon-button" aria-label="Close approval popup" onClick={()=>setApproved(null)}><X size={20}/></button><Check size={38}/><h2 id="bank-approved-title">The transaction is approved</h2><p>{money(approved.amountCents)} · {approved.destination}</p><p>Client: {state.profile.name}</p><small>Reference: {approved.id}</small><p>Simulated transaction. No money moved.</p><button className="primary" onClick={()=>setApproved(null)}>Done</button></section></div>}
  </section>;
}
