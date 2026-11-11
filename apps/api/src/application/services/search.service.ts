import { Logger, Inject, Injectable } from '@nestjs/common';
import { canAccessChannel } from '#domain/utils/channel-access';
import { RbacService } from './rbac.service';
import { ChatBlockService } from './chat-block.service';
import { maskBlockedMessages, type MaskedChatMessage } from './chat-block-mask';
import { isInvited } from './event-role-targeting';
import { eventLimitsAudience } from '@repo/validation';
import { SystemPermissions } from '#domain/constants/permissions';
import type { BackworkResource } from '#domain/entities/backwork.entity';
import type { Event } from '#domain/entities/event.entity';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import {
  SEARCH_REPOSITORY,
  type ISearchRepository,
  type SearchMemberHit,
  type SearchMessageFilters,
} from '#domain/repositories/search.repository.interface';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/** A member search hit; the shape is the repository's. */
export type SearchMemberResult = SearchMemberHit;

export interface SearchResult {
  backwork: BackworkResource[];
  events: Event[];
  members: SearchMemberResult[];
  /**
   * Masked for the caller, like every other surface that serves message content
   * to a named viewer (#2257). `sender_blocked` is on every row, not only the
   * masked ones — see `chat-block-mask.ts`.
   */
  messages: MaskedChatMessage[];
}

/** Which of the four result arrays a search hit belongs to. */
export type SearchSource = keyof SearchResult;

/**
 * What a caller may narrow a search by. `channelId` scopes the message source
 * to one channel (#469); the rest are the message filters of #3958. All of
 * them are applied inside the caller's accessible-channel set.
 */
export interface SearchFilters extends SearchMessageFilters {
  channelId?: string;
}

const SEARCH_LIMIT = 10;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The message filters alone, or `undefined` when none is set. */
function messageFiltersOf(
  filters: SearchFilters,
): SearchMessageFilters | undefined {
  const { fromUserId, after, before } = filters;
  const has = filters.has?.length ? filters.has : undefined;
  if (!fromUserId && !after && !before && !has) return undefined;
  return { fromUserId, after, before, has };
}

/**
 * The query to run, or `null` when the request is refused before the database.
 * Text needs {@link MIN_QUERY_LENGTH} characters (spec/behavior/search.md).
 * No text at all is allowed only beside a message filter ("everything Ryan
 * posted this week", #3958); a channel alone is not one, since that is the
 * channel's own timeline.
 */
function runnableQuery(query: string, filters: SearchFilters): string | null {
  const q = query.trim();
  if (q.length >= MIN_QUERY_LENGTH) return q;
  if (q.length === 0 && messageFiltersOf(filters)) return '';
  return null;
}

const MIN_QUERY_LENGTH = 3;
const SEARCH_TIMEOUT_MS = 500;

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
 *
 * The logger keys on `timedOut`, set the moment the timer fires, not on
 * anything the race's continuation sets: reactions on `work` run in the order
 * they were attached, so the logger runs before the `await` below resumes and
 * would read such a flag too early. That was the bug a `settled` flag had: every
 * rejection inside the budget also logged a false "reported as a timeout" line
 * beside the 500 it actually became.
 */
