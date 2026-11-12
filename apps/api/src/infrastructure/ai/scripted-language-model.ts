import { createHash } from 'node:crypto';
import {
  LanguageModelError,
  type EmbeddingRequest,
  type EmbeddingResult,
  type ILanguageModel,
  type LanguageModelCitation,
  type LanguageModelErrorKind,
  type LanguageModelRequest,
  type LanguageModelResult,
  type LanguageModelStreamEvent,
} from '#domain/adapters/language-model.interface';
import { estimateTokens } from '#domain/utils/token-estimate';

/**
 * What a script answers a request with. Exactly one of the three shapes:
 * a completion, a provider refusal, or a provider failure.
 */
export type ScriptedReply =
  | {
      text: string;
      /** For a `structured` request: the value the model "returned". */
      object?: unknown;
      /** For a `cited` request: what the model "quoted", unchecked. */
      citations?: LanguageModelCitation[];
      truncated?: boolean;
    }
  | { refuse: { category: string | null } }
  | { fail: LanguageModelErrorKind };

/**
 * One task's script: the request the gateway built, in; the canned reply,
 * out. A script may read the request (to quote a source it was given, or to
 * pick a reply by the question), which is what lets a test show that
 * something never reached the model.
 */
export type ScriptedHandler = (request: LanguageModelRequest) => ScriptedReply;

export type ScriptedReplies = Readonly<Record<string, ScriptedHandler>>;

/**
 * The adapter that needs no network and no key (ADR-28 decision 1).
 *
 * It stands in for every provider when `AI_PROVIDER=scripted`: in unit
 * tests, in the eval suite (`test/ai-evals/`, where it plays a model that
 * misbehaves so Frapp's own enforcement is what gets graded), and in the
 * local app, so a flow can be walked end to end before any credential exists.
 *
 * Replies come from `scripts`, by task. A `cited` task with no script gets a
 * marker sentence and no citations; a `structured` task with no script fails
 * as `invalid_output`, because no marker can satisfy a schema. Usage is estimated from lengths, so the
 * ledger and the caps see plausible, repeatable numbers.
 */
export class ScriptedLanguageModel implements ILanguageModel {
  readonly provider = 'scripted' as const;

  constructor(private readonly scripts: ScriptedReplies = {}) {}

  generate(request: LanguageModelRequest): Promise<LanguageModelResult> {
    try {
      return Promise.resolve(this.reply(request));
    } catch (error) {
      return Promise.reject(asLanguageModelError(error));
    }
  }

  async *stream(
    request: LanguageModelRequest,
  ): AsyncIterable<LanguageModelStreamEvent> {
    const result = await this.generate(request);
    if (result.outcome === 'completed') {
      // Word by word, so a client's streaming path is exercised.
      for (const piece of result.text.match(/\S+\s*/g) ?? []) {
        yield { type: 'text', delta: piece };
      }
    }
    yield { type: 'done', result };
  }

  embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    return Promise.resolve({
      vectors: request.texts.map((text) =>
        deterministicVector(text, request.dimensions),
      ),
      inputTokens: request.texts.reduce(
        (sum, text) => sum + estimateTokens(text),
        0,
      ),
    });
  }

  private reply(request: LanguageModelRequest): LanguageModelResult {
    const scripted = this.scripts[request.task]?.(request) ?? fallback(request);
    const inputTokens = estimateTokens(requestText(request));

    if ('fail' in scripted) {
      throw new LanguageModelError(scripted.fail, 'scripted');
    }
    if ('refuse' in scripted) {
      return {
        outcome: 'refused',
        category: scripted.refuse.category,
        usage: { inputTokens, outputTokens: 0, cachedInputTokens: 0 },
      };
    }
    return {
      outcome: 'completed',
      text: scripted.text,
      ...(request.kind === 'structured' ? { object: scripted.object } : {}),
      citations: request.kind === 'cited' ? (scripted.citations ?? []) : [],
      truncated: scripted.truncated ?? false,
      usage: {
        inputTokens,
        outputTokens: estimateTokens(scripted.text),
        cachedInputTokens: 0,
      },
    };
  }
}

function fallback(request: LanguageModelRequest): ScriptedReply {
  if (request.kind === 'structured') return { fail: 'invalid_output' };
  return { text: `Scripted reply for ${request.task}.` };
}

function asLanguageModelError(error: unknown): LanguageModelError {
  // A script that throws anything else is a broken script. It still must not
  // leak through the port as an arbitrary error with an arbitrary message.
  return error instanceof LanguageModelError
    ? error
    : new LanguageModelError('unknown', 'scripted');
}

function requestText(request: LanguageModelRequest): string {
  return [
    request.system ?? '',
    ...request.messages.map((message) => message.content),
    ...(request.kind === 'cited'
      ? request.sources.map((source) => source.text)
      : []),
  ].join('\n');
}

/**
 * A unit vector that depends only on the text: the same text always embeds
 * the same, and different texts differ. It carries no meaning, so a test of
 * ranking must not rest on it; a test of plumbing can.
 */
function deterministicVector(text: string, dimensions: number): number[] {
  const values: number[] = [];
  for (let block = 0; values.length < dimensions; block += 1) {
    const digest = createHash('sha256').update(`${block}:${text}`).digest();
    for (let i = 0; i < digest.length && values.length < dimensions; i += 1) {
      values.push(digest[i] / 127.5 - 1);
    }
  }
  const norm = Math.hypot(...values) || 1;
  return values.map((value) => value / norm);
}
