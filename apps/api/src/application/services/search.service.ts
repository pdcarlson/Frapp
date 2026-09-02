import {
  Logger,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { canAccessChannel } from '@repo/validation';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { RbacService } from './rbac.service';
import { hasRequiredRole } from './event.service';
import { SystemPermissions } from '../../domain/constants/permissions';
import type { BackworkResource } from '../../domain/entities/backwork.entity';
import type { Event } from '../../domain/entities/event.entity';
import type {
  ChatMessage,
  ChannelType,
} from '../../domain/entities/chat.entity';

export interface SearchMemberResult {
  id: string;
  user_id: string;
  chapter_id: string;
  display_name: string;
  email: string;
}

export interface SearchResult {
  backwork: BackworkResource[];
  events: Event[];
  members: SearchMemberResult[];
  messages: ChatMessage[];
}

/** Which of the four result arrays a search hit belongs to. */
export type SearchSource = keyof SearchResult;

const SEARCH_LIMIT = 10;
const MIN_QUERY_LENGTH = 3;
const SEARCH_TIMEOUT_MS = 500;

/**
 * Every source now matches through a generated `tsvector` behind a GIN index,
 * so they all share one parse mode and one text-search configuration.
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
 * So these lists are exported and `scripts/check-pglite-migrations.mjs` asserts
 * each one equals its table's real columns minus the tsvector. Add a column to
 * `events` or `backwork_resources` and that gate fails until it is added here
 * too. Keep them exported, and keep them as plain string literals — the gate
 * parses this file.
 */
export const BACKWORK_SEARCH_COLUMNS =
  'id, chapter_id, department_id, course_number, professor_id, uploader_id, title, year, semester, assignment_type, assignment_number, document_variant, storage_path, file_hash, is_redacted, tags, created_at';

export const EVENT_SEARCH_COLUMNS =
  'id, chapter_id, name, description, location, start_time, end_time, point_value, is_mandatory, recurrence_rule, parent_event_id, required_role_ids, notes, created_at, check_in_zone, check_in_zone_name';

function emptyResult(): SearchResult {
  return { backwork: [], events: [], members: [], messages: [] };
}

/**
 * Runs one source under the shared budget, degrading that source alone.
 *
 * The budget used to wrap the whole `Promise.all`, which meant one slow source
 * returned FOUR empty arrays: a slow message scan hid the member, event and
 * backwork hits that had already come back, and the UI rendered it as "no
 * matches" — indistinguishable from a real miss. Per-source, a timeout costs
 * only its own section, and the caller learns which one to say so about.
 *
 * A rejection that arrives **within** the budget still propagates: that source
 * is a 500, exactly as before. One that arrives **after** it has already lost
 * the race, so it can only be reported as a timeout — which is why it is logged
 * rather than swallowed. Without that, a source failing consistently at 700ms (a
 * `statement_timeout`, a PostgREST 5xx under load) returns a clean 200 with
 * `x-search-timeout: 1` forever and never reaches Sentry: the surface reads as
 * merely slow while it is in fact completely broken.
 *
 * `Promise.race` attaches its own handler to `work` immediately, so a late
 * rejection is already accounted for and cannot surface as an unhandled
 * rejection; the `catch` below is for the signal, not for safety.
 */
async function withinBudget<T>(
  source: SearchSource,
  work: Promise<T>,
  fallback: T,
  timedOutSources: SearchSource[],
  logger: Logger,
): Promise<T> {
  const TIMED_OUT = Symbol('search-timeout');
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), SEARCH_TIMEOUT_MS);
  });

  void work.catch((error: unknown) => {
    if (settled) return;
    logger.error(
      `search source "${source}" failed after the ${SEARCH_TIMEOUT_MS}ms budget; reported to the caller as a timeout`,
      error instanceof Error ? error.stack : String(error),
    );
  });

  try {
    const outcome = await Promise.race([work, timeout]);
    if (outcome === TIMED_OUT) {
      timedOutSources.push(source);
      return fallback;
    }
    settled = true;
    return outcome;
  } catch (error) {
    settled = true;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wraps a single source. `search` passes the work through untouched;
 * `searchWithinBudget` puts each one under {@link withinBudget}.
 */
type SourceWrapper = <T>(
  source: SearchSource,
  work: Promise<T>,
  fallback: T,
) => Promise<T>;

interface QueryError {
  message: string;
}

interface QueryResult<T> {
  data: T[] | null;
  error: QueryError | null;
}

function throwIfError(error: QueryError | null): void {
  if (error) {
    throw new InternalServerErrorException(error.message);
  }
}

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
    private readonly rbacService: RbacService,
  ) {}

  async search(
    chapterId: string,
    userId: string,
    query: string,
    channelId?: string,
  ): Promise<SearchResult> {
    const q = query.trim();
    // Spec default: queries shorter than 3 characters return an empty result
    // without touching the database (spec/behavior/search.md).
    if (q.length < MIN_QUERY_LENGTH) {
      return emptyResult();
    }
    return this.collect(
      chapterId,
      userId,
      q,
      (_source, work) => work,
      channelId,
    );
  }

  /**
   * Runs {@link search} with each source under its own
   * {@link SEARCH_TIMEOUT_MS} budget, so a slow one degrades alone.
   *
   * `timedOut` stays for the `x-search-timeout` header the HTTP layer sets
   * (spec/behavior/search.md); `timedOutSources` names which sections are
   * incomplete, which is the difference between "we found nothing" and "we
   * stopped looking here". This is still an application-level budget — it does
   * not abort the in-flight Supabase queries, since supabase-js does not cleanly
   * expose a per-query `statement_timeout` — but every scan is capped at
   * {@link SEARCH_LIMIT} and the message scan is now index-backed rather than a
   * sequential `ILIKE`, so tripping it should be rare rather than routine.
   */
  async searchWithinBudget(
    chapterId: string,
    userId: string,
    query: string,
    channelId?: string,
  ): Promise<{
    results: SearchResult;
    timedOut: boolean;
    timedOutSources: SearchSource[];
  }> {
    const q = query.trim();
    if (q.length < MIN_QUERY_LENGTH) {
      return { results: emptyResult(), timedOut: false, timedOutSources: [] };
    }

    const timedOutSources: SearchSource[] = [];
    const results = await this.collect(
      chapterId,
      userId,
      q,
      (source, work, fallback) =>
        withinBudget(source, work, fallback, timedOutSources, this.logger),
      channelId,
    );
    return {
      results,
      timedOut: timedOutSources.length > 0,
      timedOutSources,
    };
  }

  /**
   * Fans out to the four sources and reassembles the result.
   *
   * Shared by {@link search} and {@link searchWithinBudget} so the two cannot
   * drift on which sources exist or what each one is handed — the only
   * difference between them is the `wrap` they pass.
   *
   * `channelId` narrows this to the **single-channel** form of search that
   * `spec/behavior/chat/README.md` specifies ("full-text search within a single
   * channel or across all channels the user can access"). When it is present
   * only the message source runs and the other three return empty, because a
   * channel-scoped query is definitionally a chat search: firing the backwork,
   * event and member scans would be three queries no such caller renders, on a
   * route carrying `@ThrottleExpensiveRead()`, once per debounced keystroke.
   * The response shape is unchanged either way.
   */
  private async collect(
    chapterId: string,
    userId: string,
    q: string,
    wrap: SourceWrapper,
    channelId?: string,
  ): Promise<SearchResult> {
    if (channelId) {
      const messages = await wrap(
        'messages',
        this.searchMessages(chapterId, userId, q, channelId),
        [],
      );
      return { backwork: [], events: [], members: [], messages };
    }
    // Every source takes the raw query: all four parse it as a full-text query
    // rather than matching it as a substring.
    const [backwork, events, members, messages] = await Promise.all([
      wrap('backwork', this.searchBackwork(chapterId, q), []),
      wrap('events', this.searchEvents(chapterId, userId, q), []),
      wrap('members', this.searchMembers(chapterId, q), []),
      wrap('messages', this.searchMessages(chapterId, userId, q), []),
    ]);
    return { backwork, events, members, messages };
  }

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
  private async searchBackwork(
    chapterId: string,
    query: string,
  ): Promise<BackworkResource[]> {
    const { data, error } = (await this.supabase
      .from('backwork_resources')
      .select(BACKWORK_SEARCH_COLUMNS)
      .eq('chapter_id', chapterId)
      .textSearch('search_vector', query, TEXT_SEARCH)
      .limit(SEARCH_LIMIT)) as QueryResult<BackworkResource>;
    throwIfError(error);
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
  private async searchEvents(
    chapterId: string,
    userId: string,
    query: string,
  ): Promise<Event[]> {
    const { data, error } = (await this.supabase
      .from('events')
      .select(EVENT_SEARCH_COLUMNS)
      .eq('chapter_id', chapterId)
      .textSearch('search_vector', query, TEXT_SEARCH)
      .limit(SEARCH_LIMIT)) as QueryResult<Event>;
    throwIfError(error);
    return this.filterVisibleEvents(chapterId, userId, data ?? []);
  }

  /**
   * Search must not become a side-channel around `EventService`'s read
   * visibility (#1463): a role-targeted event is invisible via `GET
   * /v1/events` to a member without an intersecting role, so it must be
   * invisible here too. Mirrors `EventService.isVisibleToViewer`/
   * `findByChapter` exactly — same `hasRequiredRole` predicate, same
   * `events:update` (wildcard-inclusive) management exemption — via a raw
   * query rather than a repository call, consistent with the rest of this
   * file (`searchMembers`, `accessibleChannelIds`).
   */
  private async filterVisibleEvents(
    chapterId: string,
    userId: string,
    events: Event[],
  ): Promise<Event[]> {
    const hasTargetedEvents = events.some(
      (event) => event.required_role_ids && event.required_role_ids.length > 0,
    );
    if (!hasTargetedEvents) return events;

    if (
      await this.rbacService.memberHasAnyPermission(chapterId, userId, [
        SystemPermissions.EVENTS_UPDATE,
      ])
    ) {
      return events;
    }

    const { data: members, error } = (await this.supabase
      .from('members')
      .select('role_ids')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .limit(1)) as QueryResult<{ role_ids: string[] }>;
    throwIfError(error);
    const memberRoleIds = members?.[0]?.role_ids ?? [];

    return events.filter((event) =>
      hasRequiredRole(event.required_role_ids, memberRoleIds),
    );
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
   * match happens in SQL, and `SEARCH_LIMIT` is applied by the database instead
   * of by the length of whatever the previous query happened to return.
   *
   * Chapter scoping is unchanged and still the outer `.eq('chapter_id', …)`:
   * the join filters WITHIN the chapter's members, so a name that matches in
   * another chapter cannot surface here. `users` is a global table, and this is
   * the only thing keeping this source chapter-local — verified against the
   * local stack with the same query run for two chapters holding same-surnamed
   * members, each returning only its own.
   *
   * `email` is selected because the result shape has always carried it, and it
   * is NOT part of `display_name_search` — the vector covers `display_name`
   * alone, deliberately, so this path can never become an address lookup.
   */
  private async searchMembers(
    chapterId: string,
    query: string,
  ): Promise<SearchMemberResult[]> {
    const { data, error } = (await this.supabase
      .from('members')
      .select('id, user_id, chapter_id, users!inner(id, display_name, email)')
      .eq('chapter_id', chapterId)
      .textSearch('users.display_name_search', query, TEXT_SEARCH)
      .limit(SEARCH_LIMIT)) as QueryResult<{
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
    throwIfError(error);
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
   * Full-text message search, scoped to the channels the caller may read.
   *
   * Matches against the `content_search` generated tsvector through its GIN
   * index (20260823122000_chat_message_search_vector.sql). It used to be
   * `.ilike('content', '%q%')`, a leading-wildcard scan no index can serve — so
   * every chapter-wide search read the whole table. That was survivable while
   * `chat_messages` was small; a Discord archive import is precisely what stops
   * it being small.
   *
   * `websearch` parse mode, not `plain`: it accepts what people actually type
   * ("budget -draft", quoted phrases, OR) and, unlike `to_tsquery`, it never
   * raises a syntax error on stray punctuation. A query that reduces to no
   * lexemes at all — a lone stop word — simply matches nothing, which is the
   * honest answer.
   *
   * Stemming is a real behaviour change and an intended one: searching "attach"
   * now finds "attached". Substring matching within a word ("tach") is gone,
   * which needs `pg_trgm` — not installed, and not registered in the PGlite CI
   * gate. That is a separate decision with its own index cost.
   */
  private async searchMessages(
    chapterId: string,
    userId: string,
    query: string,
    channelId?: string,
  ): Promise<ChatMessage[]> {
    const accessible = await this.accessibleChannelIds(chapterId, userId);
    // A channel-scoped search is still resolved through `accessibleChannelIds`
    // rather than trusting the caller's id — intersecting is what keeps the one
    // access path this method's comment below insists on. A channel that does
    // not exist, sits in another chapter, or is simply not readable by this
    // caller intersects to nothing and returns empty. That is deliberate: a 403
    // here would answer "does this channel id exist?" for a member who cannot
    // read it, turning search into a channel-existence oracle (the 403-vs-404
    // distinction #1565 is open about elsewhere in chat).
    const channelIds = channelId
      ? accessible.filter((id) => id === channelId)
      : accessible;
    if (!channelIds.length) return [];

    const { data, error } = (await this.supabase
      .from('chat_messages')
      // Not `*`: `content_search` is the STORED tsvector this query matches on,
      // and PostgREST's `*` would ship the whole index payload back for every
      // hit — on the one read whose result set the archive import grows most.
      .select(
        'id, channel_id, sender_id, author_name, author_avatar_path, author_external_id, content, type, kind, payload, client_message_id, reply_to_id, metadata, mentions, is_pinned, pinned_at, edited_at, is_deleted, created_at',
      )
      .in('channel_id', channelIds)
      .textSearch('content_search', query, {
        type: 'websearch',
        config: 'english',
      })
      .eq('is_deleted', false)
      .limit(SEARCH_LIMIT)
      .order('created_at', { ascending: false })) as QueryResult<ChatMessage>;
    throwIfError(error);
    return data ?? [];
  }

  /**
   * Channel ids in the chapter the caller may read, decided by the shared
   * `canAccessChannel` predicate (same rule the chat history / send paths use).
   * Search must not become a side-channel that leaks private, DM, or
   * role-gated messages the caller cannot otherwise see.
   */
  private async accessibleChannelIds(
    chapterId: string,
    userId: string,
  ): Promise<string[]> {
    const { data: channels, error: chError } = (await this.supabase
      .from('chat_channels')
      .select('id, type, member_ids, required_permissions')
      .eq('chapter_id', chapterId)) as QueryResult<{
      id: string;
      type: ChannelType;
      member_ids: string[] | null;
      required_permissions: string[] | null;
    }>;
    throwIfError(chError);
    if (!channels?.length) return [];

    const { data: members, error: memError } = (await this.supabase
      .from('members')
      .select('id')
      .eq('user_id', userId)
      .eq('chapter_id', chapterId)
      .limit(1)) as QueryResult<{ id: string }>;
    throwIfError(memError);
    const member = members?.[0];
    if (!member) return [];

    // Resolve through RbacService so custom-role capabilities count here
    // exactly as they do for chat channel access (bridge model,
    // spec/behavior/rbac.md) — search must never disagree with chat about
    // which role-gated channels a member can read.
    const permissions = await this.rbacService.getEffectivePermissions(
      chapterId,
      userId,
    );

    return channels
      .filter((channel) =>
        canAccessChannel({
          channel: {
            type: channel.type,
            member_ids: channel.member_ids,
            required_permissions: channel.required_permissions,
          },
          userId,
          isChapterMember: true,
          permissions,
        }),
      )
      .map((channel) => channel.id);
  }
}
