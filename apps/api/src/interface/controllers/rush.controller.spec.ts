import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RUSH_MEMBER_PERMISSIONS } from '@repo/validation';
import { RushController } from './rush.controller';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { RushService } from '../../application/services/rush.service';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import {
  DEFAULT_SYSTEM_ROLES,
  SystemPermissions,
  SystemRoleKeys,
} from '#domain/constants/permissions';

/**
 * Recruitment's permissions (#4070). Until then every rush route asked only
 * for `members:view`, so the decorators are what the change is: drop one and
 * any member can vote or record a bid again, with no other test noticing.
 * The routes are pinned, and the real `PermissionsGuard` is run against each
 * to show a role without the key is refused.
 */
describe('RushController permissions', () => {
  const controller = new RushController({} as RushService);

  const ROUTES = [
    ['lookup', SystemPermissions.RUSH_VIEW],
    ['getOne', SystemPermissions.RUSH_VIEW],
    ['create', SystemPermissions.RUSH_ADD],
    ['vote', SystemPermissions.RUSH_VOTE],
    ['bid', SystemPermissions.RUSH_BID],
  ] as const;

  it('floors every route at members:view', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, RushController)).toEqual([
      SystemPermissions.MEMBERS_VIEW,
    ]);
  });

  it.each(ROUTES)('%s requires %s', (handler, permission) => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, controller[handler])).toEqual([
      permission,
    ]);
  });

  /** A guard whose role lookup answers one role with `permissions`. */
  const guardFor = (permissions: readonly string[]) => {
    const from = (table: string) => {
      const chain = {
        select: () => chain,
        in: () => chain,
        eq: () => chain,
        then: (resolve: (result: { data: unknown[] }) => unknown) =>
          resolve({
            data: table === 'roles' ? [{ permissions: [...permissions] }] : [],
          }),
      };
      return chain;
    };
    return new PermissionsGuard(new Reflector(), {
      from,
    } as unknown as FrappSupabaseClient);
  };

  const contextFor = (handler: (typeof ROUTES)[number][0]): ExecutionContext =>
    ({
      getHandler: () => controller[handler],
      getClass: () => RushController,
      switchToHttp: () => ({
        getRequest: () => ({
          member: { role_ids: ['role-1'], custom_role_ids: [] },
          chapterId: 'chapter-1',
        }),
      }),
    }) as unknown as ExecutionContext;

  describe.each(ROUTES)('%s', (handler, permission) => {
    it(`refuses a role that holds every other rush key but not ${permission}`, async () => {
      const others = [
        SystemPermissions.MEMBERS_VIEW,
        ...RUSH_MEMBER_PERMISSIONS,
        SystemPermissions.RUSH_MANAGE,
      ].filter((held) => held !== permission);

      await expect(
        guardFor(others).canActivate(contextFor(handler)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('admits the seeded Member role, as before the keys existed', async () => {
      const member = DEFAULT_SYSTEM_ROLES.find(
        (role) => role.system_key === SystemRoleKeys.MEMBER,
      )!;

      await expect(
        guardFor(member.permissions).canActivate(contextFor(handler)),
      ).resolves.toBe(true);
    });

    it('admits the wildcard', async () => {
      await expect(
        guardFor([SystemPermissions.WILDCARD]).canActivate(contextFor(handler)),
      ).resolves.toBe(true);
    });
  });
});
