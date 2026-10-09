import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Upload, Play } from 'lucide-react';
export async function toWav(blob:Blob):Promise<Blob> {
  const context=new AudioContext();
  try {
    const decoded=await context.decodeAudioData(await blob.arrayBuffer());
    if(decoded.duration<2||decoded.duration>30)throw new Error('Use a recording between 2 and 30 seconds.');
    const offline=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000);
    const source=offline.createBufferSource();source.buffer=decoded;source.connect(offline.destination);source.start();
    const rendered=await offline.startRendering(),samples=rendered.getChannelData(0),buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
    const text=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
    text(0,'RIFF');view.setUint32(4,36+samples.length*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples.length*2,true);
    for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.max(-1,Math.min(1,samples[i]))*(samples[i]<0?32768:32767),true);
    return new Blob([buffer],{type:'audio/wav'});
  }finally{await context.close();}
}
export default function Recorder({onClip,disabled=false}:{onClip:(blob:Blob)=>void;disabled?:boolean}) {
  const [recording,setRecording]=useState(false),[busy,setBusy]=useState(false),[seconds,setSeconds]=useState(0),[error,setError]=useState(''),[clipURL,setClipURL]=useState('');
  const recorder=useRef<MediaRecorder|null>(null),stream=useRef<MediaStream|null>(null),timer=useRef<ReturnType<typeof setInterval>|null>(null),mounted=useRef(true);
  const clean=()=>{stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(timer.current)clearInterval(timer.current);timer.current=null;};
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(recorder.current?.state==='recording')recorder.current.stop();clean();};},[]);
  useEffect(()=>()=>{if(clipURL)URL.revokeObjectURL(clipURL);},[clipURL]);
  async function accept(blob:Blob){setBusy(true);setError('');try{const wav=await toWav(blob);if(mounted.current){setClipURL(URL.createObjectURL(wav));onClip(wav);}}catch(e){if(mounted.current)setError(e instanceof Error?e.message:'Audio could not be decoded.');}finally{if(mounted.current)setBusy(false);}}
  async function start(){
    setError('');setBusy(true);
    try{
      if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Microphone recording is unsupported here. Upload an audio file instead.');
      stream.current=await navigator.mediaDevices.getUserMedia({audio:true});if(!mounted.current){clean();return;}
      const chunks:BlobPart[]=[];const instance=new MediaRecorder(stream.current);recorder.current=instance;
      instance.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      instance.onstop=()=>{clean();if(mounted.current){setRecording(false);void accept(new Blob(chunks,{type:instance.mimeType}));}};
      instance.start();setSeconds(0);setRecording(true);
      let elapsed=0;timer.current=setInterval(()=>{elapsed++;setSeconds(elapsed);if(elapsed>=25&&instance.state==='recording')instance.stop();},1000);
    }catch(e){clean();setError(e instanceof Error?e.message:'Microphone unavailable.');}finally{if(mounted.current)setBusy(false);}
  }
  return <div className="recorder"><div className={`record-stage ${recording?'recording':''}`}><div className="wave" aria-hidden="true">{Array.from({length:35},(_,i)=><i key={i} style={{height:`${8+Math.abs(Math.sin(i*1.7))*26}px`,animationDelay:`${i*0.035}s`}}/>)}</div><span>{recording?`Listening · ${seconds}s`:busy?'Preparing audio…':clipURL?'Recording ready':'2–25 seconds · quiet room'}</span></div>
    <div className="recorder-actions"><button className={recording?'danger':'primary'} disabled={disabled||busy} onClick={()=>recording?recorder.current?.stop():void start()}>{recording?<Square size={15}/>:<Mic size={15}/>} {recording?'Stop recording':'Record voice'}</button><label className={`upload-button ${disabled||busy||recording?'disabled':''}`}><Upload size={15}/> Upload audio<input type="file" accept="audio/*" disabled={disabled||busy||recording} onChange={e=>{const file=e.target.files?.[0];if(file){if(file.size>10*1024*1024)setError('Choose an audio file smaller than 10 MB.');else void accept(file);}e.target.value='';}}/></label></div>
    {clipURL&&<div className="clip-preview"><Play size={14}/><audio controls src={clipURL}/></div>}{error&&<p className="error" role="alert">{error}</p>}
  </div>;
}
