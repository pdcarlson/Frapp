import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as Sentry from '@sentry/nestjs';
import type {
  PostgrestError,
  JwtPayload,
  PostgrestMaybeSingleResponse,
} from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  MemberContext,
  RequestContext,
  getActiveChapterClaim,
  getHeaderValue,
} from '../types/request-context.types';
import {
  SUBSCRIPTION_EXEMPT_KEY,
  SUBSCRIPTION_FREE_TIER_KEY,
  SUBSCRIPTION_GRACE_BLOCKED_KEY,
} from '../decorators/subscription.decorator';
import { REQUIRED_MODULE_KEY } from '../decorators/module.decorator';
import type { SubscriptionStatus } from '#domain/entities/chapter.entity';
import {
  assertModuleEnabled,
  type EnabledModules,
} from '../../application/services/module-gate';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { isWithinSubscriptionGrace } from '#domain/constants/subscription-grace';
import { SupabaseQueryError } from '../../infrastructure/supabase/supabase-query-error';
import { lookupUnavailable } from './guard-lookup';
import { InFlightLookups } from '../../infrastructure/supabase/in-flight-lookups';
import {
  memberReadKey,
  readMemberByUserAndChapter,
} from '../../infrastructure/supabase/repositories/supabase-member.repository';
import {
  readRolesByIds,
  rolesReadKey,
} from '../../infrastructure/supabase/repositories/supabase-role.repository';
import {
  keepForRequest,
  readOncePerRequest,
  requestReadsActive,
  sharesBurstLookups,
} from '../../infrastructure/supabase/request-reads';
import type { Member } from '#domain/entities/member.entity';
import type { Role } from '#domain/entities/role.entity';

/**
 * Every lookup here tells "no row" (`.maybeSingle()`'s `null`, the 4xx it
 * always was) from "the lookup failed" (an `error`, a 503 with the query as
 * its cause; `lookupUnavailable`, #3143), so a pool exhaustion or a statement
 * timeout no longer tells a valid member they are not one.
 */
const LOOKUP_FAILED = 'Could not verify your chapter membership right now';

// A `RegExp` rather than a literal: `subscription-refusal-parity.test.mjs`
// scans this file and cannot read regex literals.
const UUID_PATTERN = new RegExp(
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  'i',
);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type ChapterRow = {
  subscription_status: SubscriptionStatus;
  past_due_since: string | null;
  enabled_modules: Record<string, boolean> | null;
};

/**
 * Process-wide, not per guard instance: Nest builds a guard per module, and
 * the requests a mobile resume fires together (#3728) hit several modules'
 * routes. These two share the user's own row id, and the chapter's
 * subscription state and module toggles, on the guard's own reads. With a
 * chapter named, the prefetch gets both rows, the membership and the roles
 * from `get_request_context` (#3583), and that call is shared the same way
 * (`requestContextLookups`), for read requests only. A joiner's answer can
 * predate its request by up to `IN_FLIGHT_JOIN_WINDOW_MS`, the bound Paul
 * accepted for membership and roles on 2026-11-13 (#3752;
 * spec/behavior/multi-tenancy.md and rbac.md).
 */
const appUserLookups = new InFlightLookups<
  PostgrestMaybeSingleResponse<{ id: string }>
>();
const chapterLookups = new InFlightLookups<
  PostgrestMaybeSingleResponse<ChapterRow>
>();
const requestContextLookups = new InFlightLookups<{
  data: unknown;
  error: PostgrestError | null;
}>();

/** Carries a failed PostgREST answer out of `readOncePerRequest` as a rejection. */
class FailedLookup<T> extends Error {
  constructor(readonly response: T) {
    super('lookup failed');
  }
}

/**
 * `readOncePerRequest` for a PostgREST answer, keeping only a real one. A
 * failed lookup resolves (`{ data: null, error }`) rather than rejecting, so
 * it is turned into a rejection the store forgets, and the guard's own call
 * reads again instead of reusing a failure the prefetch hit (#3728). Each
 * caller still gets the failed answer itself, as it always did.
 */
