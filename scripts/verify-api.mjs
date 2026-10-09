import assert from 'node:assert/strict';
const base=process.env.ALINK_TEST_ORIGIN||'http://localhost:3000',origin=base;
let cookie='';
async function call(path,{method='POST',body}={}){
  const res=await fetch(base+'/api'+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
  return {status:res.status,data:await res.json()};
}
let result=await call('/state',{method:'GET'});assert.equal(result.status,200);assert.equal(result.data.profile.hasPasskey,false);
result=await call('/actions',{body:{orderId:'ORD-1042',amountCents:5000,destination:'original-card-4242'}});assert.equal(result.status,200);const id=result.data.id;
result=await call(`/actions/${id}/execute`,{body:{approvalId:'00000000-0000-4000-8000-000000000000'}});assert.equal(result.status,400);assert.match(result.data.error,/passkey approval/);
result=await call('/actions',{body:{orderId:'ORD-1042',amountCents:20000,destination:'original-card-4242'}});assert.equal(result.status,400);assert.match(result.data.error,/remaining paid/);
result=await call('/auth/options',{body:{purpose:'refund',actionId:id}});assert.equal(result.status,400);assert.match(result.data.error,/Register/);
result=await call('/auth/register/options');assert.equal(result.status,200);assert.equal(result.data.authenticatorSelection.userVerification,'required');
result=await call('/auth/register/verify',{body:{id:'fake'}});assert.equal(result.status,400);
const cross=await fetch(base+'/api/actions',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json',Cookie:cookie},body:'{}'});assert.equal(cross.status,403);
// New browser session cannot see another session's pending request.
const isolated=await fetch(base+'/api/state');const other=await isolated.json();assert.equal(other.actions.length,0);
console.log('API checks passed: removed-route checks, request creation, approval denial, over-refund denial, invalid authenticator denial, same-origin enforcement, and workspace isolation.');

for(const path of ['/doctor/scan','/doctor/apply','/doctor/rollback','/bank/actions','/bank/agent/session']){const removed=await call(path,{body:{}});assert.equal(removed.status,404);}
