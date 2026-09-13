import type { CanActivate, ExecutionContext, Type } from '@nestjs/common';

/**
 * The guard-populated request fields these stubs stand in for.
 *
 * Typing the request is the point: the real guards are the only writers of
 * these properties, and `getRequest()` is `any`, so an unannotated stub will
 * happily set a misspelled field and the route then reads `undefined` from a
 * green test. Declaring the shape makes that a compile error instead.
 */
interface GuardPopulatedRequest {
  /** Set by `SupabaseAuthGuard` from the verified JWT. */
  supabaseUser?: { id: string; email: string };
  /** Set by `AuthSyncInterceptor`; read by `@CurrentUser()`. */
  appUser?: { id: string };
  /** Set by `ChapterGuard` after confirming a membership row. */
  member?: { id: string; role_ids: string[] };
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
 * `request.member.id`. Every e2e caller uses this one value, so it is a fixture
 * constant rather than a parameter — add one to {@link GuardStubIdentity} at the
 * point a spec actually needs a different member row, not in advance.
 */
const STUB_MEMBER_ID = 'member-1';

/**
 * Stubs for `SupabaseAuthGuard` and `ChapterGuard` that populate the request the
 * way the real chain does, without a JWT or a membership lookup.
 *
 * Nine e2e specs hand-rolled these two classes, byte-identical apart from the
 * four identity strings above, so a change to what the real guards put on the
 * request had nine places to reach and no way to tell it had missed one. Use
 * with {@link PermissionsGuardStub}:
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
      req.member = { id: STUB_MEMBER_ID, role_ids: roleIds };
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
