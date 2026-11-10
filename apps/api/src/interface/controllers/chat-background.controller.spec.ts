import 'reflect-metadata';
import { CHAPTER_PROFILE_PERMISSIONS } from '@repo/validation';
import { ChatBackgroundController } from './chat-background.controller';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';
import { SystemPermissions } from '#domain/constants/permissions';

/**
 * Who may change a chat background (#3973): a channel's own by
 * `channels:manage`, the chapter default by `CHAPTER_PROFILE_PERMISSIONS`, and
 * any member may read one. The class-level `members:view` applies to all of
 * them (`PermissionsGuard` reads both levels).
 */
describe('ChatBackgroundController permissions (#3973)', () => {
  const routeGate = (handler: keyof ChatBackgroundController) =>
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      ChatBackgroundController.prototype[handler],
    ) as string[] | undefined;

  it('is members-only at the class level', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, ChatBackgroundController),
    ).toEqual([SystemPermissions.MEMBERS_VIEW]);
    expect(
      Reflect.getMetadata(PERMISSIONS_ANY_KEY, ChatBackgroundController),
    ).toBeUndefined();
  });

  it.each(['setForChannel', 'channelPhotoUrl'] as const)(
    '%s requires channels:manage',
    (handler) => {
      expect(routeGate(handler)).toEqual([SystemPermissions.CHANNELS_MANAGE]);
    },
  );

  it.each(['setDefault', 'defaultPhotoUrl'] as const)(
    '%s requires exactly CHAPTER_PROFILE_PERMISSIONS',
    (handler) => {
      expect(routeGate(handler)).toEqual([...CHAPTER_PROFILE_PERMISSIONS]);
    },
  );

  it.each(['getForChannel', 'getDefault'] as const)(
    '%s adds no gate of its own (the service checks channel access)',
    (handler) => {
      expect(routeGate(handler)).toBeUndefined();
    },
  );
});
