// Deliberately unsafe fixture. Not imported or executed by Alink.
declare const bank: { refund: (amount: number, destination: string) => void };
export function unsafeRefund(voiceMatch: boolean, amount: number, destination: string) {
  if (voiceMatch) {
    bank.refund(amount, destination);
  }
}
