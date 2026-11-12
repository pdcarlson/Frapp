import { Inject, Injectable } from '@nestjs/common';
import { stripLoneSurrogates } from '#domain/utils/corpus-chunker';
import type { CorpusCandidate } from '#domain/entities/corpus.entity';
import {
  CORPUS_REPOSITORY,
  type ICorpusRepository,
} from '#domain/repositories/corpus.repository.interface';
import {
  reciprocalRankFusion,
  recencyWeight,
} from '#domain/utils/corpus-ranking';
import { AiGatewayService, type AiUnavailable } from '../ai/ai-gateway.service';
import { CHAT_SOURCE_TYPE } from './chat-message-corpus-source';
import {
  CORPUS_SOURCE_ADAPTERS,
  corpusAdapterFor,
  type CorpusSourceAdapter,
} from './corpus-source';

function byScore(a: CorpusPassage, b: CorpusPassage): number {
  return b.score - a.score || a.id.localeCompare(b.id);
}

/** Stamped on the ledger row of every question's embed call. */
const CORPUS_QUERY_PROMPT_VERSION = 'corpus.query@v1';
/**
 * What a chat passage's score is multiplied by: chat ranks below official
 * sources (`ai.md` § Chat as a source), so a chat passage has to match much
 * better than a document or minutes to take its place.
 */
const CHAT_RANK_WEIGHT = 0.5;
/** How many candidates each half (nearest, best words) contributes. */
const CANDIDATES_PER_HALF = 40;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
/** A question longer than this is cut before it is embedded and matched. */
const MAX_QUERY_CHARS = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CorpusRetrievalRequest {
  /**
   * The active chapter the request's guard resolved, or the run's chapter.
   * Never an id from a request body or from a model.
   */
  chapterId: string;
  /** The asker, or the member a background run acts for. */
  actingUserId: string;
  query: string;
  /** Passages wanted. Default 8, at most 20. */
  limit?: number;
  /** The AI run this retrieval belongs to, when it is background work. */
  runId?: string;
  signal?: AbortSignal;
}

/** A retrieved passage with what a citation needs to name and link it. */
export interface CorpusPassage {
  /** The passage's id: what a model cites, and what a quote is checked against. */
  id: string;
  sourceType: string;
  sourceId: string;
  /** The source's title: a document's name, "Exec meeting minutes: …". */
  title: string;
  /** The section the passage sits under, when the source has sections. */
  heading: string | null;
  text: string;
  pageStart: number | null;
  pageEnd: number | null;
  /** When the source is from. */
  sourceAt: string | null;
  /** Higher is better. Comparable only within one retrieval. */
  score: number;
  /** Which halves found it: `semantic` (nearest), `words` (exact terms), or both. */
  matchedBy: Array<'semantic' | 'words'>;
  /**
   * Chat (#4314): the channel and the passage's first message, which a
   * citation names and opens. Null on documents and minutes. A chat
   * passage's `sourceId` is its conversation window, not a message.
   */
  channelId: string | null;
  messageId: string | null;
  /** Chat: whose messages it holds, for the last consent check. Empty elsewhere. */
  authorIds: string[];
  /** Chat: how many messages it holds. Null elsewhere. */
  messageCount: number | null;
}

export type CorpusRetrievalResult =
  | {
      status: 'ok';
      /** Official sources first, then chat; each by score. */
      passages: CorpusPassage[];
      /**
       * How many messages were left out of the conversations the chat
       * passages came from because their authors had not said yes (or have
       * since said No). Never whose, and nothing from a channel the asker
       * cannot open. 0 when none.
       */
      leftOutMessages: number;
    }
  | AiUnavailable;

