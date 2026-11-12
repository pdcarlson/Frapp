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
import {
  CORPUS_SOURCE_ADAPTERS,
  corpusAdapterFor,
  type CorpusSourceAdapter,
} from './corpus-source';

/** Stamped on the ledger row of every question's embed call. */
export const CORPUS_QUERY_PROMPT_VERSION = 'corpus.query@v1';
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
}

export type CorpusRetrievalResult =
  { status: 'ok'; passages: CorpusPassage[] } | AiUnavailable;

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
 * 4. What is left is merged by reciprocal rank fusion, with no reranker, and
 *    a source that dates (minutes) is weighted by its age.
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
    if (!query) return { status: 'ok', passages: [] };
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

    const passages = readable
      .map((candidate) => this.passage(candidate, now))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
    return { status: 'ok', passages };
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
    return {
      id: candidate.chunk_id,
      sourceType: candidate.source_type,
      sourceId: candidate.source_id,
      title: candidate.title,
      heading: candidate.heading,
      text: candidate.content,
      pageStart: candidate.page_start,
      pageEnd: candidate.page_end,
      sourceAt: candidate.source_at,
      score: fused * recencyWeight(ageDays),
      matchedBy,
    };
  }
}
