// Explicit test fixture. Never start this provider for real voice verification.
import {createServer} from 'node:http';
createServer(async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const audio=Buffer.concat(chunks);
  res.setHeader('Content-Type','application/json');
  if(req.url==='/health')res.end(JSON.stringify({ready:true,transcriptionReady:true,model:'test-only-mock'}));
  else if(req.url==='/embed')res.end(JSON.stringify({embedding:[1,...Array(191).fill(0)],model:'test-only-mock'}));
  else if(req.url==='/transcribe')res.end(JSON.stringify({text:audio.length>46&&audio.readInt16LE(44)===32000?'the rain':'the rain in spain falls mainly on the plain'}));
  else {res.statusCode=404;res.end('{}');}
}).listen(8003,'127.0.0.1',()=>console.log('TEST-ONLY mock voice provider :8003'));
