import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { AiCallDescriptor } from '#domain/adapters/ai-call-context';
import {
  AI_CONSENT_CHECK,
  type IAiConsentCheck,
} from '#domain/adapters/ai-consent-check.interface';
import { AI_MODEL_CATALOG } from '#domain/constants/ai-model-catalog';
import { SystemRoleKeys } from '#domain/constants/permissions';
import type { AiRunRef } from '#domain/entities/ai-run.entity';
import type {
  CorpusChunkWrite,
  CorpusSource,
} from '#domain/entities/corpus.entity';
import {
  CORPUS_REPOSITORY,
  type ICorpusRepository,
} from '#domain/repositories/corpus.repository.interface';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import {
  ROLE_REPOSITORY,
  type IRoleRepository,
} from '#domain/repositories/role.repository.interface';
import { isAiEnabled } from '#domain/utils/ai-enabled';
import {
  chunkSections,
  corpusEmbeddingText,
} from '#domain/utils/corpus-chunker';
import { corpusFingerprint } from '#domain/utils/corpus-ranking';
import { AiGatewayService, type AiUnavailable } from '../ai/ai-gateway.service';
import {
  AiRunFailure,
  AiRunRegistry,
  type AiRunContext,
  type AiRunHandler,
} from '../ai-run-registry';
import { AiRunService } from '../ai-run.service';
import {
  CORPUS_SOURCE_ADAPTERS,
  corpusAdapterFor,
  type CorpusSourceAdapter,
} from './corpus-source';

export const CORPUS_INDEX_RUN_KIND = 'corpus_index';
const EMBED_TASK = 'corpus.embed';
/** Stamped on the ledger row of every indexing embed call. */
export const CORPUS_INDEX_PROMPT_VERSION = 'corpus.index@v1';

/** Sources handed to the queue per sweep. */
const SWEEP_LIMIT = 25;
/** Passages per embed call, and per write to the database. */
const EMBED_BATCH = 16;
/** A source that would make more passages than this is skipped as too large. */
export const CORPUS_MAX_CHUNKS_PER_SOURCE = 1000;

const MINUTE = 60_000;
/** How long the sweep stands down after the server says AI is not there. */
const SERVER_PAUSE_MS = 15 * MINUTE;
/**
 * How long a chapter's sources wait after its switch refused. Short, because
 * it is also how long a president waits for indexing to start after turning
 * the switch on; one cheap update per chapter that has it off.
 */
const CONSENT_RETRY_MS = 10 * MINUTE;
/** How long a chapter's sources wait after a spending cap refused. */
const SPEND_RETRY_MS = 6 * 60 * MINUTE;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36;
}

/**
 * Keeps the AI corpus index in step with its sources (#720).
 *
 * The database already knows which sources need indexing: triggers on the
 * source tables keep `corpus_sources`, and delete a source's passages the
 * moment it changes or goes. This service does the rest in two steps.
 *
 * - **The sweep** (`sweep`, once a minute from `CorpusIndexSweepService`)
 *   claims sources that need indexing and queues one AI run for each. It
 *   queues nothing while `AI_ENABLED` is off, and nothing for a chapter whose
 *   switch is off, so a server or a chapter that never turned AI on never
 *   sees a run.
 * - **The run** (`corpus_index`, on the shared AI run queue) reads the
 *   source, cuts it into passages, embeds them through the gateway and writes
 *   them, guarded by the source's revision: a run that read an older revision
 *   writes nothing.
 *
 * Whose run it is: indexing acts for the member who uploaded or posted the
 * source while they are still in the chapter, and for the president
 * otherwise (the officer who turns the chapter's AI on). It sends the
 * chapter's own records, so the `corpus` family stands behind the chapter's
 * switch and not the acting member's own answer on the sheet
 * (`spec/behavior/ai.md` § Consent). A member's question is embedded under
 * another task, `ask.embed-query`, which does need the asker's yes.
 * Who may read a passage is decided at retrieval, never here.
 */
@Injectable()
export class CorpusIngestService implements AiRunHandler, OnModuleInit {
  readonly kind = CORPUS_INDEX_RUN_KIND;
  readonly label = 'Indexing for search';
  readonly actsForMember = true;

  private readonly logger = new Logger(CorpusIngestService.name);
  /** No sweep before this time: the server said AI is off or has no provider. */
  private pausedUntil = 0;

