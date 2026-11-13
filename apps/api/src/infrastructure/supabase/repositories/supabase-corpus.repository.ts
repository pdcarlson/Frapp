import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import { SupabaseQueryError } from '../supabase-query-error';
import type {
  CorpusCandidate,
  CorpusChunkWrite,
  CorpusSource,
} from '#domain/entities/corpus.entity';
import type {
  ChatWindowRead,
  FinishCorpusSourceInput,
  CorpusMatchFilter,
  CorpusSourceChunks,
  ICorpusRepository,
  MatchCorpusInput,
} from '#domain/repositories/corpus.repository.interface';

/** A vector as pgvector reads it from text. */
function vectorLiteral(values: readonly number[]): string {
  return `[${values.join(',')}]`;
}

/** The search's narrowing as the function's arguments; none when unnarrowed. */
function matchFilterArgs(filter: CorpusMatchFilter | undefined): {
  p_source_types?: string[];
  p_channel_ids?: string[];
  p_author_id?: string;
  p_since?: string;
  p_until?: string;
} {
  if (!filter) return {};
  return {
    ...(filter.sourceTypes ? { p_source_types: [...filter.sourceTypes] } : {}),
    ...(filter.channelIds ? { p_channel_ids: [...filter.channelIds] } : {}),
    ...(filter.authorId ? { p_author_id: filter.authorId } : {}),
    ...(filter.since ? { p_since: filter.since } : {}),
    ...(filter.until ? { p_until: filter.until } : {}),
  };
}

/**
 * The AI corpus tables through the service role (#720).
 *
 * Passages are read only through `match_corpus_chunks` and
 * `read_corpus_source_chunks` (#4900), which take the
 * chapter and the acting member and return nothing for a member of another
 * chapter, and written only through `write_corpus_chunks`, which takes the
 * chapter from the source row. No query here selects from `corpus_chunks`
 * directly, so there is no passage read that could forget the chapter.
 * (`20261112165050_ai_corpus.sql` has the SQL, and the PGlite gate runs it.)
 */
@Injectable()
export class SupabaseCorpusRepository implements ICorpusRepository {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async claimSources(
    fingerprint: string,
    now: Date,
    limit: number,
  ): Promise<CorpusSource[]> {
    const { data, error } = await this.supabase.rpc('claim_corpus_sources', {
      p_fingerprint: fingerprint,
      p_now: now.toISOString(),
      p_limit: limit,
    });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findSource(
    chapterId: string,
    id: string,
  ): Promise<CorpusSource | null> {
    const { data, error } = await this.supabase
      .from('corpus_sources')
      .select('*')
      .eq('chapter_id', chapterId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new SupabaseQueryError(error);
    return data;
  }

  async indexedSourceIds(
    chapterId: string,
    sourceType: string,
    sourceIds: readonly string[],
  ): Promise<string[]> {
    if (sourceIds.length === 0) return [];
    const { data, error } = await this.supabase
      .from('corpus_sources')
      .select('source_id, revision, indexed_revision')
      .eq('chapter_id', chapterId)
      .eq('source_type', sourceType)
      .in('source_id', [...sourceIds])
      // The search's own rule (`match_corpus_chunks`): indexed, at the
      // revision the source is at now. A source the indexer skipped (no
      // text, too large) also carries an indexed revision, and one edited
      // since is `pending` with its passages gone, so neither is findable.
      .eq('status', 'indexed');
    if (error) throw new SupabaseQueryError(error);
    return (data ?? [])
      .filter((row) => row.indexed_revision === row.revision)
      .map((row) => row.source_id);
  }

  async postponeChapter(chapterId: string, until: Date): Promise<void> {
    const at = until.toISOString();
    // The sources a sweep just claimed carry the claim's own, longer wait
    // and a try that was never made. Both are put back, or a chapter that
    // is refused for days would back off to one look a day.
    const claimed = await this.supabase
      .from('corpus_sources')
      .update({ next_attempt_at: at, attempts: 0 })
      .eq('chapter_id', chapterId)
      .gt('attempts', 0);
    if (claimed.error) throw new SupabaseQueryError(claimed.error);
    // The rest of the chapter's waiting sources, so the next sweep does not
    // claim them only to be refused again. Indexed rows are left alone.
    const waiting = await this.supabase
      .from('corpus_sources')
      .update({ next_attempt_at: at })
      .eq('chapter_id', chapterId)
      .eq('status', 'pending')
      .lt('next_attempt_at', at);
    if (waiting.error) throw new SupabaseQueryError(waiting.error);
  }

  async deleteSource(chapterId: string, id: string): Promise<void> {
    const { error } = await this.supabase
      .from('corpus_sources')
      .delete()
      .eq('chapter_id', chapterId)
      .eq('id', id);
    if (error) throw new SupabaseQueryError(error);
  }

  async writeChunks(
    sourceId: string,
    revision: number,
    first: boolean,
    embeddingModel: string,
    chunks: CorpusChunkWrite[],
  ): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('write_corpus_chunks', {
      p_source_id: sourceId,
      p_revision: revision,
      p_first: first,
      p_embedding_model: embeddingModel,
      p_chunks: chunks.map((chunk) => ({
        ...chunk,
        embedding: vectorLiteral(chunk.embedding),
      })),
    });
    if (error) throw new SupabaseQueryError(error);
    return data === true;
  }

  async finishSource(input: FinishCorpusSourceInput): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('finish_corpus_source', {
      p_source_id: input.sourceId,
      p_revision: input.revision,
      p_fingerprint: input.fingerprint,
      p_title: input.title,
      p_source_at: input.sourceAt,
      p_decays: input.decays,
      p_chunk_count: input.chunkCount,
      p_skip_reason: input.skipReason,
      p_left_out_count: input.leftOutCount ?? 0,
      p_left_out_author_ids: input.leftOutAuthorIds?.length
        ? [...input.leftOutAuthorIds]
        : null,
    });
    if (error) throw new SupabaseQueryError(error);
    return data === true;
  }

