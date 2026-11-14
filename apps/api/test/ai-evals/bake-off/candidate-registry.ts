/**
 * Puts one bake-off candidate behind the gateway's port.
 *
 * The gateway resolves the catalog's provider for a task; this registry
 * answers every provider with the candidate's adapter, and rewrites the
 * request's model id to the candidate's. Everything else the gateway sends
 * (the prompt, the sources, the schema, the output ceiling, the effort) is
 * unchanged, so the comparison is between models and nothing else.
 *
 * Each call is also measured here, below the gateway: how long it took, and
 * how many quotes a cited answer carried before the gateway's word-for-word
 * check, which is the citation precision column.
 *
 * A paid candidate needs two things, so no test run spends money by
 * accident: its provider's credentials in the environment (the same names
 * the API reads, `ENV_REFERENCE.md`), and `AI_EVALS_ALLOW_PAID=1`. CI sets
 * neither.
 */
import {
  type AiProvider,
  type EmbeddingRequest,
  type EmbeddingResult,
  type ILanguageModel,
  type ILanguageModelRegistry,
  type LanguageModelEffort,
  type LanguageModelRequest,
  type LanguageModelResult,
  type LanguageModelStreamEvent,
} from '#domain/adapters/language-model.interface';
import { verifyCitations } from '#domain/utils/quote-grounding';
import { buildLanguageModelRegistry } from '../../../src/infrastructure/ai/language-model-registry';
import {
  ScriptedLanguageModel,
  type ScriptedReplies,
} from '../../../src/infrastructure/ai/scripted-language-model';
import type { BakeOffCandidate } from './candidates';

/** One provider call, measured. No text. */
export interface MeteredCall {
  task: string;
  latencyMs: number;
  outcome: 'completed' | 'refused' | 'error';
  /** Quotes a cited answer carried, before Frapp's check. */
  quotes: number;
  /** Of those, how many are word for word in the source they name. */
  groundedQuotes: number;
}

export interface CandidateRegistry {
  registry: ILanguageModelRegistry;
  calls: MeteredCall[];
}

export interface CandidateOptions {
  /**
   * Run every generation at this effort instead of the catalog's, so one
   * model can be compared with itself at two efforts (#4903). Left out, the
   * catalog's effort stands and the run is the product's.
   */
  effort?: LanguageModelEffort;
  /**
   * Called with each request as it goes to the model, before the call. For a
   * check on what a model was shown; the caller must keep no text from it.
   */
  onRequest?: (request: LanguageModelRequest) => void;
}

export const ALLOW_PAID_ENV = 'AI_EVALS_ALLOW_PAID';

type Env = Record<string, string | undefined>;

function liveAdapter(candidate: BakeOffCandidate, env: Env): ILanguageModel {
  if (env[ALLOW_PAID_ENV] !== '1') {
    throw new Error(
      `${candidate.id} is a paid model. Set ${ALLOW_PAID_ENV}=1 to let this run spend money.`,
    );
  }
  // The API's own registry, in live mode, so a candidate is built from the
  // same environment variables the API reads.
  const adapter = buildLanguageModelRegistry({
    ...env,
    AI_PROVIDER: 'live',
  }).resolve(candidate.provider);
  if (!adapter) {
    const needs: Record<AiProvider, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      google: 'GOOGLE_VERTEX_PROJECT and GOOGLE_VERTEX_CREDENTIALS_JSON',
      // A transcription vendor: no language model here to bake off.
      assemblyai: 'a language model, which AssemblyAI is not,',
      scripted: '',
    };
    throw new Error(`${candidate.id} needs ${needs[candidate.provider]} set.`);
  }
  return adapter;
}

class MeteredModel implements ILanguageModel {
  readonly provider: AiProvider;

  constructor(
    private readonly inner: ILanguageModel,
    private readonly model: string,
    private readonly calls: MeteredCall[],
    private readonly options: CandidateOptions = {},
  ) {
    this.provider = inner.provider;
  }

  async generate(request: LanguageModelRequest): Promise<LanguageModelResult> {
    const startedAt = performance.now();
    const call: MeteredCall = {
      task: request.task,
      latencyMs: 0,
      outcome: 'error',
      quotes: 0,
      groundedQuotes: 0,
    };
    try {
      const sent: LanguageModelRequest = {
        ...request,
        model: this.model,
        ...(this.options.effort === undefined
          ? {}
          : { effort: this.options.effort }),
      };
      this.options.onRequest?.(sent);
      const result = await this.inner.generate(sent);
      call.outcome = result.outcome;
      if (result.outcome === 'completed' && request.kind === 'cited') {
        call.quotes = result.citations.length;
        call.groundedQuotes = verifyCitations(
          result.citations,
          request.sources,
        ).kept.length;
      }
      return result;
    } finally {
      call.latencyMs = performance.now() - startedAt;
      this.calls.push(call);
    }
  }

  async *stream(
    request: LanguageModelRequest,
  ): AsyncIterable<LanguageModelStreamEvent> {
    // The bake-off grades whole answers. A stream is the same call.
    const result = await this.generate(request);
    if (result.outcome === 'completed') {
      yield { type: 'text', delta: result.text };
    }
    yield { type: 'done', result };
  }

  embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    return this.inner.embed({ ...request, model: this.model });
  }
}

export function candidateRegistry(
  candidate: BakeOffCandidate,
  scriptedReplies: ScriptedReplies,
  env: Env = process.env,
  options: CandidateOptions = {},
): CandidateRegistry {
  const adapter = candidate.paid
    ? liveAdapter(candidate, env)
    : new ScriptedLanguageModel(scriptedReplies);
  const calls: MeteredCall[] = [];
  const metered = new MeteredModel(adapter, candidate.model, calls, options);
  return { registry: { resolve: () => metered }, calls };
}
