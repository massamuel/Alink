import { AsyncLocalStorage } from 'node:async_hooks';
export const requestContext = new AsyncLocalStorage<{ requestId:string }>();
// Only fixed field names are accepted. Never pass request bodies or error messages.
const fields = new Set(['method','route','status','durationMs','reason','stage','bytes','duration','rms','variation','sampleCount','referenceCount','baselineFound','speakerStatus','phraseStatus','score','threshold','purpose','authenticated','storage']);
export function backendLog(event:string, metadata:Record<string,unknown> = {}) {
  const safe = Object.fromEntries(Object.entries(metadata).filter(([key,value]) => fields.has(key) && (value === null || ['string','number','boolean'].includes(typeof value))));
  process.stdout.write(JSON.stringify({time:new Date().toISOString(),event,requestId:requestContext.getStore()?.requestId,...safe})+'\n');
}
