// Shared state for the Runway feature, outside React and outside AG Studio: the dashboard data the
// agent and the custom widgets both read, and the queue of actions the agent has proposed.
//
// It lives in a module-level store because three unrelated parties need it: the agent's tools
// (plain functions called by Studio), the widgets (React components Studio mounts itself) and the
// dashboard shell. Proposals persist in localStorage so a reload doesn't lose the queue.

import type { DashboardData } from '@/lib/dashboard-data';
import type { RunwayAction } from '@/lib/actions';

export type ProposalStatus = 'pending' | 'running' | 'done' | 'failed' | 'dismissed';

export type Proposal = {
  id: string;
  createdAt: string;
  action: RunwayAction;
  invoiceNumber: string;
  customer: string;
  amount: number;
  /** Why the agent suggests this, in a sentence. */
  rationale: string;
  /** What the agent expects to happen if it is approved. */
  impact: string;
  status: ProposalStatus;
  /** What PayPal said, once the action has run. */
  result?: string;
};

type State = { data: DashboardData | null; proposals: Proposal[] };

const STORAGE_KEY = 'runway:proposals:v1';

function loadProposals(): Proposal[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Proposal[];
    // An action that was mid-flight when the page closed has an unknown outcome.
    return stored.map((p) => (p.status === 'running' ? { ...p, status: 'failed', result: 'Interrupted. Check the invoice in PayPal.' } : p));
  } catch {
    return [];
  }
}

let state: State = { data: null, proposals: loadProposals() };
const listeners = new Set<() => void>();
let refreshData: () => void = () => {};

function set(next: Partial<State>) {
  state = { ...state, ...next };
  if (next.proposals && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.proposals));
    } catch {
      // Storage full or blocked: the queue still works for this page view.
    }
  }
  listeners.forEach((listener) => listener());
}

const patch = (id: string, change: Partial<Proposal>) =>
  set({ proposals: state.proposals.map((p) => (p.id === id ? { ...p, ...change } : p)) });

export const runwayStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
  getState: () => state,
  getServerState: (): State => ({ data: null, proposals: [] }),

  /** Called by the dashboard whenever fresh PayPal data arrives. */
  setData(data: DashboardData, refresh: () => void) {
    refreshData = refresh;
    if (state.data !== data) set({ data });
  },

  propose(proposal: Omit<Proposal, 'id' | 'createdAt' | 'status'>): Proposal {
    const created: Proposal = {
      ...proposal,
      id: crypto.randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    set({ proposals: [created, ...state.proposals] });
    return created;
  },

  dismiss: (id: string) => patch(id, { status: 'dismissed' }),

  clearFinished: () => set({ proposals: state.proposals.filter((p) => p.status === 'pending' || p.status === 'running') }),

  /** Runs an approved proposal against PayPal, then reloads the dashboard data. */
  async approve(id: string) {
    const proposal = state.proposals.find((p) => p.id === id);
    if (!proposal || proposal.status !== 'pending') return;
    patch(id, { status: 'running' });
    try {
      const response = await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proposal.action),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string };
      patch(id, {
        status: response.ok && body.ok ? 'done' : 'failed',
        result: body.message ?? `The server answered ${response.status}.`,
      });
      if (response.ok) refreshData();
    } catch {
      patch(id, { status: 'failed', result: 'Could not reach the server.' });
    }
  },
};
