import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';
import {
  CurrentChapterId,
  CurrentEnabledModules,
  CurrentMember,
} from '../decorators/current-user.decorator';
import { SystemPermissions } from '#domain/constants/permissions';

/**
 * Who can reach every API route, read off the decorators of every controller
 * in this directory.
 *
 * A route's access is its guard chain plus the permissions it declares, and
 * nothing else checks that a new route got either right: a handler added
 * without `@UseGuards`, or added to a controller whose class-level guards it
 * then overrides, compiles, passes its own unit spec (which calls the method
 * directly) and ships open. So every route has to land in one of three tiers:
 *
 * - **Chapter-scoped** (`SupabaseAuthGuard` → `ChapterGuard` →
 *   `PermissionsGuard`, in that order): the default, with at least one
 *   permission declared. `PermissionsGuard` lets everyone through when a
 *   route declares none, so a chapter route with the guard and no permission
 *   reads as protected and isn't.
 * - **Membership only** (`SupabaseAuthGuard` → `ChapterGuard`, no
 *   `PermissionsGuard`): any member of the chapter. Listed below with why.
 * - **User-scoped** (`SupabaseAuthGuard`, no `ChapterGuard`) and **public**
 *   (no `SupabaseAuthGuard`): listed below with why.
 *
 * A new route in a listed tier is a line here, which is the point: it is a
 * decision someone wrote down, in the diff a reviewer reads.
 */

type Handler = (...args: unknown[]) => unknown;
type GuardRef = { name: string };

interface Route {
  /** `Controller.handler`, the ledger key. */
  key: string;
  verb: string;
  guards: string[];
  permissions: string[];
  /** Route-argument factories the handler's parameters use. */
  argFactories: unknown[];
}

/** Routes that answer without a signed-in user. */
const PUBLIC_ROUTES: Record<string, string> = {
  'HealthController.check':
    'Render and CI health probe; reports dependency status, no data.',
  'HealthController.ready': 'Readiness probe; same as check, uncached.',
  'ClientPolicyController.get':
    'Minimum app version, read before sign-in so an outdated build can be told to update.',
  'WebhookController.handleStripeWebhook':
    'Stripe calls it; the Stripe signature is verified in the handler.',
  'DiscordConnectionController.callback':
    "Discord's OAuth redirect; the signed state parameter binds it to the officer who started it.",
  'CalendarFeedFetchController.fetch':
    "A calendar app fetches a member's .ics feed; the 256-bit token in the query is the credential, checked in the service.",
  'GoogleCalendarCallbackController.callback':
    "Google's OAuth redirect; connects nothing, only sends the browser back to where the sign-in started, whose signed-in member finishes it.",
  'DevLogController.post':
    'Posts to the dev-log channel; guarded by DevLogTokenGuard (a shared secret), not a user session.',
};

/** Routes for a signed-in user that are about the user, not a chapter. */
const USER_ROUTES: Record<string, string> = {
  'AiConsentController.getConsent': "The caller's own AI consent.",
  'AiConsentController.answerConsent': "The caller's own AI consent.",
  'AnalyticsController.getIdentity':
    'Analytics identity for the caller; a chapter is optional (OptionalChapterId).',
  'AnalyticsController.track': 'Events the caller sends about themselves.',
  'ChapterDirectoryController.search':
    'The public chapter directory, searched before the caller belongs to a chapter.',
  'ChapterController.onboard': 'Creates a chapter; the caller is in none yet.',
  'ChapterController.listForCurrentUser': "The caller's own chapters.",
  'ChapterController.activate':
    'Activates a chapter the caller is creating; the service checks ownership.',
  'InviteController.preview':
    'Reads an invite by its token before the caller has joined.',
  'InviteController.redeem':
    'Joins a chapter by invite token; the invite names the chapter.',
  'InviteController.listMine': 'Invites addressed to the caller.',
  'NotificationController.registerPushToken': "The caller's own device token.",
  'NotificationController.removePushToken': "The caller's own device token.",
  'NotificationController.getPreferences':
    "The caller's own notification preferences.",
  'NotificationController.updatePreference':
    "The caller's own notification preferences.",
  'NotificationController.getSettings':
    "The caller's own notification settings.",
  'NotificationController.updateSettings':
    "The caller's own notification settings.",
  'UserController.getMe': 'The caller.',
  'UserController.getMyLegalAcceptance': 'The caller.',
  'UserController.acceptLegalTerms': 'The caller.',
  'UserController.getMyWhatsNewSeen': 'The caller.',
  'UserController.recordMyWhatsNewSeen': 'The caller.',
  'UserController.updateMe': 'The caller.',
  'UserController.deleteMe': "The caller's own account deletion.",
  'UserController.removeAvatar': "The caller's own photo.",
};

