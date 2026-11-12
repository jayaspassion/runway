// Registers Runway's custom widgets with AG Studio, and says how the agent's tool calls read in
// the chat panel.

import type { AgBaseRegistry, AgDefaultWidgetDefinition, AgBaseWidgetDefinition } from 'ag-studio';
import { createWidgets } from 'ag-studio-react';
import { ACTION_LABELS, type ActionType } from '@/lib/actions';
import { ActionQueueWidget, CashRunwayWidget } from './widgets';

export const CASH_RUNWAY_WIDGET = 'runway-cash';
export const ACTION_QUEUE_WIDGET = 'runway-actions';

type RunwayWidgetType = typeof CASH_RUNWAY_WIDGET | typeof ACTION_QUEUE_WIDGET;

export interface RunwayRegistry extends AgBaseRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | AgBaseWidgetDefinition<RunwayWidgetType>)[];
}

const cashRunway: AgBaseWidgetDefinition<RunwayWidgetType> = {
  id: CASH_RUNWAY_WIDGET,
  label: 'Cash runway',
  comp: CashRunwayWidget,
  // Nothing to configure: the widget draws the forecast as it is.
  form: () => [],
  defaultSize: { width: 14, height: 26 },
  minSize: { width: 8, height: 12 },
  ai: {
    label: 'Cash runway',
    description:
      'A timeline with one row per open invoice showing its due date, the date it is expected to be paid given the ' +
      "customer's payment history, and the gap between them, coloured by payment risk. Shows totals expected in 30 days and at risk.",
    usage: 'Use for "when will I get paid" or cash forecast overviews. It needs no data mapping and takes no configuration.',
  },
};

const actionQueue: AgBaseWidgetDefinition<RunwayWidgetType> = {
  id: ACTION_QUEUE_WIDGET,
  label: 'Action queue',
  comp: ActionQueueWidget,
  form: () => [],
  defaultSize: { width: 10, height: 26 },
  minSize: { width: 6, height: 12 },
  ai: {
    label: 'Action queue',
    description:
      'The PayPal actions proposed by the cash-flow agent (reminders, early-payment discounts, sending drafts), each with ' +
      'Approve and Dismiss buttons. Nothing reaches PayPal until the user approves it here.',
    usage: 'Add it when the page should let the user review proposed actions. It needs no data mapping and takes no configuration.',
  },
};

export const runwayWidgets = (config: { menu: { label: string; widgetIds: readonly string[] }[] }) =>
  createWidgets<RunwayRegistry>({
    additionalTypes: [cashRunway, actionQueue],
    menu: [{ label: 'Runway', widgetIds: [CASH_RUNWAY_WIDGET, ACTION_QUEUE_WIDGET] }, ...config.menu],
  } as Parameters<typeof createWidgets<RunwayRegistry>>[0]);

// How propose_action reads as a step in the chat transcript.
export const runwayToolDisplay = {
  propose_action: {
    label: ({ args, result }: { args: { type?: ActionType; invoiceNumber?: string }; result?: { success: boolean } }) => {
      const what = args.type ? ACTION_LABELS[args.type] : 'PayPal action';
      const target = args.invoiceNumber ? ` for ${args.invoiceNumber}` : '';
      if (result && !result.success) return { text: `Could not propose: ${what}${target}` };
      return { text: `${result ? 'Proposed' : 'Proposing'}: ${what}${target}`, pill: result ? 'Needs approval' : undefined };
    },
  },
};
