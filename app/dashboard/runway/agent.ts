// The cash-flow agent: a custom agent that sits beside AG Studio's five built-in ones. The lead
// agent delegates to it for anything about getting paid; it reads the forecast and proposes PayPal
// actions. It cannot execute them: a proposal goes into a queue (./store.ts) that a person
// approves from the Action queue widget, and only that click reaches PayPal.

import {
  directLlmRunner,
  type AgAiHarnessBuilderContext,
  type AgAiHarnessConfig,
  type AgAiPromptStarter,
  type AgLlmAdapter,
  type AgStudioApi,
} from 'ag-studio';
import { ACTION_LABELS, MAX_DISCOUNT_PERCENT, type RunwayAction } from '@/lib/actions';
import { runwayStore } from './store';

export const CASHFLOW_AGENT_ID = 'cashflow';

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// --- What the agent knows -------------------------------------------------------------

// The open invoices and each customer's habits, as text. There are only a handful, so putting them
// in the prompt saves the agent several query round-trips per request.
function briefing(): string {
  const { data, proposals } = runwayStore.getState();
  if (!data) return 'No PayPal data is loaded.';
  const customers = new Map(data.customers.map((c) => [c.id, c]));
  const nameOf = (id: string) => customers.get(id)?.company ?? customers.get(id)?.name ?? id;
  const invoiceById = new Map(data.invoices.map((i) => [i.id, i]));

  const open = [...data.forecast]
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate))
    .map((f) => {
      const c = customers.get(f.customerId);
      const habit = c?.avgDaysLate == null ? 'no payment history' : `usually pays ${Math.abs(c.avgDaysLate)} days ${c.avgDaysLate < 0 ? 'early' : 'late'} (${c.paidInvoices} paid invoices)`;
      const status = invoiceById.get(f.invoiceId)?.status ?? 'Unpaid';
      return `- ${f.number} | ${nameOf(f.customerId)} | ${usd(f.amount)} outstanding | ${status} | due ${f.dueDate} | expected ${f.expectedDate} | ${f.risk} | ${habit}`;
    });
  const drafts = data.invoices
    .filter((i) => i.status === 'Draft')
    .map((i) => `- ${i.number} | ${nameOf(i.customerId)} | ${usd(i.total)} | Draft, not sent`);
  const queued = proposals
    .filter((p) => p.status === 'pending')
    .map((p) => `- ${ACTION_LABELS[p.action.type]} for ${p.invoiceNumber}`);

  return [
    `Today is ${data.asOf.slice(0, 10)}.`,
    `Open invoices, soonest expected payment first:\n${open.join('\n') || '- none'}`,
    `Draft invoices:\n${drafts.join('\n') || '- none'}`,
    `Already waiting for approval (do not propose these again):\n${queued.join('\n') || '- none'}`,
  ].join('\n\n');
}

const INSTRUCTIONS = `You are the cash-flow agent for a freelance studio that invoices its clients through PayPal.
Your job is to get the studio paid sooner, by proposing PayPal actions for the owner to approve.

You can propose three kinds of action with propose_action:
- remind: PayPal emails the client a reminder. Free and low-risk. Good for anything overdue, and as a nudge before the due date for clients who habitually pay late.
- discount: applies an early-payment discount of at most ${MAX_DISCOUNT_PERCENT}% to the invoice. It costs real money, so use it sparingly: for large invoices that are at risk or from chronically late payers, never for clients who pay on time anyway, and never on a partially paid invoice.
- send_draft: sends a draft invoice so the payment clock starts.

Rules:
- You never execute anything. propose_action only queues a proposal; the owner approves or dismisses it in the Action queue widget. Say so plainly.
- Propose at most 4 actions per request, the ones with the most cash impact first. One action per invoice.
- Write reminder and discount notes the way a friendly freelancer would write to a client they want to keep: short, warm, specific, no threats. Address the client by first name where you know it.
- For each proposal give a one-sentence rationale grounded in the numbers below, and the expected impact in dollars and days.
- Finish with a two or three sentence summary of what you queued and what the owner should do next. Do not repeat the note text.`;

// --- Tools --------------------------------------------------------------------------