/** Chapter routes any member may call, with no permission beyond membership. */
const MEMBERSHIP_ONLY_ROUTES: Record<string, string> = {
  'AskDiagnosticsStopController.stopDiagnostics':
    "Ends the chapter's Ask diagnostics window; the service lets only the president stop it.",
  'AttendanceController.checkIn':
    'Any member checks themselves in; the check-in token and window are verified in the service.',
  'UserController.getMyPermissions':
    "The caller's own permissions in the active chapter.",
  'UserController.requestAvatarUploadUrl':
    "The caller's own photo, stored under the active chapter.",
  'UserController.confirmAvatarUpload':
    "The caller's own photo, stored under the active chapter.",
};

/** Parameter decorators whose value only `ChapterGuard` sets. */
const CHAPTER_ARGS = {
  CurrentChapterId,
  CurrentMember,
  CurrentEnabledModules,
};

/** The factory Nest stores for a `createParamDecorator` decorator. */
function factoryOf(decorator: () => ParameterDecorator): unknown {
  class Probe {
    handler(_value: unknown): void {}
  }
  decorator()(Probe.prototype, 'handler', 0);
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler') as
    Record<string, { factory?: unknown }> | undefined;
  const [entry] = Object.values(args ?? {});
  return entry?.factory;
}

function guardNames(target: object): string[] {
  const guards = (Reflect.getMetadata(GUARDS_METADATA, target) ??
    []) as GuardRef[];
  return guards.map((guard) => guard.name);
}

function declaredPermissions(target: object): string[] {
  return [
    ...((Reflect.getMetadata(PERMISSIONS_KEY, target) ?? []) as string[]),
    ...((Reflect.getMetadata(PERMISSIONS_ANY_KEY, target) ?? []) as string[]),
  ];
}

function collectRoutes(): Route[] {
  const routes: Route[] = [];
  const files = readdirSync(__dirname).filter((file) =>
    file.endsWith('.controller.ts'),
  );
  for (const file of files) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- every controller in the directory, without a hand-kept list
    const exported = require(join(__dirname, file)) as Record<string, unknown>;
    for (const controller of Object.values(exported)) {
      if (typeof controller !== 'function') continue;
      if (Reflect.getMetadata(PATH_METADATA, controller) === undefined) {
        continue;
      }
      const proto = (controller as { prototype: Record<string, unknown> })
        .prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const verb = Reflect.getMetadata(METHOD_METADATA, handler) as
          RequestMethod | undefined;
        if (verb === undefined) continue;
        const args = (Reflect.getMetadata(
          ROUTE_ARGS_METADATA,
          controller,
          name,
        ) ?? {}) as Record<string, { factory?: unknown }>;
        routes.push({
          key: `${controller.name}.${name}`,
          verb: RequestMethod[verb],
          guards: [...guardNames(controller), ...guardNames(handler)],
          permissions: [
            ...declaredPermissions(controller),
            ...declaredPermissions(handler),
          ],
          argFactories: Object.values(args).map((arg) => arg.factory),
        });
      }
    }
  }
  return routes;
}

const has = (route: Route, guard: string) => route.guards.includes(guard);

