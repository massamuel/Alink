import { backendLog } from './logger.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { Workspace, Policy, RefundAction, Approval } from '../shared/types.ts';
export const initialPolicy: Policy = { originalMethodOnly: false, maxRefundCents: 100000, requireApproval: false, version: 1 };
export function hardenedPolicy(version: number): Policy { return { originalMethodOnly: true, maxRefundCents: 12500, requireApproval: true, version }; }
export function newWorkspace(): Workspace {
  return { revision: 0, profile: { name: 'Jordan Example', credential: null, voices: [] },
    orders: [{ id: 'ORD-1042', product: 'Studio headphones', paidCents: 12500, refundedCents: 0, currency: 'USD', paymentMethod: 'original-card-4242', eligible: true }],
    policy: structuredClone(initialPolicy), actions: [], approvals: [], audit: [] };
}
export function log(ws: Workspace, event: string, detail: string) { ws.audit.unshift({ id: randomUUID(), time: new Date().toISOString(), event, detail }); ws.audit = ws.audit.slice(0,150); }
export function digest(action: RefundAction) {
  return createHash('sha256').update(JSON.stringify([action.id, action.orderId, action.amountCents, action.currency, action.destination, action.policyVersion, action.expiresAt, action.requiresVoice===true])).digest('hex');
}
function checkRefundResult(ws: Workspace, action: RefundAction, now = Date.now()): string | null {
  if(action.requiresVoice)return 'This retired bank request cannot execute. Create a new action request.';
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
export function checkRefund(ws: Workspace, action: RefundAction, now = Date.now()): string | null {
  const denial=checkRefundResult(ws,action,now);
  // Denials are fixed server-defined strings, never supplied action parameters.
  backendLog('security.refund_policy_checked',{status:denial?'denied':'allowed',reason:denial??'policy_passed'});
  return denial;
}
export function executeRefund(ws: Workspace, actionId: string, approvalId: string, now = Date.now()): RefundAction {
  const action = ws.actions.find(a => a.id === actionId);
  if (!action) throw new Error('Action not found.');
  const denial = checkRefund(ws, action, now); if (denial) throw new Error(denial);
  // Live mock execution always requires a passkey proof, for every action.
  const approval = ws.approvals.find(a => a.id === approvalId && a.actionId === actionId);
  if (!approval || approval.used || Date.parse(approval.expiresAt) <= now) throw new Error('A fresh, unused passkey approval is required.');
  if (approval.digest !== digest(action) || approval.policyVersion !== ws.policy.version) throw new Error('Approved details changed. Request new approval.');
  backendLog('security.refund_approval_verified',{status:'allowed'});
  approval.used = true; action.status = 'executed';
  ws.orders.find(o => o.id === action.orderId)!.refundedCents += action.amountCents;
  log(ws, 'Refund simulated', `$${(action.amountCents/100).toFixed(2)} · ${action.destination} · ${action.orderId}`);
  return action;
}
export function makeApproval(action: RefundAction): Approval {
  return { id: randomUUID(), actionId: action.id, digest: digest(action), policyVersion: action.policyVersion, expiresAt: new Date(Math.min(Date.parse(action.expiresAt),Date.now()+120000)).toISOString(), used:false };
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
