import type { CanActivate, ExecutionContext, Type } from '@nestjs/common';
import type {
  AppUserContext,
  MemberContext,
} from '../../src/interface/types/request-context.types';

/**
 * The slice of the request these stubs write.
 *
 * `appUser` and `member` are the canonical `RequestContext` types rather than a
 * local restatement, so a field added to or renamed on either reaches this file
 * by reference instead of by someone remembering. Two caveats, both deliberate:
 *
 * - `supabaseUser` is narrowed. The real field is Supabase's `User`, which has a
 *   dozen required properties (`app_metadata`, `aud`, `created_at`, …) that no
 *   route under test reads; declaring it in full would force every call site to
 *   build a fake `User` or cast. `analytics-identity.e2e-spec.ts:31` narrows it
 *   the same way for the same reason. A spec that needs `user_metadata` — which
 *   `AuthSyncInterceptor` does read — must widen this, not cast past it.
 * - This is documentation strength, not gate strength. `apps/api/test` sits
 *   outside the only typecheck the repo gates on — `tsconfig.build.json`
 *   excludes `test` and every spec file — and ts-jest transpiles without type
 *   checking, so nothing here fails CI on a type error. Tracked as a standing
 *   finding; do not read these annotations as a gate.
 */
interface GuardPopulatedRequest {
  /** Set by `SupabaseAuthGuard` from the verified JWT (narrowed — see above). */
  supabaseUser?: { id: string; email: string };
  /** Set by `ChapterGuard`, and overwritten by `AuthSyncInterceptor` on the
   *  controllers that declare it; read by `@CurrentUser()`. */
  appUser?: AppUserContext;
  /** Set by `ChapterGuard` after confirming a membership row. */
  member?: MemberContext;
  /** Set by `ChapterGuard`; read by `@CurrentChapterId()`. */
  chapterId?: string;
}

/** Who the stubbed guard chain says the caller is. */
export interface GuardStubIdentity {
  /** `request.supabaseUser.id` — the Supabase auth subject the stubbed JWT stands for. */
  authUserId: string;
  /** `request.supabaseUser.email`. */
  email: string;
  /** `request.appUser.id` — the `users` row id `@CurrentUser()` reads. */
  appUserId: string;
  /** `request.member.role_ids` — what `PermissionsGuard` would resolve against. */
  roleIds: string[];
  /** `request.chapterId` — what `@CurrentChapterId()` reads. */
  chapterId: string;
}

/**
 * `request.member.id`. Every caller uses this one value, so it is a fixture
 * constant rather than a parameter. A spec needing a different member row adds
 * an **optional** `memberId?: string` to {@link GuardStubIdentity} defaulting to
 * this — optional, because a required field is a breaking change to every call
 * site and the next author will hand-roll a stub rather than pay it.
 *
 * Exported because `membership-roles.e2e-spec.ts` asserts the actor id
 * `@CurrentMember()` resolves, and an assertion on a bare `'member-1'` literal
 * would silently need editing if this moved.
 */
export const STUB_MEMBER_ID = 'member-1';

/**
 * Stubs for `SupabaseAuthGuard` and `ChapterGuard` that populate the request the
 * way the real chain does, without a JWT or a membership lookup.
 *
 * Nine e2e specs hand-rolled these two classes, varying only in the identity
 * strings above, so a change to what the real guards put on the request had nine
 * places to reach and no way to tell it had missed one. Use with
 * {@link PermissionsGuardStub}:
 *
 * ```ts
 * const { AuthGuardStub, ChapterGuardStub } = createGuardStubs({
 *   authUserId: 'auth-user-1',
 *   email: 'member@example.com',
 *   appUserId: 'user-1',
 *   roleIds: ['role-member'],
 *   chapterId: 'chapter-1',
 * });
 * ```
 *
 * **Two e2e specs deliberately do not use this**, and the exceptions are named
 * here so the claim above is checkable rather than vacuous:
 * `settings-quiet-hours-tz.e2e-spec.ts` sets `appUser` inside its *auth* stub
 * because `PATCH /v1/settings` carries only the class-level `SupabaseAuthGuard`
 * and its `ChapterGuard` override never runs; `analytics-identity.e2e-spec.ts`
 * needs a mutable `jwtClaims` per test. Neither shape is expressible here, and
 * widening this factory to cover them would be the speculative kind of
 * machinery. A guard-chain change has to reach all three.
 *
 * These stubs supply `chapterId` unconditionally, so a spec using them **cannot
 * catch a tenancy regression** — `cross-tenant-isolation.e2e-spec.ts` is the
 * suite that runs the real `ChapterGuard` for that, and it overrides only
 * `PermissionsGuard`.
 */
export function createGuardStubs(identity: GuardStubIdentity): {
  AuthGuardStub: Type<CanActivate>;
  ChapterGuardStub: Type<CanActivate>;
} {
  const { authUserId, email, appUserId, roleIds, chapterId } = identity;

  class AuthGuardStub implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<GuardPopulatedRequest>();
      req.supabaseUser = { id: authUserId, email };
      return true;
    }
  }

  class ChapterGuardStub implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<GuardPopulatedRequest>();
      req.appUser = { id: appUserId };
      // Copied, not shared: the hand-rolled stubs this replaces built a fresh
      // array per request, and one instance reachable from every request in a
      // suite is a difference worth not having.
      req.member = { id: STUB_MEMBER_ID, role_ids: [...roleIds] };
      req.chapterId = chapterId;
      return true;
    }
  }

  return { AuthGuardStub, ChapterGuardStub };
}

/**
 * Allows every route, so a spec asserts its own subject rather than the RBAC
 * lookup. Parameterless — a spec that needs permissions actually enforced runs
 * the real `PermissionsGuard` instead of configuring this one.
 */
export class PermissionsGuardStub implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}
