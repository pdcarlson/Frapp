import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import type { PagedQueryResult } from '../supabase.utils';
import { SupabaseQueryError } from '../supabase-query-error';
import type {
  ISearchRepository,
  SearchChannelAccessRow,
  SearchMemberHit,
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
  'id, chapter_id, name, description, location, start_time, end_time, point_value, is_mandatory, recurrence_rule, parent_event_id, required_role_ids, notes, created_at, check_in_zone, check_in_zone_name';

/**
 * Not `*`: `content_search` is the STORED tsvector `searchMessages` matches on,
 * and PostgREST's `*` would ship the whole index payload back for every hit —
 * on the one read whose result set the archive import grows most.
 */
const MESSAGE_SEARCH_COLUMNS =
  'id, channel_id, sender_id, author_name, author_avatar_path, author_external_id, content, type, kind, payload, client_message_id, reply_to_id, metadata, mentions, is_pinned, pinned_at, edited_at, is_deleted, created_at';

@Injectable()
export class SupabaseSearchRepository implements ISearchRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * Backwork search over the generated `search_vector` (title + course_number),
   * backed by `idx_backwork_resources_search`
   * (20260829002000_search_vectors_backwork_events_members.sql).
   *
   * It used to be `.or(title.ilike.%q%, course_number.ilike.%q%)` — two
   * leading-wildcard scans no index can serve. The vector covers exactly those
   * two columns, so the result set is unchanged apart from the stemming trade
   * documented in the migration and in `spec/behavior/search.md`.
   */
  async searchBackwork(
    chapterId: string,
    query: string,
    limit: number,
  ): Promise<BackworkResource[]> {
    const { data, error } = (await this.supabase
      .from('backwork_resources')
      .select(BACKWORK_SEARCH_COLUMNS)
      .eq('chapter_id', chapterId)
      .textSearch('search_vector', query, TEXT_SEARCH)
      .limit(limit)) as QueryResult<BackworkResource>;
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
   * now finds "attached". Substring matching within a word ("tach") is gone,
   * which needs `pg_trgm` — not installed, and not registered in the PGlite CI
   * gate. That is a separate decision with its own index cost.
   */
  async searchMessages(
    channelIds: string[],
    query: string,
    limit: number,
  ): Promise<ChatMessage[]> {
    const { data, error } = (await this.supabase
      .from('chat_messages')
      .select(MESSAGE_SEARCH_COLUMNS)
      .in('channel_id', channelIds)
      .textSearch('content_search', query, TEXT_SEARCH)
      .eq('is_deleted', false)
      .limit(limit)
      .order('created_at', { ascending: false })) as QueryResult<ChatMessage>;
    if (error) throw new SupabaseQueryError(error);
    return data ?? [];
  }

  async findChannelsForAccess(
    chapterId: string,
    onlyChannelId?: string,
  ): Promise<SearchChannelAccessRow[]> {
    const channelQuery = this.supabase
      .from('chat_channels')
      .select('id, type, member_ids, required_permissions')
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