function buildTools(api: AgStudioApi) {
  const proposeAction = api.defineAiTool({
    name: 'propose_action',
    description:
      'Queue one PayPal action on one invoice for the owner to approve. Nothing is sent to PayPal until they approve it.',
    params: (s) =>
      s.object({
        type: s.enum(['remind', 'discount', 'send_draft'], { description: 'The kind of action.' }),
        invoiceNumber: s.string({ description: 'The invoice number, e.g. RW-0029.' }),
        rationale: s.string({ description: 'One sentence: why this action, for this invoice, now.' }),
        expectedImpact: s.string({ description: 'What you expect it to achieve, e.g. "$11,200 about 10 days sooner".' }),
        subject: s.string({ description: 'Email subject. Required for remind.' }).optional(),
        note: s.string({ description: 'Message to the client. Required for remind and discount.' }).optional(),
        discountPercent: s.number({ description: `Discount percentage, 1 to ${MAX_DISCOUNT_PERCENT}. Required for discount.` }).optional(),
      }),
    execute: (args, ctx) => {
      const { data, proposals } = runwayStore.getState();
      const invoice = data?.invoices.find((i) => i.number.toLowerCase() === args.invoiceNumber.trim().toLowerCase());
      if (!data || !invoice) return ctx.error(`No invoice numbered ${args.invoiceNumber}. Use a number from your briefing.`);
      if (proposals.some((p) => p.status === 'pending' && p.action.invoiceId === invoice.id)) {
        return ctx.error(`${invoice.number} already has an action waiting for approval.`);
      }

      const isDraft = invoice.status === 'Draft';
      let action: RunwayAction;
      if (args.type === 'send_draft') {
        if (!isDraft) return ctx.error(`${invoice.number} is not a draft; it is ${invoice.status}.`);
        action = { type: 'send_draft', invoiceId: invoice.id };
      } else {
        if (!invoice.isReceivable) return ctx.error(`${invoice.number} is ${invoice.status}, not an open invoice.`);
        if (!args.note) return ctx.error('A note to the client is required.');
        if (args.type === 'remind') {
          if (!args.subject) return ctx.error('A reminder needs a subject.');
          action = { type: 'remind', invoiceId: invoice.id, subject: args.subject, note: args.note };
        } else {
          const percent = args.discountPercent;
          if (!percent || percent <= 0 || percent > MAX_DISCOUNT_PERCENT) {
            return ctx.error(`discountPercent must be between 1 and ${MAX_DISCOUNT_PERCENT}.`);
          }
          if (invoice.status === 'Partially paid') return ctx.error(`${invoice.number} is partly paid and cannot be discounted. Propose a reminder instead.`);
          action = { type: 'discount', invoiceId: invoice.id, percent, note: args.note };
        }
      }

      const customer = data.customers.find((c) => c.id === invoice.customerId);
      const proposal = runwayStore.propose({
        action,
        invoiceNumber: invoice.number,
        customer: customer?.company && customer.company !== 'Individual' ? customer.company : (customer?.name ?? 'Unknown'),
        amount: isDraft ? invoice.total : invoice.outstanding,
        rationale: args.rationale,
        impact: args.expectedImpact,
      });
      return ctx.success(`Queued for the owner's approval: ${ACTION_LABELS[action.type]} for ${invoice.number}.`, {
        proposalId: proposal.id,
        action: ACTION_LABELS[action.type],
        invoice: invoice.number,
      });
    },
  });

  return [proposeAction];
}

// --- Roster ---------------------------------------------------------------------------

export const RUNWAY_PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: 'Get me paid faster', prompt: 'Look at my open invoices and propose the actions that would bring cash in soonest.' },
  { label: 'Who is at risk?', prompt: 'Which open invoices are at risk of being paid late, and why?' },
  { label: 'Forecast by week', prompt: 'Add a column chart of expected cash-in by expected week, split by payment risk.' },
];

/**
 * Studio's five built-in agents plus the cash-flow agent, all on one model. The lead keeps its own
 * instructions and tools; it only learns that one more specialist exists and may delegate to it.
 */
export function runwayRoster(api: AgStudioApi, adapter: AgLlmAdapter, { builtIn, tools }: AgAiHarnessBuilderContext): AgAiHarnessConfig {
  const runwayTools = buildTools(api);
  const delegates = Object.keys(builtIn).filter((id) => id !== 'lead');
  const lead = builtIn.lead;

  return {
    agents: [
      ...Object.values(builtIn)
        .filter((definition) => definition.id !== 'lead')
        .map((definition) => directLlmRunner({ ...definition, adapter })),
      directLlmRunner({
        ...lead,
        adapter,
        instructions: (ctx, params) =>
          `${lead.instructions?.(ctx, params) ?? ''}\n\n` +
          `You also have a "${CASHFLOW_AGENT_ID}" agent. Delegate to it, passing the user's request, whenever they ask how to get paid ` +
          'faster, what to do about late or at-risk invoices, to chase, remind or discount an invoice, or to send a draft. It proposes ' +
          'PayPal actions that the user approves in the Action queue widget. You cannot take those actions yourself. After it reports ' +
          'back, relay its summary and tell the user to review the Action queue. For charts and questions about data, including the ' +
          'Cash Forecast table, keep using your other agents as before.',
        tools: (ctx, params) =>
          (lead.tools?.(ctx, params) ?? []).map((tool) =>
            tool.name === 'delegate_to' ? tools.delegateTo([...delegates, CASHFLOW_AGENT_ID]) : tool,
          ),
      }),
      directLlmRunner({
        id: CASHFLOW_AGENT_ID,
        name: 'Cash-flow agent',
        description:
          "Knows every open invoice, when it is expected to be paid and each client's payment habits. Proposes PayPal actions " +
          '(send a reminder, offer an early-payment discount, send a draft invoice) for the user to approve. Use it for any request ' +
          'about getting paid faster or dealing with late invoices.',
        adapter,
        maxTurns: 8,
        instructions: () => `${INSTRUCTIONS}\n\n${briefing()}`,
        tools: () => runwayTools,
      }),
    ],
    primary: 'lead',
    promptStarters: RUNWAY_PROMPT_STARTERS,
  };
}