describe('API route access ledger', () => {
  const routes = collectRoutes();

  it('finds the controllers (a broken discovery would pass everything below)', () => {
    expect(routes.length).toBeGreaterThan(300);
    expect(routes.map((r) => r.key)).toContain('ChatController.sendMessage');
  });

  it('every controller lives in this directory, where discovery looks', () => {
    const src = join(__dirname, '..', '..');
    const elsewhere = readdirSync(src, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.controller.ts'))
      .filter((file) => dirname(join(src, file)) !== __dirname);

    expect(elsewhere).toEqual([]);
  });

  it('every route without a signed-in user is a listed public route', () => {
    const unlisted = routes
      .filter((r) => !has(r, 'SupabaseAuthGuard'))
      .map((r) => r.key)
      .filter((key) => !(key in PUBLIC_ROUTES));

    expect(unlisted).toEqual([]);
  });

  it('every signed-in route outside a chapter is a listed user route', () => {
    const unlisted = routes
      .filter((r) => has(r, 'SupabaseAuthGuard') && !has(r, 'ChapterGuard'))
      .map((r) => r.key)
      .filter((key) => !(key in USER_ROUTES));

    expect(unlisted).toEqual([]);
  });

  it('every chapter route checks permissions, or is listed as membership only', () => {
    const unlisted = routes
      .filter((r) => has(r, 'ChapterGuard') && !has(r, 'PermissionsGuard'))
      .map((r) => r.key)
      .filter((key) => !(key in MEMBERSHIP_ONLY_ROUTES));

    expect(unlisted).toEqual([]);
  });

  it('every route behind PermissionsGuard declares a permission', () => {
    // With none declared the guard returns true for any member.
    const open = routes
      .filter((r) => has(r, 'PermissionsGuard') && r.permissions.length === 0)
      .map((r) => r.key);

    expect(open).toEqual([]);
  });

  it('guards run in order: auth, then chapter, then permissions', () => {
    // ChapterGuard reads the user SupabaseAuthGuard attached, and
    // PermissionsGuard reads the member and chapter ChapterGuard attached; out
    // of order, each sees nothing and refuses, or worse, reads a stale value.
    const order = ['SupabaseAuthGuard', 'ChapterGuard', 'PermissionsGuard'];
    const misordered = routes
      .filter((r) => {
        const seen = r.guards.filter((g) => order.includes(g));
        const expected = order.filter((g) => seen.includes(g));
        return seen.join() !== expected.join();
      })
      .map((r) => `${r.key}: ${r.guards.join(' → ')}`);

    expect(misordered).toEqual([]);
  });

  it('PermissionsGuard never runs without ChapterGuard', () => {
    // It scopes the role lookup to the chapter ChapterGuard pinned; without
    // one it refuses every caller.
    const orphaned = routes
      .filter((r) => has(r, 'PermissionsGuard') && !has(r, 'ChapterGuard'))
      .map((r) => r.key);

    expect(orphaned).toEqual([]);
  });

  it('only chapter routes read the chapter, member or modules ChapterGuard sets', () => {
    // Off a ChapterGuard route these resolve to undefined, and a service
    // handed an undefined chapter id builds an unscoped query.
    const factories = Object.entries(CHAPTER_ARGS).map(
      ([name, decorator]) => [name, factoryOf(decorator)] as const,
    );
    const misuse = routes
      .filter((r) => !has(r, 'ChapterGuard'))
      .flatMap((r) =>
        factories
          .filter(([, factory]) => r.argFactories.includes(factory))
          .map(([name]) => `${r.key} reads @${name}()`),
      );

    expect(
      factories.every(([, factory]) => typeof factory === 'function'),
    ).toBe(true);
    expect(misuse).toEqual([]);
  });

  it('every declared permission is one the API knows', () => {
    // A typo is a route no role can ever reach, discovered by a member.
    const known = new Set<string>(Object.values(SystemPermissions));
    const unknown = routes.flatMap((r) =>
      r.permissions
        .filter((permission) => !known.has(permission))
        .map((permission) => `${r.key}: ${permission}`),
    );

    expect(unknown).toEqual([]);
  });

  it('the ledgers name only routes that still exist in that tier', () => {
    const byKey = new Map(routes.map((r) => [r.key, r]));
    const stale = [
      ...Object.keys(PUBLIC_ROUTES).filter((key) => {
        const r = byKey.get(key);
        return !r || has(r, 'SupabaseAuthGuard');
      }),
      ...Object.keys(USER_ROUTES).filter((key) => {
        const r = byKey.get(key);
        return !r || !has(r, 'SupabaseAuthGuard') || has(r, 'ChapterGuard');
      }),
      ...Object.keys(MEMBERSHIP_ONLY_ROUTES).filter((key) => {
        const r = byKey.get(key);
        return !r || !has(r, 'ChapterGuard') || has(r, 'PermissionsGuard');
      }),
    ];

    expect(stale).toEqual([]);
  });
});
