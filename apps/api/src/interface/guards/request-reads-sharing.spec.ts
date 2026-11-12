import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ChapterGuard, prefetchChapterContext } from './chapter.guard';
import { PermissionsGuard } from './permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SupabaseMemberRepository } from '../../infrastructure/supabase/repositories/supabase-member.repository';
import { SupabaseRoleRepository } from '../../infrastructure/supabase/repositories/supabase-role.repository';
import { runWithRequestReads } from '../../infrastructure/supabase/request-reads';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';

/**
 * The whole point of #3728's per-request store, end to end through the real
 * pieces: the prefetch, `ChapterGuard`, `PermissionsGuard`, and the
 * repositories the handler's access checks call (`ChannelAccessService`
 * reads membership through `findByUserAndChapter`, `RbacService` reads roles
 * through `findByIds`). In one GET each of those rows is read once. If any of
 * them stops going through the shared read, or its key drifts from the
 * others', a count here goes up. With a chapter named, the prefetch reads all
 * four in one call (`get_request_context`, #3583), so nothing else reads at
 * all.
 */
describe('one GET reads membership and roles once (#3728)', () => {
  const CHAPTER = '44444444-4444-4444-8444-444444444444';

  let reads: string[];
  let supabase: FrappSupabaseClient;

  beforeEach(() => {
    reads = [];
    const from = jest.fn((table: string) => {
      reads.push(table);
      const row =
        table === 'users'
          ? { id: 'user-s' }
          : table === 'chapters'
            ? { subscription_status: 'active', enabled_modules: null }
            : table === 'members'
              ? {
                  id: 'member-s',
                  user_id: 'user-s',
                  chapter_id: CHAPTER,
                  // Out of order on purpose: the roles key must not depend on it.
                  role_ids: ['role-b', 'role-a'],
                }
              : [
                  {
                    id: 'role-a',
                    chapter_id: CHAPTER,
                    permissions: ['members:view'],
                  },
                  { id: 'role-b', chapter_id: CHAPTER, permissions: [] },
                ];
      const answer = () => Promise.resolve({ data: row, error: null });
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.in = () => chain;
      chain.maybeSingle = answer;
      chain.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown,
      ) => answer().then(resolve, reject);
      return chain;
    });
    // The prefetch's one call (#3583), answering the same rows.
    const rpc = jest.fn((name: string) => {
      reads.push(`rpc:${name}`);
      return Promise.resolve({
        data: {
          user: { id: 'user-s' },
          chapter: { subscription_status: 'active', enabled_modules: null },
          member: {
            id: 'member-s',
            user_id: 'user-s',
            chapter_id: CHAPTER,
            role_ids: ['role-b', 'role-a'],
          },
          roles: [
            {
              id: 'role-a',
              chapter_id: CHAPTER,
              permissions: ['members:view'],
            },
            { id: 'role-b', chapter_id: CHAPTER, permissions: [] },
          ],
        },
        error: null,
      });
    });
    supabase = { from, rpc } as unknown as FrappSupabaseClient;
  });

  class ChatLikeController {}
  Reflect.defineMetadata(PERMISSIONS_KEY, ['members:view'], ChatLikeController);

  const context = (request: object): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => () => undefined,
      getClass: () => ChatLikeController,
    }) as unknown as ExecutionContext;

  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('across the prefetch, both guards and the handler’s repository reads', async () => {
    const reflector = new Reflector();
    const chapterGuard = new ChapterGuard(supabase, reflector);
    const permissionsGuard = new PermissionsGuard(reflector, supabase);
    const members = new SupabaseMemberRepository(supabase);
    const roles = new SupabaseRoleRepository(supabase);
    const request = {
      method: 'GET',
      headers: { 'x-chapter-id': CHAPTER },
      supabaseUser: { id: 'auth-s' },
    };

    await runWithRequestReads('GET', async () => {
      prefetchChapterContext(supabase, 'auth-s', undefined, request.headers);
      await settle();

      await expect(chapterGuard.canActivate(context(request))).resolves.toBe(
        true,
      );
      await expect(
        permissionsGuard.canActivate(context(request)),
      ).resolves.toBe(true);

      // The handler: ChannelAccessService and RbacService, twice over as on a
      // channel list.
      for (let i = 0; i < 2; i++) {
        const member = await members.findByUserAndChapter('user-s', CHAPTER);
        await roles.findByIds(member!.role_ids, CHAPTER);
      }
    });

    expect(reads).toEqual(['rpc:get_request_context']);
  });

  it('without the store, the same steps read each row every time', async () => {
    const reflector = new Reflector();
    const request = {
      method: 'GET',
      headers: { 'x-chapter-id': CHAPTER },
      supabaseUser: { id: 'auth-s2' },
    };
    await new ChapterGuard(supabase, reflector).canActivate(context(request));
    await new PermissionsGuard(reflector, supabase).canActivate(
      context(request),
    );
    await new SupabaseMemberRepository(supabase).findByUserAndChapter(
      'user-s',
      CHAPTER,
    );

    expect(reads.filter((table) => table === 'members')).toHaveLength(2);
    expect(reads.filter((table) => table === 'roles')).toHaveLength(1);
  });
});
