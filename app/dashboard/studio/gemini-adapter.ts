// Gemini adapter for AG Studio's Direct LLM Runner.
//
// AG Studio ships an OpenAI example adapter only; this is the same contract (AgLlmAdapter) written
// against Gemini's generateContent streaming API. It runs in the browser and posts to this app's own
// proxy (app/api/ai/gemini/route.ts), which adds the API key and picks the model, so nothing secret
// is sent from the page.
//
// Three things differ from OpenAI and are handled here:
//   - Conversation shape: Gemini wants alternating user/model turns made of parts, with a tool call
//     and its result as `functionCall` / `functionResponse` parts.
//   - Thought signatures: Gemini 3+ returns an opaque signature with a tool call and expects it back
//     on the next turn. Studio's conversation items have nowhere to carry it, so it is remembered
//     here, keyed by call id, for the life of the page.
//   - Schemas: Studio's Shape library marks optional fields with a `{ not: {} }` branch, which
//     Gemini rejects, so those branches are removed.
/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  AgAiConversationItem,
  AgAiEvent,
  AgAiOutputItem,
  AgAiToolSchema,
  AgLlmAdapter,
  AgLlmRequest,
  AgLlmResponse,
  AgLlmResponseHandler,
} from 'ag-studio';

type JsonSchema = Record<string, unknown>;
type GeminiPart = Record<string, any>;
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] };

interface GeminiAdapterOptions {
  /** URL of the server proxy that forwards to Gemini. */
  endpoint: string;
  /** Model used when the chat offers no model picker. The proxy falls back to others if it is busy. */
  model?: string;
}

// Gemini's documented placeholder for a tool call whose real signature is not available (for
// example after a page reload, when the in-memory map below is empty).
const PLACEHOLDER_SIGNATURE = 'context_engineering_is_the_way_to_go';

// =============================================================================
// Schemas
// =============================================================================

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUndefinedSentinel = (s: unknown) =>
  isSchema(s) && Object.keys(s).length === 1 && isSchema(s.not) && Object.keys(s.not).length === 0;

/** Removes Shape's `{ not: {} }` "undefined" branches, which only mark a property as optional. */
function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!isSchema(schema)) return schema;

  const out: JsonSchema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'anyOf' && Array.isArray(value)) {
      const branches = value.filter((b) => !isUndefinedSentinel(b)).map(toGeminiSchema);
      if (branches.length === 1 && isSchema(branches[0])) Object.assign(out, branches[0]);
      else if (branches.length > 0) out.anyOf = branches;
    } else if (key === 'properties' && isSchema(value)) {
      // Property names are data, not keywords, so only their schemas are transformed.
      out.properties = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toGeminiSchema(v)]));
    } else if (key === 'enum' || key === 'required' || key === 'const' || key === 'default') {
      out[key] = value;
    } else {
      out[key] = toGeminiSchema(value);
    }
  }
  return out;
}

// =============================================================================
// Encoding: AG Studio -> Gemini
// =============================================================================

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function encodeContents(items: AgAiConversationItem[], signatures: Map<string, string>): GeminiContent[] {
  const nameByCallId = new Map<string, string>();
  for (const item of items) {
    if (item.kind === 'output' && item.type === 'function_call') nameByCallId.set(item.callId, item.name);
  }

  const contents: GeminiContent[] = [];
  // Gemini needs alternating roles, so consecutive items of one role share a turn. That also puts
  // parallel tool calls in one model turn and their results in one user turn, as it expects.
  const push = (role: GeminiContent['role'], parts: GeminiPart[]) => {
    if (parts.length === 0) return;
    const last = contents.at(-1);
    if (last?.role === role) last.parts.push(...parts);
    else contents.push({ role, parts: [...parts] });
  };

  for (const item of items as any[]) {
    if (item.kind === 'input' && item.type === 'message') {
      const parts: GeminiPart[] = [];
      for (const c of item.content) {
        if (c.type === 'text' && c.text) parts.push({ text: c.text });
        // Inline images arrive as data URLs; anything else (file ids, remote URLs) is skipped.
        const match = c.type === 'image' && /^data:([^;]+);base64,(.*)$/.exec(c.imageUrl ?? '');
        if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
      push('user', parts);
    } else if (item.kind === 'output' && item.type === 'message') {
      push(
        'model',
        item.content.filter((c: any) => c.type === 'text' && c.text).map((c: any) => ({ text: c.text })),
      );
    } else if (item.kind === 'output' && item.type === 'function_call') {
      const args = parseJson(item.arguments || '{}');
      const part: GeminiPart = { functionCall: { name: item.name, args: isSchema(args) ? args : {}, id: item.callId } };
      const signature = signatures.get(item.callId);
      const last = contents.at(-1);
      const firstCallOfTurn = !(last?.role === 'model' && last.parts.some((p) => p.functionCall));
      // Only the first call of a turn carries a signature; parallel calls after it have none.
      if (signature) part.thoughtSignature = signature;
      else if (firstCallOfTurn) part.thoughtSignature = PLACEHOLDER_SIGNATURE;
      push('model', [part]);
    } else if (item.type === 'function_call_output') {
      const output = typeof item.output === 'string' ? (parseJson(item.output) ?? item.output) : item.output;
      push('user', [
        {
          functionResponse: {
            name: nameByCallId.get(item.callId) ?? 'unknown_tool',
            id: item.callId,
            response: isSchema(output) ? output : { result: output },
          },
        },
      ]);
    }
    // Reasoning items are not replayed: Gemini keeps its own reasoning state in the signatures.
  }

  // A conversation must open with a user turn.
  if (contents[0]?.role === 'model') contents.unshift({ role: 'user', parts: [{ text: '(continue)' }] });
  return contents;
}

function encodeToolConfig(toolChoice: AgLlmRequest['toolChoice']) {
  if (!toolChoice) return undefined;
  if (toolChoice === 'auto') return { functionCallingConfig: { mode: 'AUTO' } };
  if (toolChoice === 'none') return { functionCallingConfig: { mode: 'NONE' } };
  if (toolChoice === 'required') return { functionCallingConfig: { mode: 'ANY' } };
  return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [toolChoice.name] } };
}

