// The AG Studio AI assistant: Studio's built-in agents plus the Runway cash-flow agent
// (../runway/agent.ts), all running on Gemini. The adapter posts to this app's proxy at
// app/api/ai/gemini, which holds the key, so nothing secret is sent from the browser.

import { createAiHarness, type AgAiHarnessSetup } from 'ag-studio';
import { runwayRoster } from '../runway/agent';
import { geminiAdapter } from './gemini-adapter';

// `models` are the ids allowed by GEMINI_MODELS on the server; the first is the default. The proxy
// falls back through the rest when a model is busy, so no picker is shown.
export function buildAi(models: string[]): AgAiHarnessSetup {
  const adapter = geminiAdapter({ endpoint: '/api/ai/gemini', model: models[0] });

  return ({ api }) => createAiHarness(api, (context) => runwayRoster(api, adapter, context));
}