async function keepAnswerForRequest<T extends { error: unknown }>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  try {
    return await readOncePerRequest(key, async () => {
      const response = await load();
      if (response.error) throw new FailedLookup(response);
      return response;
    });
  } catch (failure) {
    if (failure instanceof FailedLookup) return failure.response as T;
    throw failure;
  }
}

function lookupAppUser(
  supabase: FrappSupabaseClient,
  supabaseAuthId: string,
  viaContext?: Promise<RequestContextAnswer | null>,
): Promise<PostgrestMaybeSingleResponse<{ id: string }>> {
  const read = () =>
    appUserLookups.run(supabaseAuthId, () =>
      supabase
        .from('users')
        .select('id')
        .eq('supabase_auth_id', supabaseAuthId)
        .maybeSingle<{ id: string }>(),
    );
  return keepAnswerForRequest(`chapter-guard:user:${supabaseAuthId}`, () =>
    viaContext
      ? viaContext.then((answer) => (answer ? foundRow(answer.user) : read()))
      : read(),
  );
}

function lookupChapter(
  supabase: FrappSupabaseClient,
  chapterId: string,
  viaContext?: Promise<RequestContextAnswer | null>,
): Promise<PostgrestMaybeSingleResponse<ChapterRow>> {
  const read = () =>
    chapterLookups.run(chapterId, () =>
      supabase
        .from('chapters')
        .select('subscription_status, past_due_since, enabled_modules')
        .eq('id', chapterId)
        .maybeSingle<ChapterRow>(),
    );
  return keepAnswerForRequest(`chapter-guard:chapter:${chapterId}`, () =>
    viaContext
      ? viaContext.then((answer) =>
          answer ? foundRow(answer.chapter) : read(),
        )
      : read(),
  );
}

/** A row `get_request_context` returned, in the shape `.maybeSingle()` gives. */
function foundRow<T>(row: T | null): PostgrestMaybeSingleResponse<T> {
  return {
    data: row,
    error: null,
    count: null,
    status: 200,
    statusText: 'OK',
    success: true,
  };
}

/**
 * `get_request_context`'s answer (migration `20261112151000`): the rows this
 * guard, `PermissionsGuard` and the handler's access checks would otherwise
 * read one after another, from one call.
 */
interface RequestContextAnswer {
  user: { id: string } | null;
  chapter: ChapterRow | null;
  member: Member | null;
  roles: Role[];
}

/**
 * One call for the user, chapter, membership and roles (#3583). Before it the
 * prefetch read them as a chain (user, then membership, then roles), about
 * 320 ms at production's p50 on 2026-11-12, while the session check it
 * overlaps took 134 ms. Resolves `null` when the call fails or answers
 * something unexpected (`reportRequestContextFailure`), and the prefetch then
 * reads the rows as it did before #3583, one failed call later.
 *
 * Before resolving it records the membership and roles in the request's store
 * under the keys `readMemberByUserAndChapter` and `readRolesByIds` read, so
 * the guards and the handler find them there. The user and chapter rows are
 * resolved through `lookupAppUser` and `lookupChapter`, which wait on this.
 * The membership is recorded under the user id this call found, and only
 * that, so a session whose user differs from the token's `sub` reuses none of
 * it.
 */
function readRequestContext(
  supabase: FrappSupabaseClient,
  supabaseAuthId: string,
  chapterId: string,
): Promise<RequestContextAnswer | null> {
  // Shared by the read requests of one burst with this user and chapter
  // (#3752); a request that may write makes its own call. Each request still
  // records the answer in its own store below, and every reader gets its own
  // copy from there (`readOncePerRequest`). The call runs inside a promise
  // either way, so a client that throws instead of answering an error still
  // lands in the `catch` below.
  const call = () =>
    supabase.rpc('get_request_context', {
      p_auth_id: supabaseAuthId,
      p_chapter_id: chapterId,
    });
  return (
    sharesBurstLookups()
      ? requestContextLookups.run(`${supabaseAuthId}:${chapterId}`, call)
      : Promise.resolve().then(call)
  )
    .then(({ data, error }) => {
      if (error) throw new SupabaseQueryError(error);
      const answer = asRequestContext(data);
      if (!answer) throw new Error('get_request_context: unexpected answer');
      if (answer.user) {
        keepForRequest(memberReadKey(answer.user.id, chapterId), answer.member);
        const roleIds = answer.member?.role_ids ?? [];
        if (roleIds.length) {
          keepForRequest(rolesReadKey(roleIds, chapterId), answer.roles);
        }
      }
      return answer;
    })
    .catch((failure: unknown) => {
      reportRequestContextFailure(failure);
      return null;
    });
}

