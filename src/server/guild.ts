import { z } from 'zod';
const sessionSchema=z.object({id:z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)});
export async function runFileAgent(name:string,text:string){
  const key=process.env.GUILD_API_KEY,workspace=process.env.GUILD_WORKSPACE,agent=process.env.GUILD_AGENT_ID;
  if(!key||!workspace||!agent)throw new Error('Guild configuration missing. Set GUILD_API_KEY, GUILD_WORKSPACE, and GUILD_AGENT_ID.');
  z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i).parse(agent);
  async function request(path:string,body?:unknown){
    const response=await fetch('https://api.guild.ai/v1'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Guild request failed (HTTP '+response.status+'). Check account permissions and agent configuration.');
    return response.json();
  }
  const session=sessionSchema.parse(await request('/workspaces/'+encodeURIComponent(workspace)+'/sessions',{session_type:'chat',agent_id:agent,initial_prompt:JSON.stringify({user_name:name,request_text:text,verification_status:'verified'})}));
  const deadline=Date.now()+90000;
  while(Date.now()<deadline){
    const events=await request('/sessions/'+session.id+'/events?limit=100&sort_by=-id');
    const reply=events.items?.find((e:{type:string;content?:{text?:unknown}})=>e.type==='runtime_done'&&typeof e.content?.text==='string'&&e.content.text.trim());
    if(reply)return {sessionId:session.id,text:reply.content.text as string};
    const failed=events.items?.some((e:{type:string})=>e.type==='runtime_error');
    if(failed)throw new Error('Guild agent execution failed. Check its session in Guild.');
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw new Error('Guild agent response timed out. Check its session in Guild before retrying.');
}
