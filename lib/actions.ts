// The PayPal actions the cash-flow agent may propose. Shared by the browser (which queues a
// proposal and shows it for approval) and the server (which validates and executes it), so both
// agree on what an action is.

export type ActionType = 'remind' | 'discount' | 'send_draft';

export type RunwayAction =
  | { type: 'remind'; invoiceId: string; subject: string; note: string }
  | { type: 'discount'; invoiceId: string; percent: number; note: string }
  | { type: 'send_draft'; invoiceId: string };

export const ACTION_LABELS: Record<ActionType, string> = {
  remind: 'Send reminder',
  discount: 'Offer early-payment discount',
  send_draft: 'Send draft invoice',
};

// The most the agent may give away without a human changing the invoice themselves.
export const MAX_DISCOUNT_PERCENT = 15;

const text = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : undefined;

/** Checks an action that arrived over the network. Returns the action, or a message saying what is wrong. */
export function parseAction(input: unknown): RunwayAction | string {
  if (typeof input !== 'object' || input === null) return 'Action must be an object.';
  const { type, invoiceId, subject, note, percent } = input as Record<string, unknown>;
  if (typeof invoiceId !== 'string' || !/^INV2(-[A-Z0-9]{4}){4}$/.test(invoiceId)) return 'invoiceId is not a PayPal invoice id.';

  switch (type) {
    case 'remind': {
      const s = text(subject, 120);
      const n = text(note, 1000);
      return s && n ? { type, invoiceId, subject: s, note: n } : 'A reminder needs a subject (max 120 chars) and a note (max 1000).';
    }
    case 'discount': {
      const n = text(note, 1000);
      if (typeof percent !== 'number' || !(percent > 0 && percent <= MAX_DISCOUNT_PERCENT)) {
        return `Discount must be between 0 and ${MAX_DISCOUNT_PERCENT} percent.`;
      }
      return n ? { type, invoiceId, percent, note: n } : 'A discount needs a note telling the customer about it.';
    }
    case 'send_draft':
      return { type, invoiceId };
    default:
      return 'Unknown action type.';
  }
}