  constructor(
    @Inject(CORPUS_REPOSITORY) private readonly corpus: ICorpusRepository,
    @Inject(CORPUS_SOURCE_ADAPTERS)
    private readonly adapters: readonly CorpusSourceAdapter[],
    @Inject(MEMBER_REPOSITORY) private readonly members: IMemberRepository,
    @Inject(ROLE_REPOSITORY) private readonly roles: IRoleRepository,
    @Inject(AI_CONSENT_CHECK) private readonly consent: IAiConsentCheck,
    private readonly gateway: AiGatewayService,
    private readonly runs: AiRunService,
    private readonly registry: AiRunRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /** What this build's passages are made with. */
  fingerprint(): string {
    const entry = AI_MODEL_CATALOG[EMBED_TASK];
    return corpusFingerprint(entry.model, entry.dimensions);
  }

  /**
   * Queues an indexing run for each source that needs one. Returns how many
   * were queued.
   */
  async sweep(now = new Date()): Promise<number> {
    if (!isAiEnabled() || now.getTime() < this.pausedUntil) return 0;

    const fingerprint = this.fingerprint();
    const sources = await this.corpus.claimSources(
      fingerprint,
      now,
      SWEEP_LIMIT,
    );
    const byChapter = new Map<string, CorpusSource[]>();
    for (const source of sources) {
      const list = byChapter.get(source.chapter_id) ?? [];
      list.push(source);
      byChapter.set(source.chapter_id, list);
    }

    let queued = 0;
    for (const [chapterId, chapterSources] of byChapter) {
      const actors = await this.actorsOf(chapterId);
      const allowed = new Map<string, boolean>();
      for (const source of chapterSources) {
        const actor =
          source.changed_by && actors.members.has(source.changed_by)
            ? source.changed_by
            : actors.president;
        if (actor && !allowed.has(actor)) {
          allowed.set(actor, await this.chapterAllows(chapterId, actor));
        }
        // Nobody to act for, or the chapter's switch is off: nothing of this
        // chapter's is tried, so all of it waits and no try is counted.
        if (!actor || !allowed.get(actor)) {
          await this.corpus.postponeChapter(
            chapterId,
            new Date(now.getTime() + CONSENT_RETRY_MS),
          );
          break;
        }
        await this.runs.enqueue({
          chapterId,
          kind: CORPUS_INDEX_RUN_KIND,
          // The revision and the fingerprint are in the key, so a source
          // that changed, or a model change, is a new run and not the old
          // run's "already done". So is when it was last indexed: a model
          // change that is later reverted comes back to a fingerprint an
          // old, finished run already used.
          dedupeKey: `source:${source.id}:${source.revision}:${fingerprint}:${
            source.indexed_at ? Date.parse(source.indexed_at) : 0
          }`,
          requestedBy: null,
          actingUserId: actor,
          input: { corpus_source_id: source.id, revision: source.revision },
        });
        queued += 1;
      }
    }
    return queued;
  }

  async run({ run, input, signal }: AiRunContext): Promise<AiRunRef> {
    const sourceId = input.corpus_source_id;
    const revision = input.revision;
    if (!isUuid(sourceId) || typeof revision !== 'number') {
      throw new AiRunFailure(
        'handler_failed',
        'corpus_index run has no source',
      );
    }
    const superseded: AiRunRef = { corpus_source_id: sourceId, chunk_count: 0 };

    const source = await this.corpus.findSource(run.chapter_id, sourceId);
    // Deleted, or changed again since this run was queued: the newer
    // revision has its own run.
    if (!source || source.revision !== revision) return superseded;

    const fingerprint = this.fingerprint();
    const adapter = corpusAdapterFor(this.adapters, source.source_type);
    if (!adapter) {
      throw new AiRunFailure(
        'handler_failed',
        `no corpus adapter for source type ${source.source_type}`,
      );
    }

    const read = await adapter.read(run.chapter_id, source.source_id);
    if (read.status === 'gone') {
      await this.corpus.deleteSource(run.chapter_id, source.id);
      return superseded;
    }
    const skip = async (reason: Parameters<typeof this.finish>[3]) => {
      await this.finish(source, fingerprint, null, reason, 0);
      return superseded;
    };
    if (read.status === 'skipped') return skip(read.reason);

    const { content } = read;
    const chunks = chunkSections(content.sections);
    if (chunks.length === 0) return skip('no_text');
    if (chunks.length > CORPUS_MAX_CHUNKS_PER_SOURCE) return skip('too_large');

    const entry = AI_MODEL_CATALOG[EMBED_TASK];
    for (let start = 0; start < chunks.length; start += EMBED_BATCH) {
      const batch = chunks.slice(start, start + EMBED_BATCH);
      const embedded = await this.gateway.embed(
        EMBED_TASK,
        {
          texts: batch.map((chunk) =>
            corpusEmbeddingText(content.title, chunk),
          ),
          promptVersion: CORPUS_INDEX_PROMPT_VERSION,
          purpose: 'document',
          signal,
        },
        {
          chapterId: run.chapter_id,
          // The queue refuses a member-reading run without one.
          actingUserId: run.acting_user_id as string,
          runId: run.id,
        },
      );
      if (embedded.status !== 'ok') {
        throw await this.unavailable(run.chapter_id, embedded);
      }
      if (
        embedded.vectors.length !== batch.length ||
        embedded.vectors.some((vector) => vector.length !== entry.dimensions)
      ) {
        // A provider that answers with the wrong shape may answer right
        // next time; nothing of this batch is written.
        throw new AiRunFailure(
          'handler_failed',
          `embedding answer was not ${batch.length} vectors of ${entry.dimensions}`,
          true,
        );
      }
      const rows: CorpusChunkWrite[] = batch.map((chunk, index) => ({
        chunk_index: start + index,
        heading: chunk.heading,
        content: chunk.content,
        page_start: chunk.pageStart,
        page_end: chunk.pageEnd,
        embedding: embedded.vectors[index],
      }));
      const written = await this.corpus.writeChunks(
        source.id,
        revision,
        start === 0,
        embedded.model,
        rows,
      );
      if (!written) return superseded;
    }

    const finished = await this.finish(
      source,
      fingerprint,
      content,
      null,
      chunks.length,
    );
    return {
      corpus_source_id: source.id,
      chunk_count: finished ? chunks.length : 0,
    };
  }

  private finish(
    source: CorpusSource,
    fingerprint: string,
    content: { title: string; sourceAt: string; decays: boolean } | null,
    skipReason: CorpusSource['skip_reason'],
    chunkCount: number,
  ): Promise<boolean> {
    return this.corpus.finishSource({
      sourceId: source.id,
      revision: source.revision,
      fingerprint,
      title: content?.title ?? source.title,
      sourceAt: content?.sourceAt ?? source.source_at,
      decays: content?.decays ?? source.decays,
      chunkCount,
      skipReason,
    });
  }

  /**
   * The gateway would not make the call. Holds the chapter's sources (or the
   * whole sweep) for a while, so the refusal is not asked again every
   * minute, and returns the failure the run ends with. None is retried by
   * the queue: the sweep comes back to the source when its wait is over.
   */
  private async unavailable(
    chapterId: string,
    result: AiUnavailable,
  ): Promise<AiRunFailure> {
    const now = Date.now();
    if (result.reason === 'spend_cap') {
      await this.corpus.postponeChapter(
        chapterId,
        new Date(now + SPEND_RETRY_MS),
      );
      return new AiRunFailure('spend_limit', `embed refused: ${result.detail}`);
    }
    if (result.reason === 'consent') {
      await this.corpus.postponeChapter(
        chapterId,
        new Date(now + CONSENT_RETRY_MS),
      );
      return new AiRunFailure(
        result.detail === 'member_declined'
          ? 'not_permitted'
          : 'ai_unavailable',
        `embed refused: ${result.detail}`,
      );
    }
    // `disabled` or `not_configured`: true of every chapter on this server.
    // The chapter's sources get their try back, like any other refusal.
    await this.corpus.postponeChapter(
      chapterId,
      new Date(now + SERVER_PAUSE_MS),
    );
    this.pausedUntil = now + SERVER_PAUSE_MS;
    this.logger.warn(
      `Corpus indexing paused for 15 minutes: AI is ${result.reason} on this server`,
    );
    return new AiRunFailure(
      'ai_unavailable',
      `embed refused: ${result.reason}`,
    );
  }

  /** The chapter's current members, and its president when it has one. */
  private async actorsOf(
    chapterId: string,
  ): Promise<{ members: Set<string>; president: string | null }> {
    const [members, presidentRole] = await Promise.all([
      this.members.findByChapter(chapterId),
      this.roles.findByChapterAndSystemKey(chapterId, SystemRoleKeys.PRESIDENT),
    ]);
    const president = presidentRole
      ? members.find((member) => member.role_ids.includes(presidentRole.id))
      : undefined;
    return {
      members: new Set(members.map((member) => member.user_id)),
      president: president?.user_id ?? null,
    };
  }

  /**
   * Asks the gateway's own consent check, before queueing, whether an
   * indexing call for this chapter would be let through. The gateway asks
   * again when the run makes the call; this only keeps a chapter that never
   * turned AI on from filling the queue with runs that would all be refused.
   */
  private async chapterAllows(
    chapterId: string,
    actingUserId: string,
  ): Promise<boolean> {
    const entry = AI_MODEL_CATALOG[EMBED_TASK];
    const call: AiCallDescriptor = {
      chapterId,
      actingUserId,
      task: EMBED_TASK,
      family: entry.family,
      provider: entry.provider,
      model: entry.model,
      promptVersion: CORPUS_INDEX_PROMPT_VERSION,
    };
    return (await this.consent.check(call)).allowed;
  }
}
