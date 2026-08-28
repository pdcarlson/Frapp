import {
  Logger,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { canAccessChannel } from '@repo/validation';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { escapeFilterValue } from '../../infrastructure/supabase/supabase.utils';
import { RbacService } from './rbac.service';
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
 * `ILIKE` needle for the three sources that still scan prose columns.
 * `chat_messages` no longer uses it — see {@link SearchService.searchMessages}.
 */
const PATTERN = (q: string) => `%${q}%`;

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
  ): Promise<SearchResult> {
    const q = query.trim();
    // Spec default: queries shorter than 3 characters return an empty result
    // without touching the database (spec/behavior/search.md).
    if (q.length < MIN_QUERY_LENGTH) {
      return emptyResult();
    }
    return this.collect(chapterId, userId, q, (_source, work) => work);
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
   */
  private async collect(
    chapterId: string,
    userId: string,
    q: string,
    wrap: SourceWrapper,
  ): Promise<SearchResult> {
    const pattern = PATTERN(q);
    const [backwork, events, members, messages] = await Promise.all([
      wrap('backwork', this.searchBackwork(chapterId, pattern), []),
      wrap('events', this.searchEvents(chapterId, pattern), []),
      wrap('members', this.searchMembers(chapterId, pattern), []),
      // The raw query, not the ILIKE pattern: this source parses it as a
      // full-text query rather than matching it as a substring.
      wrap('messages', this.searchMessages(chapterId, userId, q), []),
    ]);
    return { backwork, events, members, messages };
  }

  private async searchBackwork(
    chapterId: string,
    pattern: string,
  ): Promise<BackworkResource[]> {
    const safePattern = escapeFilterValue(pattern);
    const { data, error } = (await this.supabase
      .from('backwork_resources')
      .select('*')
      .eq('chapter_id', chapterId)
      .or(`title.ilike.${safePattern},course_number.ilike.${safePattern}`)
      .limit(SEARCH_LIMIT)) as QueryResult<BackworkResource>;
    throwIfError(error);
    return data ?? [];
  }

  private async searchEvents(
    chapterId: string,
    pattern: string,
  ): Promise<Event[]> {
    const safePattern = escapeFilterValue(pattern);
    const { data, error } = (await this.supabase
      .from('events')
      .select('*')
      .eq('chapter_id', chapterId)
      .or(`name.ilike.${safePattern},description.ilike.${safePattern}`)
      .limit(SEARCH_LIMIT)) as QueryResult<Event>;
    throwIfError(error);
    return data ?? [];
  }

  private async searchMembers(
    chapterId: string,
    pattern: string,
  ): Promise<SearchMemberResult[]> {
    const { data: members, error: memError } = (await this.supabase
      .from('members')
      .select('id, user_id, chapter_id')
      .eq('chapter_id', chapterId)) as QueryResult<{
      id: string;
      user_id: string;
      chapter_id: string;
    }>;
    throwIfError(memError);
    if (!members?.length) return [];

    const userIds = members.map((m) => m.user_id);
    const { data: users, error: userError } = (await this.supabase
      .from('users')
      .select('id, display_name, email')
      .in('id', userIds)
      .ilike('display_name', pattern)) as QueryResult<{
      id: string;
      display_name: string;
      email: string;
    }>;
    throwIfError(userError);
    if (!users?.length) return [];

    const userMap = new Map(
      users.map((u) => [
        u.id,
        { display_name: u.display_name, email: u.email },
      ]),
    );
    const memberMap = new Map(members.map((m) => [m.user_id, m]));

    return users.map((u) => {
      const m = memberMap.get(u.id);
      return {
        id: m?.id ?? '',
        user_id: u.id,
        chapter_id: chapterId,
        display_name: userMap.get(u.id)?.display_name ?? '',
        email: userMap.get(u.id)?.email ?? '',
      };
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
  ): Promise<ChatMessage[]> {
    const channelIds = await this.accessibleChannelIds(chapterId, userId);
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
