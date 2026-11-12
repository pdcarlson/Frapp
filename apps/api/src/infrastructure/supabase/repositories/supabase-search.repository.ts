import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { PagedQueryResult } from '../supabase.utils';
import { SupabaseQueryError } from '../supabase-query-error';
import { chunkIds } from '#domain/utils/chunk-ids';
import type {
  ISearchRepository,
  SearchChannelAccessRow,
  SearchMemberHit,
  SearchMessageFilters,
} from '#domain/repositories/search.repository.interface';
import type { BackworkResource } from '#domain/entities/backwork.entity';
import type { Event } from '#domain/entities/event.entity';
import type { ChatMessage } from '#domain/entities/chat.entity';

type QueryResult<T> = PagedQueryResult<T>;

/**
 * Guards the pushed-down channel-id filter. `chat_channels.id` is a `uuid`
 * column, and PostgREST answers a malformed comparison with `22P02` rather than
 * an empty set — so an unvalidated push-down would turn a garbage `channelId`
 * into a 500 instead of the "no matches" the API contract promises.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every source matches through a generated `tsvector` behind a GIN index, so
 * they all share one parse mode and one text-search configuration.
 *
 * `websearch`, not `plain` or `to_tsquery`: it accepts what people actually type
 * into a search box (quoted phrases, `or`, a leading `-` for negation) and never
 * raises a syntax error on stray punctuation — so a query is never a 500. A
 * query that reduces to no lexemes at all (a lone stop word) matches nothing,
 * which is the honest answer rather than an error.
 *
 * `config` must stay in step with the `to_tsvector('english', …)` in the
 * migrations that define these columns: a query parsed under a different
 * configuration than the one that built the vector silently under-matches.
 */
const TEXT_SEARCH = {
  type: 'websearch',
  config: 'english',
} as const;

/**
 * Explicit column lists for the two sources that used to `select('*')`.
 *
 * They are explicit for one reason: `*` would also ship the generated
 * `search_vector` back — the whole tsvector payload, per row, on the one read
 * whose result set these tables grow. Same reason `searchMessages` enumerates
 * rather than globbing.
 *
 * THE TRADE, AND THE GUARD. An explicit list stops tracking the table the
 * moment someone adds a column: the new field silently vanishes from search
 * results while every type still says it is there, because the rows are cast to
 * the entity type rather than inferred. That is not hypothetical — writing this
 * change dropped `check_in_zone` / `check_in_zone_name` from event results,
 * which `apps/web/components/events/event-editor-dialog.tsx` reads to populate
 * the geofence editor.
 *
 * So these lists are exported and `scripts/pglite/landmarks.mjs` asserts
 * each one equals its table's real columns minus the tsvector. Add a column to
 * `events` or `backwork_resources` and that gate fails until it is added here
 * too. Keep them exported, and keep them as plain string literals — the gate
 * parses this file.
 */
export const BACKWORK_SEARCH_COLUMNS =
  'id, chapter_id, department_id, course_number, professor_id, uploader_id, title, year, semester, assignment_type, assignment_number, document_variant, storage_path, file_hash, is_redacted, tags, created_at';

export const EVENT_SEARCH_COLUMNS =
  'id, chapter_id, name, description, location, start_time, end_time, point_value, is_mandatory, recurrence_rule, parent_event_id, required_role_ids, optional_role_ids, excluded_role_ids, others_invited, notes, created_at, check_in_zone, check_in_zone_name, check_in_opens_minutes, created_by, event_type_id';

/**
 * Not `*`: `content_search` is the STORED tsvector `searchMessages` matches on,
 * and PostgREST's `*` would ship the whole index payload back for every hit —
 * on the one read whose result set the archive import grows most.
 */
const MESSAGE_SEARCH_COLUMNS =
  'id, channel_id, sender_id, author_name, author_avatar_path, author_external_id, content, type, kind, payload, client_message_id, reply_to_id, metadata, mentions, is_pinned, pinned_at, flag, flagged_by, flagged_at, edited_at, is_deleted, created_at';

/**
 * The order `searchMessages` asks PostgREST for, `created_at desc, id desc`,
 * applied to the merged batches. Timestamps compare as instants first, since
 * the offset PostgREST writes need not match from row to row. Then the
 * strings break ties: `Date` stops at milliseconds, and the column keeps
 * microseconds.
 */
