// Repair example. Real enforcement and approval consumption live in engine.ts.
declare function executeApprovedRefund(actionId: string, approvalId: string): void;
export function safeRefund(actionId: string, approvalId: string) {
  executeApprovedRefund(actionId, approvalId);
}
