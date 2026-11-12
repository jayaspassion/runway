'use client';

// Runway's two custom AG Studio widgets.
//
//   Cash runway   - when each open invoice is due, when it is actually expected to be paid, and
//                   how far those two are apart. Built-in charts can plot one date, not the gap.
//   Action queue  - the PayPal actions the cash-flow agent has proposed, each waiting for a
//                   person to approve or dismiss it.
//
// Both read ./store.ts rather than Studio's data engine: the queue is not report data at all, and
// the runway needs per-invoice rows joined to customers exactly as the agent sees them.

import { useSyncExternalStore } from 'react';
import { ACTION_LABELS } from '@/lib/actions';
import { runwayStore, type Proposal } from './store';

const useRunway = () => useSyncExternalStore(runwayStore.subscribe, runwayStore.getState, runwayStore.getServerState);

const usd = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
const shortDate = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const RISK_COLOR: Record<string, string> = {
  'On track': 'var(--pp-success)',
  'Likely late': 'var(--pp-warning)',
  'At risk': 'var(--pp-danger)',
};

// Studio draws titles for its own widgets only, so these match its title style by hand.
const WidgetTitle = ({ children }: { children: string }) => (
  <h3 className="text-base font-semibold text-pp-navy">{children}</h3>
);

// --- Cash runway ------------------------------------------------------------------------

// The timeline runs from two weeks ago (so overdue due dates are visible) to six weeks ahead.
const PAST_DAYS = 14;
const FUTURE_DAYS = 42;
const position = (days: number) => `${(Math.min(Math.max(days, -PAST_DAYS), FUTURE_DAYS) + PAST_DAYS) / (PAST_DAYS + FUTURE_DAYS) * 100}%`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-xs text-pp-muted">{label}</div>
      <div className="text-xl font-semibold tabular-nums" style={{ color: tone ?? 'var(--pp-navy)' }}>
        {value}
      </div>
    </div>
  );
}