/**
 * Hybrid retrieval over the AI corpus (#720, ADR-28 decision 3,
 * `spec/architecture/README.md` § 13 Retrieval).
 *
 * One question, one chapter, one acting member:
 *
 * 1. The question is embedded through the gateway, so the server switch, the
 *    chapter's switch, the member's own answer and the caps all apply to a
 *    retrieval as to any other AI call. A refusal comes back as it is and
 *    nothing is read.
 * 2. The database returns the nearest passages by embedding and the best by
 *    words, for that chapter only and only if the member belongs to it
 *    (`match_corpus_chunks`).
 * 3. Every passage whose source the member could not open is dropped, by the
 *    source's own rule (`CorpusSourceAdapter.readableBy`): minutes by
 *    `MeetingService.canRead`, documents by who may open the library. A
 *    source type this build has no adapter for is dropped whole.
 * 4. A source whose passages hold more than one person's words checks each
 *    passage (`CorpusSourceAdapter.admit`): chat drops a passage by an author
 *    who no longer says yes, or by someone the asker blocked (#4314).
 * 5. What is left is merged by reciprocal rank fusion, with no reranker; a
 *    source that dates (minutes, chat) is weighted by its age, and chat by
 *    {@link CHAT_RANK_WEIGHT}. The passages come back official first, then
 *    chat, with how many messages the chat they came from left out.
 *
 * This is a service, not a route: Ask (#450) and the features after it call
 * it and hand the passages to the gateway as sources.
 */
@Injectable()
export class CorpusRetrievalService {
  constructor(
    @Inject(CORPUS_REPOSITORY) private readonly corpus: ICorpusRepository,
    @Inject(CORPUS_SOURCE_ADAPTERS)
    private readonly adapters: readonly CorpusSourceAdapter[],
    private readonly gateway: AiGatewayService,
  ) {}

  async retrieve(
    request: CorpusRetrievalRequest,
    now = new Date(),
  ): Promise<CorpusRetrievalResult> {
    const query = stripLoneSurrogates(
      request.query.trim().slice(0, MAX_QUERY_CHARS),
    );
    if (!query) return { status: 'ok', passages: [], leftOutMessages: 0 };
    const limit = Math.min(
      Math.max(Math.trunc(request.limit ?? DEFAULT_LIMIT), 1),
      MAX_LIMIT,
    );

    const embedded = await this.gateway.embed(
      // Not `corpus.embed`: a question is the asker's own use of AI, and
      // this task makes the gateway ask for their yes.
      'ask.embed-query',
      {
        texts: [query],
        promptVersion: CORPUS_QUERY_PROMPT_VERSION,
        purpose: 'query',
        signal: request.signal,
      },
      {
        chapterId: request.chapterId,
        actingUserId: request.actingUserId,
        ...(request.runId === undefined ? {} : { runId: request.runId }),
      },
    );
    if (embedded.status !== 'ok') return embedded;

    const candidates = await this.corpus.match({
      chapterId: request.chapterId,
      userId: request.actingUserId,
      query,
      embedding: embedded.vectors[0],
      embeddingModel: embedded.model,
      limit: CANDIDATES_PER_HALF,
    });
    const readable = await this.readable(
      request.chapterId,
      request.actingUserId,
      candidates,
    );
    const { admitted, withheldBySource } = await this.admitted(
      request.chapterId,
      request.actingUserId,
      readable,
    );

    const top = admitted
      .map((candidate) => this.passage(candidate, now))
      .sort(byScore)
      .slice(0, limit);
    // Official sources reach a model first, then chat (C8).
    const passages = [
      ...top.filter((passage) => passage.sourceType !== CHAT_SOURCE_TYPE),
      ...top.filter((passage) => passage.sourceType === CHAT_SOURCE_TYPE),
    ];
    return {
      status: 'ok',
      passages,
      leftOutMessages: this.leftOut(passages, admitted, withheldBySource),
    };
  }

