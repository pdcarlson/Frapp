// The controllers pull in services that import the ESM-only @repo packages.
// Mock them so the module graph loads under jest, as
// `subscription.decorator.spec.ts` does.
jest.mock('@repo/org-archetypes', () => ({
  buildChapterConfigFromArchetype: jest.fn(() => ({})),
  getArchetype: jest.fn((key: string) => ({ key })),
}));
jest.mock('@repo/chapter-theme', () => ({
  deriveSignetPalette: jest.fn(() => ({})),
  SIGNET_ENGINE_VERSION: 0,
}));

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { VERIFY_SESSION_LOCALLY_KEY } from './session-check.decorator';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';

/**
 * Every route that verifies its session locally instead of calling
 * `auth.getUser` (#5043, Paul 2026-11-16). Adding one is a security decision a
 * reviewer should see in the diff, so the roster is spelled out here: a route
 * that returns credentials, a signed URL to a private file, an export or
 * account data, or admin and audit records never joins it.
 *
 * Deliberately left off (they look like app-open reads but are not): `GET
 * bootstrap` (the caller's account row, settings and signed photo, logo and
 * avatar URLs, and its interceptor syncs the profile), `GET members` and
 * `GET members/roster` (contact details and signed `profiles` URLs), `GET
 * chapters/current` (a signed `branding` URL), and the admin-permission reads
 * `GET points/transactions` (the audit ledger), `GET polls` and `GET goals`.
 */
const ROSTER = [
  'GET activity',
  'GET activity/now',
  'GET ai/suggestions',
  'GET channels',
  'GET channels/:id',
  'GET channels/:id/members',
  'GET channels/:id/messages',
  'GET channels/:id/pins',
  'GET channels/:id/threads/:rootId',
  'GET channels/:id/threads/:rootId/messages',
  'GET channels/:id/threads/followed',
  'GET channels/categories/list',
  'GET channels/latest',
  'GET channels/mention-roles',
  'GET channels/messages/:messageId/reactions',
  'GET channels/unread',
  'GET chat-sidebar',
  'GET events',
  'GET events/:id',
  'GET goals/mine',
  'GET groups',
  'GET meetings',
  'GET meetings/:id',
  'GET meetings/:id/action-item-tasks',
  'GET meetings/live-recordings',
  'GET notifications',
  'GET points/leaderboard',
  'GET points/me',
  'GET role-tiers',
  'GET search',
  'GET semesters',
  'GET tasks',
  'GET threads',
  'GET users/me/permissions',
];

interface MarkedRoute {
  label: string;
  method: unknown;
  guards: unknown[];
}

function joinPath(base: unknown, path: unknown): string {
  return [base, path]
    .map((part) => (typeof part === 'string' ? part : ''))
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}

/** Every handler, on every controller in the app, that carries the marker. */
function markedRoutes(): MarkedRoute[] {
  const reflector = new Reflector();
  const dir = join(__dirname, '..', 'controllers');
  const found: MarkedRoute[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.controller.ts')) continue;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require(join(dir, file)) as Record<string, unknown>;
    for (const candidate of Object.values(exported)) {
      if (typeof candidate !== 'function') continue;
      const controller = candidate as new (...args: never[]) => unknown;
      const base: unknown = Reflect.getMetadata(PATH_METADATA, controller);
      if (base === undefined) continue;
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const marked: unknown = Reflect.getMetadata(
          VERIFY_SESSION_LOCALLY_KEY,
          handler,
        );
        if (marked !== true) continue;
        const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
        const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        found.push({
          label: `${RequestMethod[method as RequestMethod]} ${joinPath(base, path)}`,
          method,
          guards: reflector.getAllAndMerge<unknown[]>(GUARDS_METADATA, [
            handler as () => unknown,
            controller,
          ]),
        });
      }
    }
  }
  return found;
}

describe('@VerifySessionLocally() roster (#5043)', () => {
  const routes = markedRoutes();

  it('is exactly the reviewed roster', () => {
    expect(routes.map((r) => r.label).sort()).toEqual([...ROSTER].sort());
  });

  it('marks only GET handlers', () => {
    for (const route of routes) {
      expect([route.label, route.method]).toEqual([
        route.label,
        RequestMethod.GET,
      ]);
    }
  });

  // Without `ChapterGuard` the guard ignores the marker and calls `getUser`,
  // so a marked route without it would read as faster than it is; and it is
  // `ChapterGuard` that refuses a deleted user or removed member at once.
  it('marks only routes that ChapterGuard and SupabaseAuthGuard guard', () => {
    for (const route of routes) {
      expect([route.label, route.guards]).toEqual([
        route.label,
        expect.arrayContaining([SupabaseAuthGuard, ChapterGuard]),
      ]);
    }
  });
});