function newestFirst(a: ChatMessage, b: ChatMessage): number {
  const byInstant = Date.parse(b.created_at) - Date.parse(a.created_at);
  if (byInstant !== 0) return byInstant;
  if (a.created_at !== b.created_at)
    return a.created_at < b.created_at ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

@Injectable()
export class SupabaseSearchRepository implements ISearchRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * Backwork search through `search_backwork_resources`
   * (20261106190000_backwork_search_wider.sql, replaced by
   * 20261109230000_backwork_courses.sql): title, course, department, the
   * course's name and nicknames (#3848), professor and tags, ranked, with
   * trigram typo tolerance (#585). It joins the department, course and
   * professor at query time, which a generated column can't, so it is a
   * function rather than `.textSearch('search_vector')`.
   * The function parses the query with `websearch_to_tsquery('english', …)`,
   * the same parse as `TEXT_SEARCH`, so the raw query still travels as one
   * opaque argument and is never spliced into a filter.
   *
   * The explicit `select` keeps the generated tsvector out of the response,
   * as for every other source.
   */
  async searchBackwork(
    chapterId: string,
    query: string,
    limit: number,
  ): Promise<BackworkResource[]> {
    const { data, error } = (await this.supabase
      .rpc('search_backwork_resources', {
        p_chapter_id: chapterId,
        p_query: query,
        p_limit: limit,
      })
      .select(BACKWORK_SEARCH_COLUMNS)) as QueryResult<BackworkResource>;
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  /**
   * Event search over the generated `search_vector` (name + description),
   * backed by `idx_events_search` (same migration).
   *
   * Measured on the local stack at 20k events in one chapter, selective term:
   * the `ILIKE` pair this replaces ran a 20,001-row sequential scan in ~35.7 ms;
   * the tsquery form is a Bitmap Index Scan at ~0.07 ms.
   */
  async searchEvents(
    chapterId: string,
    query: string,
    limit: number,
  ): Promise<Event[]> {
    const { data, error } = (await this.supabase
      .from('events')
      .select(EVENT_SEARCH_COLUMNS)
      .eq('chapter_id', chapterId)
      .textSearch('search_vector', query, TEXT_SEARCH)
      .limit(limit)) as QueryResult<Event>;
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  /**
   * Member search: one query, indexed, with the roster never materialised.
   *
   * This used to be two round trips, and the first was unbounded — it selected
   * EVERY `members` row for the chapter, then passed the whole roster to
   * `users` as an `.in()` list filtered by `ILIKE '%q%'`. So every keystroke-ish
   * search read the entire chapter into memory and then substring-scanned the
   * global `users` table (#1085). At 20 req/min per caller that is O(roster) of
   * pure waste on a hot path.
   *
   * Both halves collapse into a single PostgREST query. `users!inner(…)` makes
   * the embed an INNER JOIN, which is what allows a filter on an embedded
   * column to restrict the parent rows; `users.display_name_search` then matches
   * through `idx_users_display_name_search`. The roster is never fetched, the
   * match happens in SQL, and `limit` is applied by the database instead of by
   * the length of whatever the previous query happened to return.
   *
   * Chapter scoping is the outer `.eq('chapter_id', …)`: the join filters
   * WITHIN the chapter's members, so a name that matches in another chapter
   * cannot surface here. `users` is a global table, and this is the only thing
   * keeping this source chapter-local — verified against the local stack with
   * the same query run for two chapters holding same-surnamed members, each
   * returning only its own.
   *
   * `email` is selected because the result shape has always carried it, and it
   * is NOT part of `display_name_search` — the vector covers `display_name`
   * alone, deliberately, so this path can never become an address lookup.
   */
  async searchMembers(
    chapterId: string,
    query: string,
    limit: number,
  ): Promise<SearchMemberHit[]> {
    const { data, error } = (await this.supabase
      .from('members')
      .select('id, user_id, chapter_id, users!inner(id, display_name, email)')
      .eq('chapter_id', chapterId)
      .textSearch('users.display_name_search', query, TEXT_SEARCH)
      .limit(limit)) as QueryResult<{
      id: string;
      user_id: string;
      chapter_id: string;
      // PostgREST returns a to-one embed as an object, but older/looser typings
      // and the mocked client in tests can hand back a single-element array.
      // Accept both rather than letting the shape decide whether search works.
      users:
        | { id: string; display_name: string; email: string }
        | { id: string; display_name: string; email: string }[]
        | null;
    }>;
    if (error) throw new SupabaseQueryError(error);
    if (!data?.length) return [];

    return data.flatMap((row) => {
      const user = Array.isArray(row.users) ? row.users[0] : row.users;
      if (!user) return [];
      return [
        {
          id: row.id,
          user_id: row.user_id,
          chapter_id: row.chapter_id,
          display_name: user.display_name ?? '',
          email: user.email ?? '',
        },
      ];
    });
  }

  /**
   * Full-text message search over the `content_search` generated tsvector
   * through its GIN index (20260823122000_chat_message_search_vector.sql). It
   * used to be `.ilike('content', '%q%')`, a leading-wildcard scan no index can
   * serve — so every chapter-wide search read the whole table. That was
   * survivable while `chat_messages` was small; a Discord archive import is
   * precisely what stops it being small.
   *
   * Stemming is a real behaviour change and an intended one: searching "attach"
   * now finds "attached". Substring matching within a word ("tach") is gone.
   * `pg_trgm` is installed now (20261106190000, for Backwork) and registered
   * in both PGlite harnesses, but chat has no trigram index: matching within
   * a word here is a separate decision with its own index cost.
   *
   * FILTERS WITHOUT TEXT (#3958, #3965). An empty `query` has no GIN match to
   * narrow by, and `channel_id IN (…) ORDER BY created_at DESC LIMIT n` cannot
   * walk the `(channel_id, created_at desc)` index in order across a list, so
   * this query read every message of the listed channels that passed the
   * filter and sorted them. That case goes to `search_chat_messages_filtered`
   * instead ({@link searchMessagesByFilter}), which takes each channel's newest
   * matches through an index and merges them.
   *
   * CHUNKED CHANNEL FILTER (#3265). A chapter-wide search hands this every
   * channel the caller may read, and a Discord-imported chapter has hundreds.
   * One `.in()` list of them overflows the request line: the local gateway
   * returns `414 URI Too Long` somewhere between 200 and 250 uuids
   * (`ID_CHUNK_SIZE` records the measurement), which failed the source and
   * turned every chapter-wide search into a 500. So the list goes out in
   * `chunkIds` batches, concurrently, and the batches are merged here.
   *
   * The merge matches the single query, top `limit` included: the newest
   * `limit` rows overall must sit inside the newest `limit` of whichever batch
   * holds them, so taking `limit` per batch, sorting the union by the same
   * key and cutting to `limit` loses nothing. `id` breaks `created_at` ties in
   * both the query and the merge, so which row wins a tie doesn't depend on
   * how the channels happened to be batched.
   */
  async searchMessages(
    channelIds: string[],
    query: string,
    limit: number,
    filters: SearchMessageFilters = {},
  ): Promise<ChatMessage[]> {
    if (!query) return this.searchMessagesByFilter(channelIds, limit, filters);
    const has = new Set(filters.has ?? []);
    // `has:file` and `has:image` are an INNER JOIN on the attachment rows, the
    // same embed-filters-the-parent shape `searchMembers` uses. An image is an
    // attachment whose content type says so; a file is any attachment at all,
    // images included (Discord's reading of the two words). A legacy row with a
    // null content type is therefore a file and never an image.
    const wantsAttachment = has.has('file') || has.has('image');
    const columns = wantsAttachment
      ? `${MESSAGE_SEARCH_COLUMNS}, chat_message_attachments!inner(id)`
      : MESSAGE_SEARCH_COLUMNS;

    const batches = await Promise.all(
      chunkIds(channelIds).map(async (batch) => {
        let request = this.supabase
          .from('chat_messages')
          .select(columns)
          .in('channel_id', batch)
          .eq('is_deleted', false)
          // A thread reply has no place in the timeline a hit jumps to;
          // thread results in search are slice 2 of #3785.
          .is('thread_root_id', null);
        request = request.textSearch('content_search', query, TEXT_SEARCH);
        if (filters.fromUserId) {
          request = request.eq('sender_id', filters.fromUserId);
        }
        if (filters.after) request = request.gte('created_at', filters.after);
        if (filters.before) request = request.lt('created_at', filters.before);
        if (has.has('image')) {
          request = request.like(
            'chat_message_attachments.content_type',
            'image/%',
          );
        }
        // The chat-card poll, the only shape a client creates. A row from the
        // legacy `POST /v1/channels/:id/polls` (`type: 'POLL'`) is not one
        // (spec/behavior/polls.md; that route is retired by #3887).
        if (has.has('poll')) request = request.eq('kind', 'poll');
        // A link is a URL scheme in the text. The pattern is a constant, never
        // the caller's query, so there is still no filter string to inject into.
        if (has.has('link')) request = request.ilike('content', '%http%://%');

        const { data, error } = (await request
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(limit)) as QueryResult<
          ChatMessage & { chat_message_attachments?: unknown }
        >;
        if (error) throw new SupabaseQueryError(error);
        // The embed exists only to filter; it is not part of a message.
        return (data ?? []).map((row): ChatMessage => {
          const message = { ...row };
          delete message.chat_message_attachments;
          return message;
        });
      }),
    );
    if (batches.length === 1) return batches[0];
    return batches.flat().sort(newestFirst).slice(0, limit);
  }

  /**
   * A message search with a filter and no text ("everything Ryan posted this
   * week"; `SearchService` allows an empty query only beside a filter), through
   * `search_chat_messages_filtered`
   * (20261112131300_chat_search_filter_only.sql, #3965).
   *
   * The function asks each channel for its own newest `limit` matches, a
   * backward walk of a `(channel_id, created_at desc)` index that stops at the
   * limit, and keeps the newest `limit` of those. `poll` and `link` walk
   * partial indexes that hold only their rows, and `file` / `image` start from
   * the channel's attachment rows, so a rare trait does not read a whole
   * channel to find nothing. Measured at 1.2M messages across 300 channels:
   * spec/behavior/search.md § Message filters.
   *
   * The channel ids travel in the request body, not the URL, so this is one
   * call however many channels the caller reads, with none of the `chunkIds`
   * batching the text path needs (#3265). It reads only the ids it is handed:
   * `SearchService` has already passed each through `canAccessChannel`.
   *
   * The rows are sorted again here, by the same key, rather than trusting the
   * order a set-returning function's rows arrive in through PostgREST.
   */
  private async searchMessagesByFilter(
    channelIds: string[],
    limit: number,
    filters: SearchMessageFilters,
  ): Promise<ChatMessage[]> {
    if (!channelIds.length) return [];
    const { data, error } = (await this.supabase
      .rpc('search_chat_messages_filtered', {
        p_channel_ids: channelIds,
        p_sender_id: filters.fromUserId ?? null,
        p_after: filters.after ?? null,
        p_before: filters.before ?? null,
        p_has: [...(filters.has ?? [])],
        p_limit: limit,
      })
      .select(MESSAGE_SEARCH_COLUMNS)) as QueryResult<ChatMessage>;
    if (error) throw new SupabaseQueryError(error);
    return (data ?? []).slice().sort(newestFirst).slice(0, limit);
  }

  async findChannelsForAccess(
    chapterId: string,
    onlyChannelId?: string,
  ): Promise<SearchChannelAccessRow[]> {
    const channelQuery = this.supabase
      .from('chat_channels')
      .select('id, type, member_ids, who_can_see')
      .eq('chapter_id', chapterId);
    // Only push the id down when it could actually BE one. `chat_channels.id`
    // is a `uuid` column, so PostgREST rejects a malformed value with 22P02,
    // thrown below as a `SupabaseQueryError` and so a 500 — which would make
    // `?channelId=general` an error instead of the empty result search's
    // caller documents and the spec promises. A non-uuid simply skips the
    // narrowing, and the caller's own intersection matches nothing and returns
    // empty. The filter is an optimisation; it must never be the thing that
    // decides whether the request succeeds.
    const { data, error } = (await (onlyChannelId &&
    UUID_PATTERN.test(onlyChannelId)
      ? channelQuery.eq('id', onlyChannelId)
      : channelQuery)) as QueryResult<SearchChannelAccessRow>;
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }
}
