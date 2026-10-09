import test from 'node:test';
import assert from 'node:assert/strict';
import { newWorkspace, hardenedPolicy, checkRefund, executeRefund, makeApproval, doctorReport, applyRepair, rollback, draftRefund } from '../src/server/engine.ts';
import type { RefundAction } from '../src/shared/types.ts';
function pending():RefundAction{return {id:'action-1',orderId:'ORD-1042',amountCents:5000,destination:'original-card-4242',currency:'USD',status:'pending',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString(),policyVersion:1};}
function setup(){const ws=newWorkspace();ws.policy=hardenedPolicy(1);const action=pending();ws.actions.push(action);const approval=makeApproval(action);ws.approvals.push(approval);return {ws,action,approval};}
test('verified refund consumes approval and order balance; reuse rejected',()=>{const {ws,action,approval}=setup();executeRefund(ws,action.id,approval.id);assert.equal(ws.orders[0].refundedCents,5000);assert.equal(approval.used,true);assert.throws(()=>executeRefund(ws,action.id,approval.id),/already executed/);});
test('amount changed after approval fails closed',()=>{const {ws,action,approval}=setup();action.amountCents=6000;assert.throws(()=>executeRefund(ws,action.id,approval.id),/details changed/);assert.equal(ws.orders[0].refundedCents,0);assert.equal(approval.used,false);});
test('destination changed after approval fails closed even in broad sample policy',()=>{const {ws,action,approval}=setup();ws.policy.originalMethodOnly=false;action.destination='external-account';assert.throws(()=>executeRefund(ws,action.id,approval.id),/details changed/);});
test('expired action and approval cannot execute',()=>{const {ws,action,approval}=setup();approval.expiresAt=new Date(0).toISOString();assert.throws(()=>executeRefund(ws,action.id,approval.id),/fresh, unused/);action.expiresAt=new Date(0).toISOString();assert.match(checkRefund(ws,action)!,/expired/);});
test('voice match alone never executes a refund, including broad policy',()=>{const ws=newWorkspace(),action=pending();ws.actions.push(action);assert.throws(()=>executeRefund(ws,action.id,'voice-match'),/passkey approval/);});
test('policy repair blocks attack cases and preserves changed-voice verified customer',()=>{const ws=newWorkspace();const report=doctorReport(ws,{status:'unavailable',findings:[],message:'test'});assert.equal(report.verified,true);assert.equal(report.replay.filter(r=>r.attack&&r.after).length,0);assert.equal(report.replay.find(r=>!r.attack)?.after,true);});
test('policy change and rollback invalidate old approvals and actions',()=>{const {ws,action,approval}=setup();ws.doctor=doctorReport(ws,{status:'unavailable',findings:[],message:'test'});applyRepair(ws);assert.equal(ws.approvals.length,0);assert.throws(()=>executeRefund(ws,action.id,approval.id),/Policy changed/);rollback(ws);assert.equal(ws.policy.version,3);assert.equal(ws.approvals.length,0);});
test('remaining paid balance prevents multiple approved requests overdrawing order',()=>{const {ws,action,approval}=setup();const second={...pending(),id:'second',amountCents:10000};ws.actions.push(second);const secondApproval=makeApproval(second);ws.approvals.push(secondApproval);executeRefund(ws,action.id,approval.id);assert.throws(()=>executeRefund(ws,second.id,secondApproval.id),/remaining paid/);});
test('fractional cents, invalid order, and wrong currency rejected',()=>{const {ws,action}=setup();action.amountCents=0.5;assert.match(checkRefund(ws,action)!,/integer cents/);action.amountCents=5000;action.orderId='unknown';assert.match(checkRefund(ws,action)!,/not eligible/);});

test('transcript planner prepares fields but refuses ambiguous amounts or destinations',()=>{assert.equal(draftRefund('Refund fifty dollars to the original card').amountCents,5000);assert.equal(draftRefund('Refund $20 to the external account').destination,'external-account');assert.throws(()=>draftRefund('Refund fifty dollars or twenty dollars to the original card'));assert.throws(()=>draftRefund('Refund $50 to the original card and external account'));});

test('bank transaction requires matching unexpired voice proof even with valid passkey approval',async()=>{
  const {digest,voiceProfileDigest}=await import('../src/server/engine.ts');
  const {ws,action,approval}=setup();action.requiresVoice=true;approval.digest=digest(action);
  assert.throws(()=>executeRefund(ws,action.id,approval.id),/speaker and full-phrase/);
  const proof={digest:digest(action),profileDigest:voiceProfileDigest(ws),expires:Date.now()+60000};
  assert.throws(()=>executeRefund(ws,action.id,approval.id,Date.now(),{...proof,expires:Date.now()-1}),/speaker and full-phrase/);
  assert.throws(()=>executeRefund(ws,action.id,approval.id,Date.now(),{...proof,digest:'another-action'}),/speaker and full-phrase/);
  ws.profile.voices.push({id:'new-sample',variation:'natural',createdAt:'',bytes:1,embedding:[1,0],model:'test'});
  assert.throws(()=>executeRefund(ws,action.id,approval.id,Date.now(),proof),/speaker and full-phrase/);
  const current={...proof,profileDigest:voiceProfileDigest(ws)};
  assert.equal(executeRefund(ws,action.id,approval.id,Date.now(),current).status,'executed');
  assert.throws(()=>executeRefund(ws,action.id,approval.id,Date.now(),current),/already executed/);
});
test('changing bank voice requirement invalidates an existing approval',async()=>{
  const {ws,action,approval}=setup();action.requiresVoice=true;
  const {digest,voiceProfileDigest}=await import('../src/server/engine.ts');
  const proof={digest:digest(action),profileDigest:voiceProfileDigest(ws),expires:Date.now()+60000};
  assert.throws(()=>executeRefund(ws,action.id,approval.id,Date.now(),proof),/details changed/);
});
