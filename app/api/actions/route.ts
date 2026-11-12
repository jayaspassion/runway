import { parseAction } from '@/lib/actions';
import { amountOf, discountInvoice, getInvoice, PayPalApiError, remindInvoice, sendInvoice } from '@/lib/paypal';

// Executes one approved action against PayPal. The agent never calls this: it can only queue a
// proposal in the browser, and this runs when a person clicks Approve on it.
//
// Each action is checked against the invoice's live status first, so a proposal that has gone
// stale (already paid, already sent) fails with a clear message instead of a PayPal error.

const OPEN = new Set(['SENT', 'UNPAID', 'PAYMENT_PENDING', 'PARTIALLY_PAID']);

const fail = (status: number, message: string) => Response.json({ ok: false, message }, { status });

export async function POST(request: Request) {
  const action = parseAction(await request.json().catch(() => null));
  if (typeof action === 'string') return fail(400, action);

  try {
    const invoice = await getInvoice(action.invoiceId);
    const number = invoice.detail.invoice_number;

    switch (action.type) {
      case 'remind':
        if (!OPEN.has(invoice.status)) return fail(409, `Invoice ${number} is no longer open, so no reminder was sent.`);
        await remindInvoice(action.invoiceId, action.subject, action.note);
        return Response.json({ ok: true, message: `Reminder sent for ${number}.` });

      case 'discount': {
        if (!OPEN.has(invoice.status)) return fail(409, `Invoice ${number} is no longer open, so no discount was applied.`);
        if (invoice.status === 'PARTIALLY_PAID') return fail(409, `Invoice ${number} is partly paid; PayPal does not allow changing its amount.`);
        const updated = await discountInvoice(action.invoiceId, action.percent, action.note);
        const due = amountOf(updated.due_amount).toLocaleString('en-US', { style: 'currency', currency: updated.detail.currency_code });
        return Response.json({ ok: true, message: `${action.percent}% discount applied to ${number}. Now due: ${due}.` });
      }

      case 'send_draft':
        if (invoice.status !== 'DRAFT') return fail(409, `Invoice ${number} is not a draft any more.`);
        await sendInvoice(action.invoiceId);
        return Response.json({ ok: true, message: `Invoice ${number} sent.` });
    }
  } catch (error) {
    if (error instanceof PayPalApiError) return fail(502, `PayPal refused the request (${error.status}).`);
    throw error;
  }
}
