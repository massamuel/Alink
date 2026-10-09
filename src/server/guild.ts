import { z } from 'zod';
// Thin client for the Guild.ai public API. The agent only proposes actions; Alink enforces voice approval.
const BASE='https://api.guild.ai/v1';
function config() {
  const {GUILD_API_KEY:key,GUILD_WORKSPACE:workspace,GUILD_AGENT_ID:agent}=process.env;
  if(!key||!workspace||!agent)throw new Error('Guild is not configured. Set GUILD_API_KEY, GUILD_WORKSPACE and GUILD_AGENT_ID in .env.');
  // The key string from Guild settings ("<id>:<secret>") is accepted as-is as a Bearer token.
  return {auth:`Bearer ${key}`,workspace,agent};
}
export const guildConfigured=()=>!!(process.env.GUILD_API_KEY&&process.env.GUILD_WORKSPACE&&process.env.GUILD_AGENT_ID);
async function call(path:string,init:{method?:string;body?:unknown}={}) {
  const res=await fetch(BASE+path,{method:init.method??'GET',headers:{Authorization:config().auth,...(init.body?{'Content-Type':'application/json'}:{})},body:init.body?JSON.stringify(init.body):undefined,signal:AbortSignal.timeout(20000)});
  if(!res.ok){const body=await res.json().catch(()=>null) as {message?:string}|null;throw new Error(`Guild request failed (${res.status})${body?.message?': '+body.message:''}. Check your Guild key scopes, workspace and agent id.`);}
  return res.json();
}
export async function startSession(prompt:string):Promise<string> {
  const {workspace,agent}=config();
  const session=await call(`/workspaces/${encodeURIComponent(workspace)}/sessions`,{method:'POST',body:{session_type:'chat',agent_id:agent,initial_prompt:prompt}});
  return z.object({id:z.string()}).parse(session).id;
}
export async function followUp(sessionId:string,text:string) {
  await call(`/sessions/${encodeURIComponent(sessionId)}/events`,{method:'POST',body:{content:text,mode:'text'}});
}
const eventsSchema=z.object({items:z.array(z.object({id:z.string(),type:z.string(),content:z.unknown()}))});
// Events are written when a turn completes; poll oldest-first past the cursor until the agent's text reply appears.
// (The API defaults to newest-first with limit 20, which could skip the reply when advancing the cursor.)
export async function waitReply(sessionId:string,afterId?:string,timeoutMs=60000):Promise<{text:string;eventId:string}> {
  const deadline=Date.now()+timeoutMs;let cursor=afterId;
  while(Date.now()<deadline) {
    const query=`?sort_by=id&limit=1000${cursor?`&from_id=${encodeURIComponent(cursor)}`:''}`;
    const {items}=eventsSchema.parse(await call(`/sessions/${encodeURIComponent(sessionId)}/events${query}`));
    const ordered=[...items].sort((a,b)=>a.id<b.id?-1:1);
    for(const event of ordered) {
      const text=(event.content as {text?:unknown}|null)?.text;
      if(event.type==='runtime_done'&&typeof text==='string'&&text.trim())return {text,eventId:event.id};
    }
    if(ordered.length)cursor=ordered[ordered.length-1].id;
    await new Promise(r=>setTimeout(r,1000));
  }
  throw new Error('The Guild agent did not reply in time.');
}
const actionSchema=z.object({action:z.enum(['create','delete','none']),filename:z.string().nullable().optional(),content:z.string().nullable().optional(),message:z.string()});
export type AgentAction=z.infer<typeof actionSchema>;
export function parseAction(text:string):AgentAction {
  const start=text.indexOf('{'),end=text.lastIndexOf('}');
  if(start>=0&&end>start){try{return actionSchema.parse(JSON.parse(text.slice(start,end+1)));}catch{/* fall through */}}
  return {action:'none',message:text.trim()};
}