function buildBody(request: AgLlmRequest, fallbackModel: string | undefined, signatures: Map<string, string>) {
  const { tools = [], toolChoice, responseFormat, input, instructions, model } = request;

  // Provider-hosted tools belong to another provider's API and have no Gemini function form.
  const declarations = tools
    .filter((tool: AgAiToolSchema) => tool.kind !== 'provided')
    .map((tool: AgAiToolSchema) => ({
      name: tool.name,
      description: tool.description,
      parametersJsonSchema: toGeminiSchema(tool.parameters),
    }));

  const generationConfig: Record<string, unknown> = { thinkingConfig: { includeThoughts: true } };
  if (responseFormat && responseFormat.type !== 'text') {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseJsonSchema = toGeminiSchema(responseFormat.schema);
  }

  return {
    model: model?.id ?? fallbackModel,
    systemInstruction: instructions ? { parts: [{ text: instructions }] } : undefined,
    contents: encodeContents(input, signatures),
    tools: declarations.length > 0 ? [{ functionDeclarations: declarations }] : undefined,
    toolConfig: declarations.length > 0 ? encodeToolConfig(toolChoice) : undefined,
    generationConfig,
  };
}

// =============================================================================
// Decoding: Gemini stream -> AG Studio events
// =============================================================================

let idCounter = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/**
 * Turns Gemini's stream of part chunks into Studio's start/content/end events, and collects the
 * finished output items for the final response.
 */
class TurnDecoder {
  readonly output: AgAiOutputItem[] = [];
  responseId = '';
  model: string | undefined;
  usage: AgLlmResponse['usage'];
  error: Error | undefined;
  incompleteReason: 'max_output_tokens' | 'content_filter' | undefined;

  private open: { kind: 'text' | 'reasoning'; id: string; text: string } | undefined;
  private readonly signatures: Map<string, string>;

  constructor(signatures: Map<string, string>) {
    this.signatures = signatures;
  }

  decode(chunk: Record<string, any>): AgAiEvent[] {
    if (chunk.error) {
      this.error ??= new Error(chunk.error.message ?? 'Gemini returned an error.');
      return [];
    }
    this.responseId = chunk.responseId ?? this.responseId;
    this.model = chunk.modelVersion ?? this.model;
    if (chunk.usageMetadata) {
      const u = chunk.usageMetadata;
      this.usage = {
        inputTokens: u.promptTokenCount ?? 0,
        outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
        totalTokens: u.totalTokenCount,
        reasoningTokens: u.thoughtsTokenCount,
        cachedInputTokens: u.cachedContentTokenCount,
      };
    }
    if (chunk.promptFeedback?.blockReason) {
      this.error ??= new Error(`Gemini blocked the request: ${chunk.promptFeedback.blockReason}`);
      return [];
    }

    const candidate = chunk.candidates?.[0];
    const events: AgAiEvent[] = [];
    for (const part of candidate?.content?.parts ?? []) {
      if (part.functionCall) events.push(...this.toolCall(part));
      else if (typeof part.text === 'string' && part.text) events.push(...this.text(part.thought ? 'reasoning' : 'text', part.text));
    }

    switch (candidate?.finishReason) {
      case undefined:
      case 'STOP':
        break;
      case 'MAX_TOKENS':
        this.incompleteReason = 'max_output_tokens';
        break;
      case 'SAFETY':
      case 'PROHIBITED_CONTENT':
      case 'RECITATION':
        this.incompleteReason = 'content_filter';
        break;
      default:
        // e.g. MALFORMED_FUNCTION_CALL: the turn produced nothing usable.
        this.error ??= new Error(`Gemini stopped early: ${candidate.finishReason}`);
    }
    return events;
  }

  /** Closes whatever is still open once the stream ends. */
  finish(): AgAiEvent[] {
    return this.close();
  }

