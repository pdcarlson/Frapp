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
 * planning figures and were not checked against Google's table. The Google
 * adapter exists (#4311); both are confirmed at Google before its first
 * paid call, and corrected here if they differ. All of them are for the caps and
 * the ledger's estimate, not an invoice: the provider's bill is the bill.
 *
 * In scripted mode a call is recorded with provider `scripted` and still
 * costed at these prices, so a local run exercises the caps.
 */
interface CatalogEntryBase {
  family: AiFeatureFamily;
  provider: AiProvider;
  model: string;
}

export interface GenerationCatalogEntry extends CatalogEntryBase {
  kind: 'structured' | 'cited' | 'agent';
  maxOutputTokens: number;
  effort: LanguageModelEffort;
  /**
   * The effort when the member asks the task to think harder. Only a task
   * that offers that has one; without it the task always runs at `effort`.
   */
  effortMore?: LanguageModelEffort;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

export interface EmbeddingCatalogEntry extends CatalogEntryBase {
  kind: 'embedding';
  dimensions: number;
  inputUsdPerMillionTokens: number;
}

/**
 * A recording in, its transcript out (#712). Priced by the hour of audio,
 * not by the token, and served by a transcriber
 * (`domain/adapters/transcription.interface.ts`) through
 * `AiTranscriptionService`, never by `AiGatewayService`.
 */
export interface TranscriptionCatalogEntry extends CatalogEntryBase {
  kind: 'transcription';
  usdPerAudioHour: number;
}

/** A task priced by the token: what `AiGatewayService` serves. */
export type AiTokenCatalogEntry =
  GenerationCatalogEntry | EmbeddingCatalogEntry;

export type AiCatalogEntry = AiTokenCatalogEntry | TranscriptionCatalogEntry;

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
  /**
   * Tasks proposed from a minutes draft, each with the line it came from.
   * Only the bake-off runs it: suggested tasks as built (#4313) are the
   * posted minutes' action items as written, with no model call.
   */
  'minutes.suggest-tasks': {
    ...CLAUDE_SONNET,
    family: 'meetings',
    kind: 'structured',
    maxOutputTokens: 8_000,
    effort: 'medium',
  },
  /**
   * Which live reads a question needs before it is answered (#450): the
   * names of at most a few of Ask's read-only tools, picked from the
   * question alone. Small on purpose; a cheaper model is the bake-off's call.
   */
  'ask.plan': {
    ...CLAUDE_SONNET,
    family: 'ask',
    kind: 'structured',
    maxOutputTokens: 300,
    effort: 'low',
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
   * One round of Ask's tool loop (#4899): the model is offered the read
   * tools this member may use and either calls some or writes the answer.
   * A question is several of these, each admitted against the caps on its
   * own. Medium effort, where the plan page starts; the bake-off (#4903)
   * decides the model and the effort with numbers.
   */
  'ask.agent': {
    ...CLAUDE_SONNET,
    family: 'ask',
    kind: 'agent',
    maxOutputTokens: 4_000,
    effort: 'medium',
    // "Think harder" (`AskEffort` `more`), with the loop's wider bounds.
    effortMore: 'high',
  },
  /**
   * An officer's request, read into one action and its details (#718). It is
   * shown the request and the actions that officer may take, and nothing
   * else. Small; a cheaper model is the bake-off's call.
   */
  'act.plan': {
    ...CLAUDE_SONNET,
    family: 'ask',
    kind: 'structured',
    maxOutputTokens: 600,
    effort: 'low',
  },
  /**
   * A name the roster lookup could not place, matched to a member of the
   * chapter or to nobody (#718). Runs only when a typed name is left over.
   */
  'act.match': {
    ...CLAUDE_SONNET,
    family: 'ask',
    kind: 'structured',
    maxOutputTokens: 400,
    effort: 'low',
  },
  /**
   * Catch me up (#3946): a channel's new messages or one thread in, a few
   * points out, each naming the message it rests on with a quote the caller
   * checks. In the `ask` family: a summary is the member's own use of AI, so
   * it stands behind the Ask switch and the member's yes.
   */
  'chat.catch-up': {
    ...CLAUDE_SONNET,
    family: 'ask',
    kind: 'structured',
    maxOutputTokens: 2_000,
    effort: 'low',
  },
  /**
   * Member nudges (#4781): a short list of facts about one of a member's
   * tasks in, a card's title, line and starting point out, which the caller
   * checks against the facts. In the `ask` family: the card is the AI
   * reading the member's own tasks for them, as Ask's "your tasks" does, so
   * it stands behind the Ask switch and the member's yes.
   */
  'nudges.write': {
    ...CLAUDE_SONNET,
    family: 'ask',
    kind: 'structured',
    maxOutputTokens: 400,
    effort: 'low',
  },
  /**
   * Corpus embeddings (#720). Gemini Embedding at 1,536 dimensions, decision
   * 3. Model id and price unverified (see above). Served by the Google adapter
   * once `GOOGLE_VERTEX_PROJECT` and its key are set; until then, outside
   * scripted mode, the gateway answers "not available".
   */
  'corpus.embed': {
    family: 'corpus',
    kind: 'embedding',
    provider: 'google',
    model: 'gemini-embedding-001',
    dimensions: 1536,
    inputUsdPerMillionTokens: 0.15,
  },
  /**
   * A member's question, embedded to search the corpus (#720). The same
   * model and width as `corpus.embed`, or the two could not be compared. It
   * is its own task because it is a different act: indexing sends the
   * chapter's records and stands behind the chapter's switch, and this sends
   * a member's own words, so it sits in the `ask` family and the gateway
   * asks for that member's yes.
   */
  'ask.embed-query': {
    family: 'ask',
    kind: 'embedding',
    provider: 'google',
    model: 'gemini-embedding-001',
    dimensions: 1536,
    inputUsdPerMillionTokens: 0.15,
  },
  /**
   * A meeting's recording, written out with speaker labels (#712).
   *
   * **The vendor is not chosen.** ADR-28 leaves it to a bake-off on one real
   * recorded meeting between AssemblyAI and Google's transcription model, and
   * #712 stays open for it. Both adapters exist. This entry names AssemblyAI
   * because it is the only one of the two that takes a whole chapter meeting
   * in one request: Google's model stops at 30 minutes with speaker labels,
   * and Frapp does not cut audio into pieces. Moving it to Google is this
   * entry's `provider`, `model` and price (`gemini-3.5-transcribe`, about
   * $0.35 an hour), and taking AssemblyAI off the AI sheet
   * (`ai-consent-sheet.ts`).
   *
   * The model id and the price ($0.21 an hour, and $0.02 for speaker labels)
   * are the research's figures of 2026-11-11, read from search results, and
   * are confirmed at the vendor before the first paid call.
   */
  'meetings.transcribe': {
    family: 'meetings',
    kind: 'transcription',
    provider: 'assemblyai',
    model: 'universal-3-5-pro',
    usdPerAudioHour: 0.23,
  },
} as const satisfies Record<string, AiCatalogEntry>;

export type AiTaskName = keyof typeof AI_MODEL_CATALOG;

type TasksOfKind<K extends AiCatalogEntry['kind']> = {
  [T in AiTaskName]: (typeof AI_MODEL_CATALOG)[T]['kind'] extends K ? T : never;
}[AiTaskName];

export type AiStructuredTaskName = TasksOfKind<'structured'>;
export type AiCitedTaskName = TasksOfKind<'cited'>;
export type AiAgentTaskName = TasksOfKind<'agent'>;
export type AiEmbeddingTaskName = TasksOfKind<'embedding'>;
export type AiTranscriptionTaskName = TasksOfKind<'transcription'>;

export function aiCatalogEntry(task: AiTaskName): AiCatalogEntry {
  return AI_MODEL_CATALOG[task];
}

/**
 * What a call costs at the catalog's prices, in millionths of a US dollar,
 * rounded up so a cap is never under-counted.
 */
export function aiCostMicroUsd(
  entry: AiTokenCatalogEntry,
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

/**
 * What transcribing `seconds` of audio costs at the catalog's price, in
 * millionths of a US dollar, rounded up.
 */
export function aiTranscriptionCostMicroUsd(
  entry: TranscriptionCatalogEntry,
  seconds: number,
): number {
  return Math.ceil(
    (Math.max(0, seconds) * entry.usdPerAudioHour * 1_000_000) / 3600,
  );
}