  async match(input: MatchCorpusInput): Promise<CorpusCandidate[]> {
    const { data, error } = await this.supabase.rpc('match_corpus_chunks', {
      p_chapter_id: input.chapterId,
      p_user_id: input.userId,
      p_query: input.query,
      p_embedding: vectorLiteral(input.embedding),
      p_embedding_model: input.embeddingModel,
      p_limit: input.limit,
      // Sent only when the search is narrowed, so an unnarrowed search is
      // the call it always was, against a database with or without
      // `20261113204057_ask_agent_corpus_filters.sql`.
      ...matchFilterArgs(input.filter),
    });
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async readSourceChunks(input: {
    chapterId: string;
    userId: string;
    sourceType: string;
    sourceId: string;
    offset: number;
    limit: number;
  }): Promise<CorpusSourceChunks | null> {
    const { data, error } = await this.supabase.rpc(
      'read_corpus_source_chunks',
      {
        p_chapter_id: input.chapterId,
        p_user_id: input.userId,
        p_source_type: input.sourceType,
        p_source_id: input.sourceId,
        p_offset: Math.max(Math.trunc(input.offset), 0),
        p_limit: Math.max(Math.trunc(input.limit), 1),
      },
    );
    if (error) throw new SupabaseQueryError(error);
    const rows = data ?? [];
    if (rows.length === 0) return null;
    return {
      title: rows[0].title,
      source_at: rows[0].source_at,
      total: rows[0].chunk_count,
      chunks: rows.map((row) => ({
        id: row.chunk_id,
        chunk_index: row.chunk_index,
        heading: row.heading,
        content: row.content,
        page_start: row.page_start,
        page_end: row.page_end,
      })),
    };
  }

  async readChatWindow(
    chapterId: string,
    windowId: string,
  ): Promise<ChatWindowRead | null> {
    const { data, error } = await this.supabase.rpc('read_chat_corpus_window', {
      p_chapter_id: chapterId,
      p_window_id: windowId,
    });
    if (error) throw new SupabaseQueryError(error);
    const rows = data ?? [];
    if (rows.length === 0) return null;
    return {
      channelId: rows[0].channel_id,
      channelName: rows[0].channel_name,
      day: String(rows[0].day).slice(0, 10),
      messages: rows.flatMap((row) =>
        row.message_id && row.created_at && row.conversation_at
          ? [
              {
                id: row.message_id,
                senderId: row.sender_id,
                senderName: row.sender_name ?? '',
                content: row.content ?? '',
                createdAt: row.created_at,
                threadRootId: row.thread_root_id,
                conversationAt: row.conversation_at,
              },
            ]
          : [],
      ),
    };
  }

  async chatWindowChannels(
    chapterId: string,
    windowIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (windowIds.length === 0) return new Map();
    const { data, error } = await this.supabase.rpc(
      'chat_corpus_window_channels',
      { p_chapter_id: chapterId, p_window_ids: [...windowIds] },
    );
    if (error) throw new SupabaseQueryError(error);
    return new Map((data ?? []).map((row) => [row.window_id, row.channel_id]));
  }

  async requeueChatByAuthors(
    userIds: readonly string[],
    chapterId: string | null,
  ): Promise<number> {
    if (userIds.length === 0) return 0;
    const { data, error } = await this.supabase.rpc(
      'requeue_chat_corpus_by_authors',
      { p_user_ids: [...userIds], p_chapter_id: chapterId },
    );
    if (error) throw new SupabaseQueryError(error);
    return data ?? 0;
  }

  async chatCorpusChapters(): Promise<string[]> {
    const { data, error } = await this.supabase.rpc('chat_corpus_chapters');
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async chatCorpusAuthors(
    chapterId: string,
  ): Promise<{ indexed: string[]; leftOut: string[] }> {
    const { data, error } = await this.supabase.rpc('chat_corpus_authors', {
      p_chapter_id: chapterId,
    });
    if (error) throw new SupabaseQueryError(error);
    const indexed: string[] = [];
    const leftOut: string[] = [];
    for (const row of data ?? []) {
      (row.indexed ? indexed : leftOut).push(row.user_id);
    }
    return { indexed, leftOut };
  }
}