async function withinBudget<T>(
  source: SearchSource,
  work: Promise<T>,
  fallback: T,
  timedOutSources: SearchSource[],
  logger: Logger,
): Promise<T> {
  const TIMED_OUT = Symbol('search-timeout');
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve(TIMED_OUT);
    }, SEARCH_TIMEOUT_MS);
  });

  void work.catch((error: unknown) => {
    // Inside the budget the rejection propagates to the caller instead.
    if (!timedOut) return;
    reportCaughtFailure(logger, {
      level: 'error',
      site: `search-source-late-failure:${source}`,
      message: `search source "${source}" failed after the ${SEARCH_TIMEOUT_MS}ms budget; reported to the caller as a timeout`,
      error,
    });
  });

  try {
    const outcome = await Promise.race([work, timeout]);
    if (outcome === TIMED_OUT) {
      timedOutSources.push(source);
      return fallback;
    }
    return outcome;
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

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(
    @Inject(SEARCH_REPOSITORY) private readonly repo: ISearchRepository,
    @Inject(MEMBER_REPOSITORY) private readonly members: IMemberRepository,
    private readonly rbacService: RbacService,
    // Search is a message read surface, so it owes the same mask as the
    // timeline (#2257). Without it, the one place a member goes looking for
    // text is the one place a blocked member's text still reads in full.
    private readonly chatBlocks: ChatBlockService,
  ) {}

  async search(
    chapterId: string,
    userId: string,
    query: string,
    filters: SearchFilters = {},
  ): Promise<SearchResult> {
    // Spec default: queries shorter than 3 characters return an empty result
    // without touching the database (spec/behavior/search.md).
    const q = runnableQuery(query, filters);
    if (q === null) {
      return emptyResult();
    }
    return this.collect(chapterId, userId, q, (_source, work) => work, filters);
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
   * {@link SEARCH_LIMIT} and a message search with text is index-backed rather
   * than a sequential `ILIKE`, so tripping it should be rare rather than
   * routine. A filter with no text (#3958) is the exception: it has no text
   * match to narrow by, and its cost is spec/behavior/search.md § Message
   * filters'.
   */
  async searchWithinBudget(
    chapterId: string,
    userId: string,
    query: string,
    filters: SearchFilters = {},
  ): Promise<{
    results: SearchResult;
    timedOut: boolean;
    timedOutSources: SearchSource[];
  }> {
    const q = runnableQuery(query, filters);
    if (q === null) {
      return { results: emptyResult(), timedOut: false, timedOutSources: [] };
    }

    const timedOutSources: SearchSource[] = [];
    const results = await this.collect(
      chapterId,
      userId,
      q,
      (source, work, fallback) =>
        withinBudget(source, work, fallback, timedOutSources, this.logger),
      filters,
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
   * channel-scoped query is definitionally a chat search. The response shape is
   * unchanged either way. A message filter (`fromUserId`, `after`, `before`,
   * `has`, #3958) does the same for the same reason: it describes messages, so
   * the other three sources have nothing to answer it with.
   *
   * **This is not a general "chat search is cheap" guarantee, and it would be
   * dishonest to describe it as one.** It skips three sources only for the
   * *single-channel* form. A chat caller searching chapter-wide sends no
   * `channelId` and therefore still pays the full four-source fan-out, exactly
   * as the web Find dialog does — there is no source-selection parameter today.
   * So the saving is real for the default scope and absent for the wide one;
   * any per-keystroke cost argument has to be read with that split in mind.
   */
  private async collect(
    chapterId: string,
    userId: string,
    q: string,
    wrap: SourceWrapper,
    filters: SearchFilters = {},
  ): Promise<SearchResult> {
    if (filters.channelId || messageFiltersOf(filters)) {
      const messages = await wrap(
        'messages',
        this.searchMessages(chapterId, userId, q, filters),
        [],
      );
      return { backwork: [], events: [], members: [], messages };
    }
    // Every source takes the raw query: all four parse it as a full-text query
    // rather than matching it as a substring.
    const [backwork, events, members, messages] = await Promise.all([
      wrap('backwork', this.searchBackwork(chapterId, userId, q), []),
      wrap('events', this.searchEvents(chapterId, userId, q), []),
      wrap('members', this.searchMembers(chapterId, q), []),
      wrap('messages', this.searchMessages(chapterId, userId, q), []),
    ]);
    return { backwork, events, members, messages };
  }

  /**
   * Backwork hits in the chapter, for a caller who may browse the library;
   * how the match works is the repository's.
   *
   * Search must not become a side-channel around the library's own gate:
   * every `/v1/backwork` route requires `backwork:upload` or `backwork:admin`
   * (`spec/behavior/backwork.md` § Taxonomy Admin), while this route needs
   * only `members:view`. Before 2026-11-05 nothing rendered these hits, so the
   * gap was unreachable from a client; the web Find dialog lists them, so a
   * member without either permission (Alumni, or VP or Secretary alone) would
   * otherwise read file titles, courses and terms they cannot open. Same
   * any-of rule as `BackworkController`, wildcard included.
   */
  private async searchBackwork(
    chapterId: string,
    userId: string,
    query: string,
  ): Promise<BackworkResource[]> {
    const mayBrowse = await this.rbacService.memberHasAnyPermission(
      chapterId,
      userId,
      [SystemPermissions.BACKWORK_UPLOAD, SystemPermissions.BACKWORK_ADMIN],
    );
    if (!mayBrowse) return [];
    return this.repo.searchBackwork(chapterId, query, SEARCH_LIMIT);
  }

  /** Event hits in the chapter, filtered to what the caller may see. */
  private async searchEvents(
    chapterId: string,
    userId: string,
    query: string,
  ): Promise<Event[]> {
    const events = await this.repo.searchEvents(chapterId, query, SEARCH_LIMIT);
    return this.filterVisibleEvents(chapterId, userId, events);
  }

  /**
   * Search must not become a side-channel around `EventService`'s read
   * visibility (#1463): a role-targeted event is invisible via `GET
   * /v1/events` to a member without an intersecting role, so it must be
   * invisible here too. The batch form of `isEventVisibleTo`
   * (`event-role-targeting.ts`), as `EventService.findByChapter` is: same
   * `isInvited` predicate, same `events:update` (wildcard-inclusive)
   * management exemption, read once for the whole list. A change to the rule
   * lands in all three.
   */
  private async filterVisibleEvents(
    chapterId: string,
    userId: string,
    events: Event[],
  ): Promise<Event[]> {
    const hasTargetedEvents = events.some(eventLimitsAudience);
    if (!hasTargetedEvents) return events;

    if (
      await this.rbacService.memberHasAnyPermission(chapterId, userId, [
        SystemPermissions.EVENTS_UPDATE,
      ])
    ) {
      return events;
    }

    const member = await this.members.findByUserAndChapter(userId, chapterId);
    const memberRoleIds = member?.role_ids ?? [];

    return events.filter((event) => isInvited(event, memberRoleIds));
  }

  /**
   * Member hits in the chapter. The match is on display name only, so this
   * path can never become an address lookup (see the repository).
   */
  private async searchMembers(
    chapterId: string,
    query: string,
  ): Promise<SearchMemberResult[]> {
    return this.repo.searchMembers(chapterId, query, SEARCH_LIMIT);
  }

  /**
   * Full-text message search, scoped to the channels the caller may read and
   * masked for the caller's block list. How the match works (the indexed
   * `content_search` vector, its parse mode and the stemming trade) is
   * `SupabaseSearchRepository.searchMessages`'.
   */
  private async searchMessages(
    chapterId: string,
    userId: string,
    query: string,
    filters: SearchFilters = {},
  ): Promise<MaskedChatMessage[]> {
    const { channelId } = filters;
    const messageFilters = messageFiltersOf(filters);
    // `sender_id` is a uuid column, so a malformed id would be a 22P02 and a
    // 500. No message has a sender that is not a uuid: the answer is empty.
    if (
      messageFilters?.fromUserId &&
      !UUID_PATTERN.test(messageFilters.fromUserId)
    ) {
      return [];
    }
    // A channel-scoped search is still resolved through `accessibleChannelIds`
    // rather than trusting the caller's id — that is what keeps the single
    // access path this method's comment below insists on. The id is pushed down
    // as a candidate filter rather than applied to the result: narrowing the
    // *candidate* set cannot widen the answer, because `canAccessChannel` still
    // decides every id that comes back, but it does keep a single-channel
    // search from scanning every channel row in the chapter on each debounced
    // keystroke — which on an archive-imported chapter (hundreds of channels)
    // is the difference between a scoped lookup and a chapter-wide scan inside
    // a 500 ms budget.
    //
    // A channel that does not exist, sits in another chapter, or is simply not
    // readable by this caller comes back empty. That is deliberate: a 403 here
    // would answer "does this channel id exist?" for a member who cannot read
    // it, turning search into a channel-existence oracle (the 403-vs-404
    // distinction #1565 is open about elsewhere in chat).
    const accessible = await this.accessibleChannelIds(
      chapterId,
      userId,
      channelId,
    );
    // The push-down above is an optimisation; THIS is the correctness
    // guarantee, and the two are deliberately not merged. Relying on the
    // pushed-down `.eq('id', …)` alone would mean that if that filter is ever
    // dropped or reordered, a channel-scoped search silently widens to every
    // channel the caller can read — still no privilege escalation, but the
    // wrong answer, returned confidently. Keeping the intersection makes the
    // narrow result true by construction rather than by query shape.
    const channelIds = channelId
      ? accessible.filter((id) => id === channelId)
      : accessible;
    if (!channelIds.length) return [];

    // The filters (#3958) go to the repository beside `channelIds`, never
    // instead of it: sender, date and content narrow the rows of channels this
    // caller has already been cleared to read, so no filter value can reach a
    // message outside that set.
    const messages = await (messageFilters
      ? this.repo.searchMessages(
          channelIds,
          query,
          SEARCH_LIMIT,
          messageFilters,
        )
      : this.repo.searchMessages(channelIds, query, SEARCH_LIMIT));

    // The caller's block list, applied to what search serves — the same rule
    // `ChatService.getMessages` applies, through the same pure function, so the
    // two cannot drift (#2257, `spec/behavior/chat/README.md` § The masking
    // contract).
    //
    // Read AFTER the match rather than concurrently with it, and that is the
    // cheap half of a deliberate trade: `searchMessages` returns early in several
    // places above (short channel list, no accessible channels), and a
    // `Promise.all` would issue the block read on every one of them. The rows
    // are already in hand and capped at `SEARCH_LIMIT`, so the extra round trip
    // is bounded.
    //
    // **Not defended against.** A failed block-list read propagates and this
    // source is a 500 — "a block list that cannot be read is not an empty block
    // list". Note what that interacts with: `withinBudget` degrades a source
    // that misses the 500ms budget to an empty array, so the worst case here is
    // no message results, never unmasked ones.
    const blockedUserIds = await this.chatBlocks.listBlockedUserIds(
      chapterId,
      userId,
    );
    return maskBlockedMessages(messages, blockedUserIds);
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
    /**
     * Optional candidate narrowing. Purely a *reduction* of the rows considered
     * — every id returned has still passed `canAccessChannel`, so this can make
     * the answer smaller but never larger. The chapter filter is not relaxed by
     * it, so an id from another chapter matches nothing.
     */
    onlyChannelId?: string,
  ): Promise<string[]> {
    const channels = await this.repo.findChannelsForAccess(
      chapterId,
      onlyChannelId,
    );
    if (!channels.length) return [];

    const member = await this.members.findByUserAndChapter(userId, chapterId);
    if (!member) return [];

    // Resolve through RbacService, as chat channel access does: search must
    // never disagree with chat about which role-gated channels a member can
    // read.
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
