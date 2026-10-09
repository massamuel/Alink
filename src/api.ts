export async function api<T>(path:string,body?:unknown,method='POST'):Promise<T> {
  const response=await fetch('/api'+path,{method,headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed.');return data as T;
}
export async function sendAudio<T>(path:string,blob:Blob,elevenlabs=false):Promise<T> {
  const response=await fetch('/api'+path,{method:'POST',headers:{'Content-Type':'audio/wav','X-Recording-Consent':'yes',...(elevenlabs?{'X-ElevenLabs-Consent':'yes'}:{})},body:blob});
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Audio upload failed.');return data as T;
}
