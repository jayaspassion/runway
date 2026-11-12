// Server-side configuration for the AG Studio AI assistant, which runs on Gemini. The API key is
// read only here: it is never passed to a client component, and it has no NEXT_PUBLIC_ prefix, so
// Next.js never inlines it into the browser bundle.

// Tried in order: when a model is overloaded or out of quota, the proxy moves on to the next one,
// so a busy model does not take the assistant down.
const DEFAULT_MODELS = ['gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'];

let loggedKeyState = false;

/** The Gemini key for the assistant, or undefined when none is configured. */
export function geminiKey(): string | undefined {
  const key = process.env.GEMINI_API_KEY || undefined;
  if (!loggedKeyState) {
    loggedKeyState = true;
    console.log(
      key
        ? '[AI] AG Studio assistant enabled, using GEMINI_API_KEY'
        : '[AI] AG Studio assistant disabled: set GEMINI_API_KEY in .env.local to enable it',
    );
  }
  return key;
}

/** The Gemini models the assistant may use, from GEMINI_MODELS (comma-separated). The first is the default. */
export function aiModels(): string[] {
  const models = (process.env.GEMINI_MODELS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return models.length > 0 ? models : DEFAULT_MODELS;
}

/** The assistant is shown only when a key is configured. */
export function aiEnabled(): boolean {
  return Boolean(geminiKey());
}