const FAILURE_REPORT_INTERVAL_MS = 10 * 60 * 1000;
let lastFailureReportAt = Number.NEGATIVE_INFINITY;

/**
 * A failed `get_request_context` costs no request anything but time, because
 * the rows are read separately (`prefetchChapterContext`), so nothing else
 * would ever report it: a dropped function, a lost grant or a `role_ids`
 * entry that is not a uuid would only show up as latency. One Sentry warning
 * per process every ten minutes, grouped as one issue, says so without
 * spending the error quota on every request.
 */
function reportRequestContextFailure(failure: unknown): void {
  const now = Date.now();
  if (now - lastFailureReportAt < FAILURE_REPORT_INTERVAL_MS) return;
  lastFailureReportAt = now;
  Sentry.captureException(failure, {
    level: 'warning',
    fingerprint: ['get_request_context-failed'],
    tags: { guard: 'chapter-prefetch' },
  });
}

function asRequestContext(data: unknown): RequestContextAnswer | null {
  if (!data || typeof data !== 'object') return null;
  const answer = data as Partial<RequestContextAnswer>;
  if (!('user' in answer) || !('chapter' in answer) || !('member' in answer)) {
    return null;
  }
  if (!Array.isArray(answer.roles)) return null;
  return answer as RequestContextAnswer;
}

/**
 * Starts this guard's reads while `SupabaseAuthGuard` is still waiting on
 * `auth.getUser` (#3728), so the user, chapter, membership and role lookups
 * overlap the session check instead of queueing behind it. With a chapter
 * named, they are one call (`readRequestContext`, #3583).
 *
 * Nothing here decides anything. The reads land in the request's own store
 * (`request-reads.ts`), and `ChapterGuard` and `PermissionsGuard` pick them up
 * only once the session check has passed, under the user id `getUser`
 * returned. They are keyed by that id, so a token whose verified `sub` were
 * somehow not the user `getUser` answers with would find nothing to reuse.
 * Requests of one burst share these reads within `IN_FLIGHT_JOIN_WINDOW_MS`
 * (#3752, Paul 2026-11-13); past that, each reads its own. A failed read is not
 * kept (`keepAnswerForRequest`), so the guard that needs it reads again. If
 * the one call fails, the user and chapter are read separately and the
 * membership and roles chained after the user, as before #3583.
 *
 * Without a store (no request, or past the guards of a write) it does
 * nothing.
 */
export function prefetchChapterContext(
  supabase: FrappSupabaseClient,
  supabaseAuthId: string,
  claims: JwtPayload | undefined,
  headers: RequestContext['headers'],
): void {
  if (!requestReadsActive()) return;

  const requested = readRequestedChapter(claims, headers);
  if (requested.kind !== 'explicit') {
    lookupAppUser(supabase, supabaseAuthId).catch(ignorePrefetchFailure);
    return;
  }

  const context = readRequestContext(
    supabase,
    supabaseAuthId,
    requested.chapterId,
  );
  const appUser = lookupAppUser(supabase, supabaseAuthId, context);
  lookupChapter(supabase, requested.chapterId, context).catch(
    ignorePrefetchFailure,
  );
  const { chapterId } = requested;
  context
    .then((answer) =>
      answer
        ? null
        : appUser
            .then(({ data }) =>
              data
                ? readMemberByUserAndChapter(supabase, data.id, chapterId)
                : null,
            )
            .then((member) =>
              member?.role_ids?.length
                ? readRolesByIds(supabase, member.role_ids, chapterId)
                : null,
            ),
    )
    .catch(ignorePrefetchFailure);
}

