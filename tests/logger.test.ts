import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backendLog, requestContext } from '../src/server/logger.ts';

test('logs keep request correlation and omit sensitive fields', async () => {
  const lines:string[]=[];
  const write=process.stdout.write;
  process.stdout.write=((chunk: string | Uint8Array)=>{lines.push(String(chunk));return true;}) as typeof write;
  try {
    await Promise.all(['first','second'].map(requestId=>requestContext.run({requestId},async()=>{
      await Promise.resolve();
      backendLog('voice.baseline_checked',{status:'consistent',score:0.8,transcript:'private words',embedding:[1,2],cookie:'secret',error:'sensitive error'});
    })));
  } finally { process.stdout.write=write; }
  const records=lines.map(line=>JSON.parse(line));
  assert.deepEqual(records.map(r=>r.requestId),['first','second']);
  for(const record of records){
    assert.equal(record.status,'consistent');
    assert.equal(record.score,0.8);
    for(const field of ['transcript','embedding','cookie','error'])assert.equal(field in record,false);
  }
});
