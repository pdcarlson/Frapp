import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import { MeetingController } from './meeting.controller';

/**
 * The permissions each minutes route asks for at the guard, beyond the
 * class's own. Linking asks none: the author of minutes started with no
 * meeting links them, though they may hold no `meetings:edit` (Paul,
 * 2026-11-20), and the service decides who may edit them.
 */
describe('MeetingController permissions', () => {
  const routePermissions = (name: keyof MeetingController) =>
    Reflect.getMetadata(PERMISSIONS_KEY, MeetingController.prototype[name]) as
      string[] | undefined;

  it('asks nothing extra to link minutes to a meeting', () => {
    expect(routePermissions('linkEvent')).toBeUndefined();
  });

  it('asks meetings:record to say a phone is recording', () => {
    expect(routePermissions('markLiveRecording')).toEqual([
      SystemPermissions.MEETINGS_RECORD,
    ]);
  });
});