/** The guard that needs the read makes it again and reports its failure. */
function ignorePrefetchFailure(): void {}

/**
 * Reads the active chapter the caller named, per
 * spec/behavior/multi-tenancy.md:
 *
 * 1. The JWT `active_chapter_id` claim is authoritative.
 * 2. `x-chapter-id` is a fallback for clients that have not refreshed their
 *    token since the claim was introduced.
 * 3. Both present and disagreeing is a hard `403 chapter.context.mismatch` —
 *    the header never overrides the JWT.
 * 4. Neither present: a single-chapter user is auto-resolved server-side
 *    (`resolveSoleChapter`); anyone else gets `400 chapter.context.required`.
 *
 * A refusal is returned, not thrown, so the caller can report it in its
 * place after the user lookup. A plain function of the claims and headers,
 * so `prefetchChapterContext` resolves the same chapter the guard will.
 */
function readRequestedChapter(
  claims: JwtPayload | undefined,
  headers: RequestContext['headers'],
):
  | { kind: 'explicit'; chapterId: string }
  | { kind: 'auto' }
  | { kind: 'refused'; refusal: ForbiddenException } {
  const jwtChapterId = getActiveChapterClaim(claims);
  const headerChapterId = getHeaderValue(headers, 'x-chapter-id');

  if (
    jwtChapterId &&
    headerChapterId &&
    jwtChapterId.toLowerCase() !== headerChapterId.toLowerCase()
  ) {
    return {
      kind: 'refused',
      refusal: new ForbiddenException({
        code: 'chapter.context.mismatch',
        message:
          'The x-chapter-id header disagrees with the active chapter in your token.',
      }),
    };
  }

  const explicit = jwtChapterId ?? headerChapterId;
  if (!explicit) return { kind: 'auto' };

  // A chapter id that is not a uuid names no chapter, so it is refused as
  // one the caller is not a member of. Checked here because Postgres
  // answers a malformed uuid comparison with an error (22P02), not zero
  // rows, which the membership lookup would now report as a 503 (#3143).
  if (!UUID_PATTERN.test(explicit)) {
    return {
      kind: 'refused',
      refusal: new ForbiddenException({
        code: 'chapter.context.invalid',
        message: 'You are not a member of the requested chapter.',
      }),
    };
  }
  // #688: Postgres `uuid` comparison is case-insensitive, so an
  // uppercase-cased header/claim is authorized normally — but storage
  // prefix math (profileFolderPrefix, backwork/chapter-document/chat
  // attachment paths, the chapter logo path) is exact-case string
  // concatenation. Normalizing once here, at the single place every
  // `@CurrentChapterId()` consumer reads from, keeps every write path
  // canonical without patching each storage key builder individually —
  // and matches what a chapter-id column read back from the DB already
  // is, since `chapters.id` is always generated lowercase.
  return { kind: 'explicit', chapterId: explicit.toLowerCase() };
}

@Injectable()
export class ChapterGuard implements CanActivate {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestContext>();

    const supabaseUser = request.supabaseUser;
    if (!supabaseUser) {
      throw new ForbiddenException(
        'Authentication required before chapter check',
      );
    }

    // Read before any lookup so an explicit chapter's row can be fetched
    // alongside the user's, one round trip instead of two (#3728). A refusal
    // is held until the user lookup has been judged, which keeps the order
    // callers always saw: a missing profile is reported before a bad chapter.
    const requested = readRequestedChapter(request.jwtClaims, request.headers);
    const explicitChapterId =
      requested.kind === 'explicit' ? requested.chapterId : undefined;

    const [appUserResult, prefetchedChapter] = await Promise.all([
      lookupAppUser(this.supabase, supabaseUser.id),
      explicitChapterId
        ? lookupChapter(this.supabase, explicitChapterId)
        : undefined,
    ]);

