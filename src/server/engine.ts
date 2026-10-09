import { createHash, randomUUID } from 'node:crypto';
import type { Workspace, Policy, RefundAction, Approval, ReplayCase, DoctorReport } from '../shared/types.ts';
export const initialPolicy: Policy = { originalMethodOnly: false, maxRefundCents: 100000, requireApproval: false, version: 1 };
export function hardenedPolicy(version: number): Policy { return { originalMethodOnly: true, maxRefundCents: 12500, requireApproval: true, version }; }
export function newWorkspace(): Workspace {
  return { revision: 0, profile: { name: 'Jordan Example', credential: null, voices: [] },
    orders: [{ id: 'ORD-1042', product: 'Studio headphones', paidCents: 12500, refundedCents: 0, currency: 'USD', paymentMethod: 'original-card-4242', eligible: true }],
    policy: structuredClone(initialPolicy), previousPolicy: null, actions: [], approvals: [], audit: [], doctor: null };
}
export function log(ws: Workspace, event: string, detail: string) { ws.audit.unshift({ id: randomUUID(), time: new Date().toISOString(), event, detail }); ws.audit = ws.audit.slice(0,150); }
export function digest(action: RefundAction) {
  return createHash('sha256').update(JSON.stringify([action.id, action.orderId, action.amountCents, action.currency, action.destination, action.policyVersion, action.expiresAt])).digest('hex');
}
export function checkRefund(ws: Workspace, action: RefundAction, now = Date.now()): string | null {
  const order = ws.orders.find(o => o.id === action.orderId);
  if (!order?.eligible) return 'Order is not eligible for a refund.';
  if (action.status !== 'pending') return 'This action has already executed.';
  if (Date.parse(action.expiresAt) <= now) return 'The request expired. Propose a new action.';
  if (action.policyVersion !== ws.policy.version) return 'Policy changed. Propose a new action.';
  if (action.currency !== order.currency) return 'Currency does not match the order.';
  if (!Number.isSafeInteger(action.amountCents) || action.amountCents <= 0) return 'Amount must be positive integer cents.';
  if (action.amountCents > order.paidCents - order.refundedCents) return 'Amount exceeds the remaining paid balance.';
  if (action.amountCents > ws.policy.maxRefundCents) return 'Amount exceeds the agent’s refund limit.';
  if (ws.policy.originalMethodOnly && action.destination !== order.paymentMethod) return 'Refunds must return to the original payment method.';
  return null;
}
export function executeRefund(ws: Workspace, actionId: string, approvalId: string, now = Date.now()): RefundAction {
  const action = ws.actions.find(a => a.id === actionId);
  if (!action) throw new Error('Action not found.');
  const denial = checkRefund(ws, action, now); if (denial) throw new Error(denial);
  // Live mock execution always requires a passkey proof, even before policy repair.
  const approval = ws.approvals.find(a => a.id === approvalId && a.actionId === actionId);
  if (!approval || approval.used || Date.parse(approval.expiresAt) <= now) throw new Error('A fresh, unused passkey approval is required.');
  if (approval.digest !== digest(action) || approval.policyVersion !== ws.policy.version) throw new Error('Approved details changed. Request new approval.');
  approval.used = true; action.status = 'executed';
  ws.orders.find(o => o.id === action.orderId)!.refundedCents += action.amountCents;
  log(ws, 'Refund simulated', `$${(action.amountCents/100).toFixed(2)} · ${action.destination} · ${action.orderId}`);
  return action;
}
export function makeApproval(action: RefundAction): Approval {
  return { id: randomUUID(), actionId: action.id, digest: digest(action), policyVersion: action.policyVersion, expiresAt: new Date(Math.min(Date.parse(action.expiresAt),Date.now()+120000)).toISOString(), used:false };
}
export function replay(ws: Workspace, proposed: Policy): ReplayCase[] {
  const scenarios = [
    { name: 'Voice-only request without verified approval', attack:true, cents:5000, destination:'original-card-4242', approved:false, changed:false },
    { name: 'Refund redirected to an external account', attack:true, cents:5000, destination:'external-account', approved:true, changed:false },
    { name: 'Amount changed after approval', attack:true, cents:6000, destination:'original-card-4242', approved:true, changed:true },
    { name: 'Refund exceeds remaining order balance', attack:true, cents:20000, destination:'original-card-4242', approved:true, changed:false },
    { name: 'Changed voice + passkey-approved refund', attack:false, cents:5000, destination:'original-card-4242', approved:true, changed:false }
  ];
  function decision(p: Policy, test: typeof scenarios[number]) {
    if (test.cents > 12500) return { allowed:false, reason:'Remaining paid balance enforced.' };
    if (p.originalMethodOnly && test.destination !== 'original-card-4242') return { allowed:false, reason:'Original payment method enforced.' };
    if (p.requireApproval && !test.approved) return { allowed:false, reason:'Passkey approval required.' };
    if (p.requireApproval && test.changed) return { allowed:false, reason:'Approval does not match current details.' };
    return { allowed:true, reason: 'Scenario meets policy.' };
  }
  return scenarios.map(s => { const after = decision(proposed,s); return { name:s.name, attack:s.attack, before:decision(ws.policy,s).allowed, after:after.allowed, passed:after.allowed !== s.attack, reason:after.reason }; });
}
export function doctorReport(ws: Workspace, codeScan: DoctorReport['codeScan']): DoctorReport {
  const proposed = hardenedPolicy(ws.policy.version+1), results = replay(ws,proposed);
  return { generatedAt:new Date().toISOString(), policyVersion:ws.policy.version, proposed, codeScan,
    findings:[{ id:'destination', title:'Arbitrary refund destinations', description:'The configured agent may redirect a refund away from the original payment method.', active:!ws.policy.originalMethodOnly },
      { id:'approval', title:'Voice-only authorization in sample policy', description:'Speaker similarity cannot establish approval. The live mock executor always requires a verified passkey.', active:!ws.policy.requireApproval },
      { id:'limit', title:'Overly broad refund limit', description:'Reduce the configured ceiling to the sample order’s $125 balance.', active:ws.policy.maxRefundCents>12500 }],
    replay:results, verified:results.every(r=>r.passed) };
}
export function applyRepair(ws:Workspace) {
  if (!ws.doctor?.verified || ws.doctor.policyVersion !== ws.policy.version) throw new Error('Run a fresh scan before applying a repair.');
  ws.previousPolicy = structuredClone(ws.policy); ws.policy = ws.doctor.proposed; ws.approvals = []; ws.doctor = null;
  log(ws,'Policy repair approved','Original payment method, $125 ceiling, and verified approval required.');
}
export function rollback(ws:Workspace) {
  if (!ws.previousPolicy) throw new Error('No previous policy available.');
  ws.policy = { ...ws.previousPolicy, version:ws.policy.version+1 }; ws.previousPolicy=null; ws.approvals=[]; ws.doctor=null;
  log(ws,'Policy rolled back','Previous settings restored; old approvals invalidated.');
}

