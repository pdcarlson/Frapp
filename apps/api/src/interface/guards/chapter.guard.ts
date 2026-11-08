import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PostgrestMaybeSingleResponse } from '@supabase/supabase-js';
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
import { InFlightLookups, lookupUnavailable } from './guard-lookup';

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
 * routes. `InFlightLookups` shares a lookup only while it is in flight, so
 * no answer here is older than the request that receives it.
 */
const appUserLookups = new InFlightLookups<
  PostgrestMaybeSingleResponse<{ id: string }>
>();
const memberLookups = new InFlightLookups<
  PostgrestMaybeSingleResponse<MemberContext>
>();
const chapterLookups = new InFlightLookups<
  PostgrestMaybeSingleResponse<ChapterRow>
>();

function lookupAppUser(
  supabase: FrappSupabaseClient,
  supabaseAuthId: string,
): Promise<PostgrestMaybeSingleResponse<{ id: string }>> {
  return appUserLookups.run(supabaseAuthId, () =>
    supabase
      .from('users')
      .select('id')
      .eq('supabase_auth_id', supabaseAuthId)
      .maybeSingle<{ id: string }>(),
  );
}

function lookupChapter(
  supabase: FrappSupabaseClient,
  chapterId: string,
): Promise<PostgrestMaybeSingleResponse<ChapterRow>> {
  return chapterLookups.run(chapterId, () =>
    supabase
      .from('chapters')
      .select('subscription_status, past_due_since, enabled_modules')
      .eq('id', chapterId)
      .maybeSingle<ChapterRow>(),
  );
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
    const requested = this.readRequestedChapter(request);
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
      throw requested.error;
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

    // Copies: a lookup's result is shared by every request that joined it.
    request.appUser = { id: appUser.id };
    request.member = structuredClone(member);
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
   * place after the user lookup.
   */
  private readRequestedChapter(
    request: RequestContext,
  ):
    | { kind: 'explicit'; chapterId: string }
    | { kind: 'auto' }
    | { kind: 'refused'; error: ForbiddenException } {
    const jwtChapterId = getActiveChapterClaim(request.jwtClaims);
    const headerChapterId = getHeaderValue(request.headers, 'x-chapter-id');

    if (
      jwtChapterId &&
      headerChapterId &&
      jwtChapterId.toLowerCase() !== headerChapterId.toLowerCase()
    ) {
      return {
        kind: 'refused',
        error: new ForbiddenException({
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
        error: new ForbiddenException({
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

  /** Rule 4 of `readRequestedChapter`: neither the claim nor the header. */
  private async resolveSoleChapter(
    appUserId: string,
  ): Promise<{ chapterId: string; member?: MemberContext }> {
    // Two rows is all it takes to tell "exactly one" from "more than one".
    const { data: memberships, error: membershipsError } = await this.supabase
      .from('members')
      .select('id, role_ids, custom_role_ids, chapter_id')
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
    const { data, error } = await memberLookups.run(
      `${appUserId}:${chapterId}`,
      () =>
        this.supabase
          .from('members')
          .select('id, role_ids, custom_role_ids')
          .eq('user_id', appUserId)
          .eq('chapter_id', chapterId)
          .maybeSingle<MemberContext>(),
    );

    if (error) {
      throw lookupUnavailable(LOOKUP_FAILED, new SupabaseQueryError(error));
    }
    return data ?? null;
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