    const { data: appUser, error: appUserError } = appUserResult;
    if (appUserError) {
      throw lookupUnavailable(
        LOOKUP_FAILED,
        new SupabaseQueryError(appUserError),
      );
    }
    if (!appUser) {
      throw new ForbiddenException('User profile not found');
    }
    if (requested.kind === 'refused') {
      throw requested.refusal;
    }

    // Resolved after the user, because auto-resolving a single-chapter user
    // requires knowing which memberships they hold.
    const resolved = explicitChapterId
      ? { chapterId: explicitChapterId }
      : await this.resolveSoleChapter(appUser.id);
    const chapterId = resolved.chapterId;

    // The auto-resolve path already read the membership row it selected the
    // chapter from; only an explicitly supplied chapter needs verifying.
    const member =
      resolved.member ?? (await this.findMembership(appUser.id, chapterId));

    if (!member) {
      throw new ForbiddenException({
        code: 'chapter.context.invalid',
        message: 'You are not a member of the requested chapter.',
      });
    }

    const { data: chapter, error: chapterError } =
      prefetchedChapter ?? (await lookupChapter(this.supabase, chapterId));

    if (chapterError) {
      throw lookupUnavailable(
        LOOKUP_FAILED,
        new SupabaseQueryError(chapterError),
      );
    }
    if (!chapter) {
      throw new ForbiddenException('Chapter not found');
    }

    // Copies of the two shared lookups (`appUserLookups`, `chapterLookups`):
    // their results go to every request that joined them.
    request.appUser = { id: appUser.id };
    request.member = member;
    request.chapterId = chapterId;
    request.subscriptionStatus = chapter.subscription_status;
    request.enabledModules = structuredClone(chapter.enabled_modules);

    this.enforceSubscription(
      context,
      request.method,
      chapter.subscription_status,
      chapter.past_due_since,
    );

    // After the subscription check: a lapsed chapter's billing state is the
    // more actionable error, and a module toggle is meaningless while every
    // write is already locked.
    this.enforceModule(context, request.method, chapter.enabled_modules);

