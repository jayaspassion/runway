// The AG Studio AI assistant. The adapter posts to this app's proxy at app/api/ai/gemini, which
// holds the Gemini key, so nothing secret is sent from the browser.

import { createAiHarness, type AgAiHarnessSetup, type AgAiPromptStarter } from 'ag-studio';
import { geminiAdapter } from './gemini-adapter';

// Suggestions shown in a new AI conversation, before anything has been typed.
const PROMPT_STARTERS: AgAiPromptStarter[] = [
  {
    label: 'Summarise this page',
    prompt: 'Summarise what this page shows: every widget, the fields it reads, and what stands out.',
  },
  {
    label: 'Overdue invoices',
    prompt: 'Which customers owe the most on overdue invoices?',
  },
  {
    label: 'Revenue by month',
    prompt: 'Add a chart of paid invoice revenue by month.',
  },
];

// `models` are the ids allowed by GEMINI_MODELS on the server; the first is the default. The proxy
// falls back through the rest when a model is busy, so no picker is shown.
export function buildAi(models: string[]): AgAiHarnessSetup {
  const adapter = geminiAdapter({ endpoint: '/api/ai/gemini', model: models[0] });

  return ({ api }) => createAiHarness(api, { adapter, promptStarters: PROMPT_STARTERS });
}