  private text(kind: 'text' | 'reasoning', delta: string): AgAiEvent[] {
    const events: AgAiEvent[] = [];
    if (this.open?.kind !== kind) {
      events.push(...this.close());
      this.open = { kind, id: newId(kind === 'text' ? 'msg' : 'rs'), text: '' };
      events.push(
        kind === 'text'
          ? { type: 'TEXT_MESSAGE_START', messageId: this.open.id, role: 'assistant' }
          : { type: 'REASONING_MESSAGE_START', messageId: this.open.id, role: 'reasoning' },
      );
    }
    this.open.text += delta;
    events.push({
      type: kind === 'text' ? 'TEXT_MESSAGE_CONTENT' : 'REASONING_MESSAGE_CONTENT',
      messageId: this.open.id,
      delta,
    });
    return events;
  }

  private toolCall(part: GeminiPart): AgAiEvent[] {
    const events = this.close();
    const callId: string = part.functionCall.id ?? newId('call');
    const args = JSON.stringify(part.functionCall.args ?? {});
    if (part.thoughtSignature) this.signatures.set(callId, part.thoughtSignature);

    this.output.push({
      id: callId,
      kind: 'output',
      type: 'function_call',
      callId,
      name: part.functionCall.name,
      arguments: args,
      status: 'completed',
    } as AgAiOutputItem);
    events.push(
      { type: 'TOOL_CALL_START', toolCallId: callId, toolCallName: part.functionCall.name },
      { type: 'TOOL_CALL_ARGS', toolCallId: callId, delta: args },
      { type: 'TOOL_CALL_END', toolCallId: callId },
    );
    return events;
  }

  private close(): AgAiEvent[] {
    const open = this.open;
    if (!open) return [];
    this.open = undefined;
    if (open.kind === 'text') {
      this.output.push({
        id: open.id,
        kind: 'output',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'text', text: open.text, annotations: [] }],
      } as AgAiOutputItem);
      return [{ type: 'TEXT_MESSAGE_END', messageId: open.id }];
    }
    this.output.push({
      id: open.id,
      kind: 'output',
      type: 'reasoning',
      summary: [{ type: 'summary', text: open.text }],
    } as AgAiOutputItem);
    return [{ type: 'REASONING_MESSAGE_END', messageId: open.id }];
  }
}

async function* streamGemini(
  endpoint: string,
  body: Record<string, unknown>,
  decoder: TurnDecoder,
  signal?: AbortSignal,
): AsyncIterableIterator<AgAiEvent> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    throw new Error(failure.error?.message || `HTTP ${response.status}: ${response.statusText}`);
  }

  const reader = response.body!.getReader();
  const text = new TextDecoder();
  let buffer = '';
  const lines = function* (chunk: string) {
    buffer += chunk;
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? '';
    yield* parts;
  };

  while (true) {
    const { done, value } = await reader.read();
    for (const line of lines(done ? '\n' : text.decode(value, { stream: true }))) {
      if (!line.startsWith('data: ')) continue;
      const parsed = parseJson(line.slice(6));
      if (isSchema(parsed)) yield* decoder.decode(parsed);
    }
    if (done) break;
  }
  yield* decoder.finish();
}

// =============================================================================
// Adapter
// =============================================================================

function runRequest(
  options: GeminiAdapterOptions,
  request: AgLlmRequest,
  signatures: Map<string, string>,
  signal?: AbortSignal,
): AgLlmResponseHandler {
  const decoder = new TurnDecoder(signatures);

  let resolveComplete: (response: AgLlmResponse) => void;
  let rejectComplete: (error: Error) => void;
  const complete = new Promise<AgLlmResponse>((resolve, reject) => {
    resolveComplete = resolve;
    rejectComplete = reject;
  });
  // A consumer that abandons the stream never awaits `complete`; mark its rejection as observed.
  void complete.catch(() => {});

  // A failed turn is reported once, through `complete`, rather than also thrown from the stream.
  async function* events(): AsyncIterableIterator<AgAiEvent> {
    try {
      yield* streamGemini(options.endpoint, buildBody(request, options.model, signatures), decoder, signal);
    } catch (error) {
      decoder.error ??= error instanceof Error ? error : new Error(String(error));
    }
    if (decoder.error) {
      rejectComplete(decoder.error);
    } else {
      resolveComplete({
        id: decoder.responseId || newId('resp'),
        createdAt: Date.now(),
        model: decoder.model,
        output: decoder.output,
        status: decoder.incompleteReason ? 'incomplete' : 'completed',
        incompleteDetails: decoder.incompleteReason ? { reason: decoder.incompleteReason } : undefined,
        usage: decoder.usage,
      });
    }
  }

  const iterator = events();
  return { stream: { [Symbol.asyncIterator]: () => iterator }, complete };
}

export function geminiAdapter(options: GeminiAdapterOptions): AgLlmAdapter {
  // Thought signatures by tool-call id, kept for the life of the page (see the file header).
  const signatures = new Map<string, string>();
  return {
    executeTurn: (request: AgLlmRequest, turn?: { signal?: AbortSignal }) =>
      runRequest(options, request, signatures, turn?.signal),
  };
}
