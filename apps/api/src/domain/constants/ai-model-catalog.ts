import type { AiFeatureFamily } from '../adapters/ai-call-context';
import type {
  AiProvider,
  LanguageModelEffort,
} from '../adapters/language-model.interface';

/**
 * The model catalog: one model per task (ADR-28 decision 2).
 *
 * A feature asks the AI gateway for a task by name. This file says which
 * provider and model run it, how much it may write, and what a token costs.
 * **Changing a feature's model is an edit to this file**, and the eval suite
 * is what says whether the edit is safe (the bake-off, #4311).
 *
 * A new task is a new entry here. `kind` is what the task returns, and the
 * gateway refuses a call that asks a task for another kind.
 *
 * Prices are US dollars per million tokens, which is also millionths of a
 * dollar per token, the unit the ledger keeps. The Claude prices were read
 * from Anthropic's published model table on 2026-11-11 (ADR-28, "Prices the
 * estimates used"). The embedding entry's model id and price are ADR-28's
 * planning figures and were not checked against Google's table: #4311, which
 * adds the Google adapter, confirms both. All of them are for the caps and
 * the ledger's estimate, not an invoice: the provider's bill is the bill.
 *
 * In scripted mode a call is recorded with provider `scripted` and still
 * costed at these prices, so a local run exercises the caps.
 */
interface CatalogEntryBase {
  family: AiFeatureFamily;
  provider: AiProvider;
  model: string;
  inputUsdPerMillionTokens: number;
}

export interface GenerationCatalogEntry extends CatalogEntryBase {
  kind: 'structured' | 'cited';
  maxOutputTokens: number;
  effort: LanguageModelEffort;
  outputUsdPerMillionTokens: number;
}

export interface EmbeddingCatalogEntry extends CatalogEntryBase {
  kind: 'embedding';
  dimensions: number;
}

export type AiCatalogEntry = GenerationCatalogEntry | EmbeddingCatalogEntry;

const CLAUDE_SONNET = {
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  inputUsdPerMillionTokens: 2,
  outputUsdPerMillionTokens: 10,
} as const;

export const AI_MODEL_CATALOG = {
  /** An officer's notes in, minutes in the chapter's template out (#4312). */
  'minutes.draft': {
    ...CLAUDE_SONNET,
    family: 'meetings',
    kind: 'structured',
    maxOutputTokens: 16_000,
    effort: 'medium',
  },
  /** Tasks proposed from a minutes draft, each with the line it came from (#4313). */
  'minutes.suggest-tasks': {
    ...CLAUDE_SONNET,
    family: 'meetings',
    kind: 'structured',
    maxOutputTokens: 8_000,
    effort: 'medium',
  },
  /** A member's question, answered from the sources retrieved for it (#450). */
  'ask.answer': {
    ...CLAUDE_SONNET,
    family: 'ask',
    kind: 'cited',
    maxOutputTokens: 4_000,
    effort: 'low',
  },
  /**
   * Corpus embeddings (#720). Gemini Embedding at 1,536 dimensions, decision
   * 3. Model id and price unverified (see above). The Google adapter arrives with #4311; until then no adapter serves
   * this outside scripted mode, and the gateway answers "not available".
   */
  'corpus.embed': {
    family: 'corpus',
    kind: 'embedding',
    provider: 'google',
    model: 'gemini-embedding-001',
    dimensions: 1536,
    inputUsdPerMillionTokens: 0.15,
  },
} as const satisfies Record<string, AiCatalogEntry>;

export type AiTaskName = keyof typeof AI_MODEL_CATALOG;

type TasksOfKind<K extends AiCatalogEntry['kind']> = {
  [T in AiTaskName]: (typeof AI_MODEL_CATALOG)[T]['kind'] extends K ? T : never;
}[AiTaskName];

export type AiStructuredTaskName = TasksOfKind<'structured'>;
export type AiCitedTaskName = TasksOfKind<'cited'>;
export type AiEmbeddingTaskName = TasksOfKind<'embedding'>;

export function aiCatalogEntry(task: AiTaskName): AiCatalogEntry {
  return AI_MODEL_CATALOG[task];
}

/**
 * What a call costs at the catalog's prices, in millionths of a US dollar,
 * rounded up so a cap is never under-counted.
 */
export function aiCostMicroUsd(
  entry: AiCatalogEntry,
  tokens: { inputTokens: number; outputTokens: number },
): number {
  const output =
    entry.kind === 'embedding'
      ? 0
      : tokens.outputTokens * entry.outputUsdPerMillionTokens;
  return Math.ceil(
    tokens.inputTokens * entry.inputUsdPerMillionTokens + output,
  );
}
