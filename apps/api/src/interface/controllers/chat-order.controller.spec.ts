import 'reflect-metadata';
import { ChatOrderController } from './chat-order.controller';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';
import { SystemPermissions } from '#domain/constants/permissions';

/** Only an officer who can manage channels sets the chapter's order (#4178). */
describe('ChatOrderController permissions (#4178)', () => {
  it('requires channels:manage on every route', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ChatOrderController)).toEqual([
      SystemPermissions.CHANNELS_MANAGE,
    ]);
    expect(
      Reflect.getMetadata(PERMISSIONS_ANY_KEY, ChatOrderController),
    ).toBeUndefined();
    for (const handler of ['reorderChannels', 'reorderCategories'] as const) {
      expect(
        Reflect.getMetadata(
          PERMISSIONS_KEY,
          ChatOrderController.prototype[handler],
        ),
      ).toBeUndefined();
    }
  });
});