export function CashRunwayWidget() {
  const { data } = useRunway();
  if (!data) return null;

  const today = data.asOf.slice(0, 10);
  const customers = new Map(data.customers.map((c) => [c.id, c]));
  const rows = [...data.forecast].sort((a, b) => a.expectedDate.localeCompare(b.expectedDate) || b.amount - a.amount);
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const within30 = rows.reduce((sum, r) => sum + r.within30Days, 0);
  const atRisk = rows.filter((r) => r.risk === 'At risk').reduce((sum, r) => sum + r.amount, 0);
  const ticks = [-14, 0, 14, 28, 42];

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 text-pp-ink">
      <WidgetTitle>Cash runway: due vs expected</WidgetTitle>
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Expected in the next 30 days" value={usd(within30)} tone="var(--pp-blue)" />
        <Stat label="Outstanding in total" value={usd(total)} />
        <Stat label="At risk" value={usd(atRisk)} tone={atRisk > 0 ? 'var(--pp-danger)' : undefined} />
      </div>

      <div className="flex items-center gap-4 text-xs text-pp-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full border-2 border-pp-muted bg-pp-surface" /> Due
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-full bg-pp-muted" /> Expected
        </span>
        {Object.entries(RISK_COLOR).map(([risk, color]) => (
          <span key={risk} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: color }} /> {risk}
          </span>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-pp-muted">No open invoices. Nothing to wait for.</p>
        ) : (
          <div className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-center gap-x-3 pr-20">
            <div />
            <div className="relative h-5 text-[11px] text-pp-muted">
              {ticks.map((days) => (
                <span key={days} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: position(days) }}>
                  {days === 0 ? 'Today' : shortDate(new Date(Date.parse(today) + days * DAY_MS).toISOString().slice(0, 10))}
                </span>
              ))}
            </div>

            {rows.map((row) => {
              const customer = customers.get(row.customerId);
              const name = customer?.company && customer.company !== 'Individual' ? customer.company : (customer?.name ?? 'Unknown');
              const due = daysBetween(today, row.dueDate);
              const expected = daysBetween(today, row.expectedDate);
              const color = RISK_COLOR[row.risk] ?? 'var(--pp-muted)';
              const [from, to] = due <= expected ? [due, expected] : [expected, due];
              return (
                <div key={row.id} className="contents">
                  <div className="min-w-0 py-1.5">
                    <div className="truncate text-sm font-medium">{name}</div>
                    <div className="truncate text-xs text-pp-muted tabular-nums">
                      {row.number} · {usd(row.amount)}
                    </div>
                  </div>
                  <div
                    className="relative h-9 border-b border-pp-border/60"
                    title={`${row.number}: due ${shortDate(row.dueDate)}, expected ${shortDate(row.expectedDate)} (${row.risk}, ${row.confidence.toLowerCase()} confidence)`}
                  >
                    <span className="absolute inset-y-0 w-px bg-pp-navy/30" style={{ left: position(0) }} />
                    <span
                      className="absolute top-1/2 h-0.5 -translate-y-1/2"
                      style={{ left: position(from), width: `calc(${position(to)} - ${position(from)})`, background: color }}
                    />
                    <span
                      className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-pp-surface"
                      style={{ left: position(due), borderColor: color }}
                    />
                    <span
                      className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
                      style={{ left: position(expected), background: color }}
                    />
                    <span
                      className="absolute top-1/2 -translate-y-1/2 pl-2.5 text-[11px] whitespace-nowrap text-pp-muted"
                      style={{ left: position(Math.max(due, expected)) }}
                    >
                      {shortDate(row.expectedDate)}
                      {row.expectedDaysLate > 0 && ` · ${row.expectedDaysLate}d late`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// --- Action queue -----------------------------------------------------------------------

const STATUS_STYLE: Record<Proposal['status'], { label: string; color: string }> = {
  pending: { label: 'Needs approval', color: 'var(--pp-blue)' },
  running: { label: 'Sending to PayPal…', color: 'var(--pp-muted)' },
  done: { label: 'Done', color: 'var(--pp-success)' },
  failed: { label: 'Failed', color: 'var(--pp-danger)' },
  dismissed: { label: 'Dismissed', color: 'var(--pp-muted)' },
};

function describe(proposal: Proposal) {
  const { action } = proposal;
  if (action.type === 'discount') return `${action.percent}% early-payment discount`;
  return ACTION_LABELS[action.type];
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const { action, status } = proposal;
  const style = STATUS_STYLE[status];
  const settled = status === 'done' || status === 'failed' || status === 'dismissed';

  return (
    <li className={`rounded-lg border border-pp-border p-3 ${settled ? 'bg-pp-canvas' : 'bg-pp-surface'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-pp-navy">{describe(proposal)}</div>
          <div className="truncate text-xs text-pp-muted tabular-nums">
            {proposal.customer} · {proposal.invoiceNumber} · {usd(proposal.amount)}
          </div>
        </div>
        <span className="shrink-0 text-xs font-medium" style={{ color: style.color }}>
          {style.label}
        </span>
      </div>

      {!settled && (
        <>
          <p className="mt-2 text-sm">{proposal.rationale}</p>
          <p className="mt-1 text-xs text-pp-muted">Expected: {proposal.impact}</p>
          {'note' in action && (
            <blockquote className="mt-2 border-l-2 border-pp-border pl-2.5 text-xs text-pp-muted">
              {'subject' in action && <div className="font-medium text-pp-ink">{action.subject}</div>}
              {action.note}
            </blockquote>
          )}
        </>
      )}
      {proposal.result && <p className="mt-2 text-xs" style={{ color: style.color }}>{proposal.result}</p>}

      {status === 'pending' && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="rounded-full bg-pp-blue px-4 py-1.5 text-sm font-semibold text-white hover:bg-pp-blue-dark"
            onClick={() => void runwayStore.approve(proposal.id)}
          >
            Approve
          </button>
          <button
            type="button"
            className="rounded-full border border-pp-border px-4 py-1.5 text-sm font-semibold text-pp-navy hover:bg-pp-highlight"
            onClick={() => runwayStore.dismiss(proposal.id)}
          >
            Dismiss
          </button>
        </div>
      )}
    </li>
  );
}

export function ActionQueueWidget() {
  const { proposals } = useRunway();
  const waiting = proposals.filter((p) => p.status === 'pending' || p.status === 'running');
  const finished = proposals.filter((p) => p.status !== 'pending' && p.status !== 'running');

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 text-pp-ink">
      <WidgetTitle>Action queue</WidgetTitle>
      <div className="flex items-baseline justify-between text-xs text-pp-muted">
        <span>
          {waiting.length === 0 ? 'Nothing waiting for you' : `${waiting.length} waiting for your approval`}
        </span>
        {finished.length > 0 && (
          <button type="button" className="font-medium text-pp-blue hover:underline" onClick={() => runwayStore.clearFinished()}>
            Clear finished
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {proposals.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
            <p className="text-sm font-medium text-pp-navy">No actions proposed yet</p>
            <p className="text-xs text-pp-muted">
              Open the AI assistant and ask &ldquo;Get me paid faster&rdquo;. The cash-flow agent will queue PayPal actions here.
              Nothing is sent until you approve it.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...waiting, ...finished].map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