// Narrow speech-to-tool planner for the single hackathon order. Not a general LLM agent.
export function draftRefund(text:string):{orderId:string;amountCents:number;destination:string;source:'reviewed-transcript'} {
  const words:Record<string,number>={ten:10,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,'one hundred':100};
  const normalized=text.toLowerCase().trim();
  if(!/\brefund\b/.test(normalized))throw new Error('Say a refund request with one amount and an explicit destination.');
  const amounts=[...normalized.matchAll(/(?:\$\s*(\d+(?:\.\d{1,2})?)\b|\b(\d+(?:\.\d{1,2})?|one hundred|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(?:dollars|usd)\b)/g)];
  if(amounts.length!==1)throw new Error('The transcript must contain exactly one dollar amount. Review it or use the form.');
  const spoken=amounts[0][1]??amounts[0][2], dollars=words[spoken]??Number(spoken);
  const original=/\boriginal\s+(?:card|payment method)\b/.test(normalized),external=/\bexternal\s+(?:account|bank account)\b/.test(normalized);
  if(original===external)throw new Error('Specify either original card or external account. Ambiguous requests require manual review.');
  if(!Number.isFinite(dollars)||dollars<=0)throw new Error('Invalid refund amount.');
  return {orderId:'ORD-1042',amountCents:Math.round(dollars*100),destination:original?'original-card-4242':'external-account',source:'reviewed-transcript'};
}
