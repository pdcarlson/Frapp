import type {
  CanActivate,
  ExecutionContext,
  ModuleMetadata,
  Type,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { SupabaseAuthGuard } from '../../src/interface/guards/supabase-auth.guard';
import { ChapterGuard } from '../../src/interface/guards/chapter.guard';
import { PermissionsGuard } from '../../src/interface/guards/permissions.guard';
import type {
  AppUserContext,
  MemberContext,
} from '../../src/interface/types/request-context.types';

/**
 * The slice of the request these stubs write.
 *
 * `appUser` and `member` are the canonical `RequestContext` types rather than a
 * local restatement, so a field added to or renamed on either reaches this file
 * by reference instead of by someone remembering. Three caveats, all deliberate,
 * and each one a place where that reference does *not* do the work:
 *
 * - **`supabaseUser` is not the real type.** Supabase's `User` has five required
 *   members — `id`, `app_metadata`, `user_metadata`, `aud`, `created_at` — none
 *   of which any route these stubs serve reads, so declaring it in full would
 *   make every call site build a fake `User` or cast past it. Note the shape
 *   below is not a strict narrowing: `email` is *optional* on the real `User`
 *   and required here, because every current caller supplies one. A spec that
 *   needs `user_metadata` (`AuthSyncInterceptor` reads it) has to widen this.
 * - **`ChapterGuardStub` writes a subset of `member`.** The real `ChapterGuard`
 *   selects `id, role_ids, custom_role_ids, chapter_id` and assigns the whole
 *   row; this writes `{ id, role_ids }`. `custom_role_ids` is optional on
 *   `MemberContext`, so the canonical type will **not** flag its absence: a spec
 *   that keeps the real `PermissionsGuard` for a custom-role-gated route must
 *   set it itself, or `permissions.guard.ts` resolves zero custom roles and the
 *   route 403s for a reason that has nothing to do with the assertion.
 * - **This is documentation strength, not gate strength.** `apps/api/test` sits
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
 * {@link AllowAllGuard}:
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
 *
 * - `settings-quiet-hours-tz.e2e-spec.ts`. `PATCH /v1/settings` carries only the
 *   class-level `SupabaseAuthGuard`, so a `ChapterGuardStub` would never run —
 *   and `appUser` there comes from neither stub but from the class-level
 *   `AuthSyncInterceptor`, which runs *after* the guards and overwrites
 *   `request.appUser` with `{ id }` from `AuthService.syncUser`. Setting
 *   `appUser` in a guard stub on that route is dead code; the spec mocks
 *   `AuthService` instead, and says so at its own provider list.
 * - `analytics-identity.e2e-spec.ts` needs a mutable `jwtClaims` per test, which
 *   a returned class cannot express.
 *
 * Widening this factory to cover either would be machinery with one user, so a
 * guard-chain change has to reach all three files.
 *
 * **What these stubs do and do not prove about tenancy.** They supply `chapterId`
 * unconditionally, so no spec using them can catch a regression in
 * `ChapterGuard`'s *own* resolution — the membership lookup never runs.
 * `cross-tenant-isolation.e2e-spec.ts` is the suite for that, and it overrides
 * only `PermissionsGuard`. What a spec using these stubs *can* still catch is a
 * handler trusting the client's `x-chapter-id` header over guard context (#849),
 * and `mass-assignment.e2e-spec.ts` does exactly that by passing a `chapterId`
 * deliberately unequal to the header its requests send. Do not "tidy" that value
 * to match the header: the asymmetry is the assertion.
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
 * Allows every route and writes nothing to the request, so a spec asserts its
 * own subject rather than an authorization lookup. Parameterless — a spec that
 * needs a guard actually enforced runs the real one instead of configuring
 * this.
 *
 * Named for what it does rather than for the guard it replaces, because it
 * stands in for all three: the ten e2e specs that keep the identity-writing
 * stubs above override `PermissionsGuard` with it, and
 * {@link createGuardedTestingModule} overrides the whole chain with it.
 */
export class AllowAllGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

/**
 * `Test.createTestingModule` with the three-guard chain — `SupabaseAuthGuard`,
 * `ChapterGuard`, `PermissionsGuard` — already overridden by
 * {@link AllowAllGuard}. For a spec that compiles a controller and calls its
 * methods directly:
 *
 * ```ts
 * const module: TestingModule = await createGuardedTestingModule({
 *   controllers: [FooController],
 *   providers: [{ provide: FooService, useValue: fooService }],
 * }).compile();
 * ```
 *
 * It returns the builder, so a spec that also needs an interceptor or provider
 * override chains onto it as usual.
 *
 * **These overrides are not ceremony, and the reason is not obvious.** No spec
 * that uses this boots an HTTP app, so the guards never *run* — but Nest
 * instantiates a controller's enhancers during `.compile()`, and the real
 * `SupabaseAuthGuard` injects `SUPABASE_CLIENT`, which a controller-only
 * testing module does not provide. Without the override, `.compile()` throws
 * `Nest can't resolve dependencies of the SupabaseAuthGuard (?)` and every test
 * in the file fails. Verified by deleting the block from a spec and running it,
 * not inferred.
 *
 * Twenty-two controller specs had solved that in two incompatible ways. Eighteen
 * hand-rolled the same six-line override block, in two spellings (`() => true`
 * and `jest.fn().mockReturnValue(true)`, neither ever asserted on). The other
 * four instead provided `{ provide: 'SUPABASE_CLIENT', useValue: {} }` so the
 * *real* guards could construct — a raw string literal rather than the exported
 * `SUPABASE_CLIENT` token, so a rename of that token would have stopped
 * providing it silently. Either way a fourth guard on the chain, or a change to
 * what an existing one injects, had twenty-two places to reach and no way to
 * tell it had missed one. That is the same argument that gave the e2e stubs
 * above one home; this is the other half of it.
 *
 * **The three controller specs that do not use this are named here so that
 * claim is checkable rather than vacuous.** `health` and `webhook` declare no
 * guards at all (`/health` and the Stripe webhook are the documented no-guard
 * routes), so there is nothing to override — `health.controller.spec.ts`
 * provides the real `SUPABASE_CLIENT` token because the *controller* injects
 * it, not a guard. `analytics` constructs its controller with `new` and no
 * testing module at all, which its own comment explains; that is a simpler
 * answer than this one wherever a controller is thin enough for it.
 *
 * **What this does not do.** It writes no `supabaseUser`, `appUser`, `member`
 * or `chapterId`, because a spec calling a controller method directly passes
 * those as arguments — so it proves nothing about the guard chain itself. A
 * spec that issues a real request needs {@link createGuardStubs}, and one that
 * asserts *which* guards a controller declares reads
 * `Reflect.getMetadata('__guards__', FooController)`, which these overrides do
 * not touch.
 */
export function createGuardedTestingModule(
  metadata: ModuleMetadata,
): TestingModuleBuilder {
  return Test.createTestingModule(metadata)
    .overrideGuard(SupabaseAuthGuard)
    .useClass(AllowAllGuard)
    .overrideGuard(ChapterGuard)
    .useClass(AllowAllGuard)
    .overrideGuard(PermissionsGuard)
    .useClass(AllowAllGuard);
}