  /**
   * Each source's passage-level check (`CorpusSourceAdapter.admit`), for the
   * sources that have one: chat drops a passage whose author no longer says
   * yes, or whom the asker blocked.
   */
  private async admitted(
    chapterId: string,
    userId: string,
    candidates: readonly CorpusCandidate[],
  ): Promise<{
    admitted: CorpusCandidate[];
    withheldBySource: Map<string, number>;
  }> {
    const byType = new Map<string, CorpusCandidate[]>();
    for (const candidate of candidates) {
      const list = byType.get(candidate.source_type) ?? [];
      list.push(candidate);
      byType.set(candidate.source_type, list);
    }
    const kept = new Set<string>();
    const withheldBySource = new Map<string, number>();
    await Promise.all(
      [...byType].map(async ([type, list]) => {
        const adapter = corpusAdapterFor(this.adapters, type);
        if (!adapter?.admit) {
          for (const candidate of list) kept.add(candidate.chunk_id);
          return;
        }
        const admission = await adapter.admit(chapterId, userId, list);
        for (const id of admission.admitted) kept.add(id);
        for (const [sourceId, count] of admission.withheldBySource) {
          withheldBySource.set(sourceId, count);
        }
      }),
    );
    return {
      admitted: candidates.filter((candidate) => kept.has(candidate.chunk_id)),
      withheldBySource,
    };
  }

  /**
   * Messages left out of the conversations the answer draws on: for each
   * chat window a returned passage came from, what indexing left out of it
   * plus what was withheld from it just now because an author said No.
   */
  private leftOut(
    passages: readonly CorpusPassage[],
    admitted: readonly CorpusCandidate[],
    withheldBySource: ReadonlyMap<string, number>,
  ): number {
    const windows = new Set(
      passages
        .filter((passage) => passage.sourceType === CHAT_SOURCE_TYPE)
        .map((passage) => passage.sourceId),
    );
    let total = 0;
    for (const window of windows) {
      const indexedLeftOut =
        admitted.find((candidate) => candidate.source_id === window)
          ?.left_out_count ?? 0;
      total += indexedLeftOut + (withheldBySource.get(window) ?? 0);
    }
    return total;
  }

  /** The candidates whose source the member could open, by each source's rule. */
  private async readable(
    chapterId: string,
    userId: string,
    candidates: readonly CorpusCandidate[],
  ): Promise<CorpusCandidate[]> {
    const idsByType = new Map<string, Set<string>>();
    for (const candidate of candidates) {
      const ids = idsByType.get(candidate.source_type) ?? new Set<string>();
      ids.add(candidate.source_id);
      idsByType.set(candidate.source_type, ids);
    }
    const allowed = new Map<string, Set<string>>();
    await Promise.all(
      [...idsByType].map(async ([type, ids]) => {
        const adapter = corpusAdapterFor(this.adapters, type);
        allowed.set(
          type,
          adapter
            ? await adapter.readableBy(chapterId, userId, [...ids])
            : new Set(),
        );
      }),
    );
    return candidates.filter((candidate) =>
      allowed.get(candidate.source_type)?.has(candidate.source_id),
    );
  }

  private passage(candidate: CorpusCandidate, now: Date): CorpusPassage {
    const fused = reciprocalRankFusion([
      candidate.dense_rank,
      candidate.sparse_rank,
    ]);
    const ageDays =
      candidate.decays && candidate.source_at
        ? (now.getTime() - new Date(candidate.source_at).getTime()) / DAY_MS
        : 0;
    const matchedBy: CorpusPassage['matchedBy'] = [];
    if (candidate.dense_rank !== null) matchedBy.push('semantic');
    if (candidate.sparse_rank !== null) matchedBy.push('words');
    const chat = candidate.source_type === CHAT_SOURCE_TYPE;
    return {
      id: candidate.chunk_id,
      sourceType: candidate.source_type,
      sourceId: candidate.source_id,
      title: candidate.title,
      heading: candidate.heading,
      text: candidate.content,
      pageStart: candidate.page_start,
      pageEnd: candidate.page_end,
      // A chat passage is from when its first message was sent.
      sourceAt: chat
        ? (candidate.anchor_at ?? candidate.source_at)
        : candidate.source_at,
      score: fused * recencyWeight(ageDays) * (chat ? CHAT_RANK_WEIGHT : 1),
      matchedBy,
      channelId: chat ? candidate.channel_id : null,
      messageId: chat ? candidate.anchor_id : null,
      authorIds: chat ? (candidate.author_ids ?? []) : [],
      messageCount: chat ? candidate.message_count : null,
    };
  }
}