    return true;
  }

  /** Rule 4 of `readRequestedChapter`: neither the claim nor the header. */
  private async resolveSoleChapter(
    appUserId: string,
  ): Promise<{ chapterId: string; member?: MemberContext }> {
    // Two rows is all it takes to tell "exactly one" from "more than one".
    const { data: memberships, error: membershipsError } = await this.supabase
      .from('members')
      .select('id, role_ids, chapter_id')
      .eq('user_id', appUserId)
      .limit(2);

    // Without this a failed read fell through to `chapter.context.required`,
    // a 400 telling a single-chapter member to pick a chapter they already have.
    if (membershipsError) {
      throw lookupUnavailable(
        LOOKUP_FAILED,
        new SupabaseQueryError(membershipsError),
      );
    }

    if (memberships?.length === 1) {
      const sole = memberships[0] as MemberContext & { chapter_id: string };
      return { chapterId: sole.chapter_id, member: sole };
    }

    throw new BadRequestException({
      code: 'chapter.context.required',
      message:
        'Active chapter context is required. Send the x-chapter-id header or refresh your session after selecting a chapter.',
    });
  }

  private async findMembership(
    appUserId: string,
    chapterId: string,
  ): Promise<MemberContext | null> {
    let row: Awaited<ReturnType<typeof readMemberByUserAndChapter>>;
    try {
      // The same read the handler's access checks make, so a GET shares it
      // with them instead of repeating it (`request-reads.ts`, #3728).
      row = await readMemberByUserAndChapter(
        this.supabase,
        appUserId,
        chapterId,
      );
    } catch (error) {
      if (error instanceof SupabaseQueryError) {
        throw lookupUnavailable(LOOKUP_FAILED, error);
      }
      throw error;
    }
    return row ? { id: row.id, role_ids: row.role_ids } : null;
  }

  /** Overridable seam so tests can pin "now" without real clocks. */
  protected currentTime(): number {
    return Date.now();
  }

  /**
   * The 3-day grace rule lives in `#domain/constants/subscription-grace` so
   * the one unguarded write that has to evaluate it (invite redemption,
   * #1546) reads the same window this guard does.
   */
  private isWithinGrace(pastDueSince: string | null): boolean {
    return isWithinSubscriptionGrace(pastDueSince, this.currentTime());
  }

  private enforceSubscription(
    context: ExecutionContext,
    method: string,
    status: SubscriptionStatus,
    pastDueSince: string | null,
  ): void {
    const isExempt = this.reflector.getAllAndOverride<boolean>(
      SUBSCRIPTION_EXEMPT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isExempt) return;

    if (READ_METHODS.has(method.toUpperCase())) return;

    if (status === 'canceled') {
      throw new ForbiddenException({
        code: 'chapter.subscription.canceled',
        message: 'Chapter subscription is canceled; this chapter is read-only.',
      });
    }

    if (status === 'active') return;

    const isFreeTier = this.reflector.getAllAndOverride<boolean>(
      SUBSCRIPTION_FREE_TIER_KEY,
      [context.getHandler(), context.getClass()],
    );

    // past_due: grace-aware. Evaluate the window before consulting free-tier so
    // invite/create stays blocked during grace and ALL writes stop after it.
    if (status === 'past_due') {
      if (this.isWithinGrace(pastDueSince)) {
        const isGraceBlocked = this.reflector.getAllAndOverride<boolean>(
          SUBSCRIPTION_GRACE_BLOCKED_KEY,
          [context.getHandler(), context.getClass()],
        );
        // @GraceBlocked only carves invite/create out of the free-tier wedge.
        // On a non-free-tier (paid-ops) route it is meaningless — that route is
        // already write_locked below — so only emit invite_blocked for a
        // free-tier route to avoid a misleading code on a misconfigured handler.
        if (isGraceBlocked && isFreeTier) {
          throw new ForbiddenException({
            code: 'chapter.subscription.invite_blocked',
            message:
              'Chapter subscription is past due; new invites are blocked until payment is resolved.',
          });
        }
        if (isFreeTier) return;
      }

      // Paid-ops writes during grace, and every write after grace, are blocked.
      throw new ForbiddenException({
        code: 'chapter.subscription.write_locked',
        message:
          'Chapter subscription is past due; write actions are blocked until payment is resolved.',
      });
    }

    if (isFreeTier) return;

    if (status === 'incomplete') {
      throw new ForbiddenException({
        code: 'chapter.subscription.required',
        message:
          'Chapter subscription is not active; complete checkout to use this feature.',
      });
    }
  }

  /**
   * Server-side half of the module gate (#264). The web client hides disabled
   * modules from the sidebar, the Cmd+K menu, and the slash-command palette,
   * but a direct API call bypasses all three — so the write is rejected here
   * regardless of client.
   *
   * Two deliberate asymmetries with `enforceSubscription`:
   *
   * - **Writes only.** `spec/product/modules.md` promises "Data is preserved —
   *   re-enabling restores access", so reads of a disabled module's data keep
   *   working; the toggle freezes a surface, it does not strand data.
   * - **Enabled unless explicitly `false`**, via the shared `isModuleEnabled`
   *   predicate in `@repo/validation` — the same one the web surfaces use, so
   *   the client's idea of "off" cannot drift from the server's.
   *
   * Route metadata can't see a request body, so a module write that shares a
   * route with an always-on module (a `kind: "poll"` chat message, a vote on a
   * poll card) is gated in its service instead, from the `enabledModules` this
   * guard leaves on the request (#2993).
   */
  private enforceModule(
    context: ExecutionContext,
    method: string,
    enabledModules: EnabledModules,
  ): void {
    if (READ_METHODS.has(method.toUpperCase())) return;

    const moduleKey = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRED_MODULE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!moduleKey) return;

    assertModuleEnabled(enabledModules, moduleKey);
  }
}
