import { aiModels, geminiKey } from '@/lib/ai';

// Proxy for the dashboard's Gemini adapter (app/dashboard/studio/gemini-adapter.ts). The adapter
// runs in the browser and POSTs a generateContent body here; this adds the server's API key (see
// lib/ai.ts), forwards it to Gemini's streaming endpoint and streams the SSE reply straight back,
// so the key never leaves the server.

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// Bounds the cost of a single turn, whatever the client asks for. Thinking tokens count towards it.
const MAX_OUTPUT_TOKENS = 16_000;

// How long a model may take to start answering before the next one is tried. An overloaded model
// sometimes holds the connection open instead of refusing it.
const FIRST_BYTE_TIMEOUT_MS = 12_000;

// Statuses that mean "this model can't answer right now", as opposed to "the request is wrong".
const RETRY_WITH_NEXT_MODEL = new Set([404, 429, 500, 503]);

const error = (status: number, message: string) => Response.json({ error: { message } }, { status });

export async function POST(request: Request) {
  const apiKey = geminiKey();
  if (!apiKey) return error(503, 'The AI assistant is not configured: set GEMINI_API_KEY in .env.local.');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error(400, 'Request body must be JSON.');
  }

  // Only the configured models (GEMINI_MODELS) may be called. The requested one is tried first,
  // then the rest in their configured order.
  const models = aiModels();
  const { model: requested, generationConfig, ...rest } = body;
  const first = typeof requested === 'string' && requested ? requested : models[0];
  if (!models.includes(first)) return error(400, `Model "${first}" is not enabled.`);
  const candidates = [first, ...models.filter((id) => id !== first)];

  const payload = JSON.stringify({
    ...rest,
    generationConfig: { ...(generationConfig as object | undefined), maxOutputTokens: MAX_OUTPUT_TOKENS },
  });

  let failure = error(503, 'No Gemini model is available right now.');
  for (const model of candidates) {
    // Stopping the chat in Studio aborts the browser request, which cancels this one too.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), FIRST_BYTE_TIMEOUT_MS);
    let upstream: Response;
    try {
      upstream = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: payload,
        signal: AbortSignal.any([request.signal, timeout.signal]),
      });
    } catch (cause) {
      if (request.signal.aborted) throw cause;
      console.warn(`[AI] ${model} did not answer within ${FIRST_BYTE_TIMEOUT_MS / 1000}s, trying the next model`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (upstream.ok) {
      return new Response(upstream.body, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' },
      });
    }

    // Errors come back as JSON and the adapter reads `error.message` from them.
    const detail = await upstream.json().catch(() => ({}));
    const message = detail?.error?.message ?? `Gemini returned HTTP ${upstream.status}.`;
    failure = error(upstream.status, message);
    if (!RETRY_WITH_NEXT_MODEL.has(upstream.status)) return failure;
    console.warn(`[AI] ${model} unavailable (${upstream.status}), trying the next model: ${message.slice(0, 300)}`);
  }
  return failure;
}
