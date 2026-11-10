import { ChapterConfigController } from './chapter-config.controller';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';

/**
 * The permission each route declares, read off the decorators.
 *
 * The class asks for chapter-config:view, and `PermissionsGuard` ANDs a
 * handler's own list onto it. So a write that lost its decorator would not
 * fail closed: it would fall back to the view-only gate and let a member who
 * can only read chapter config change it.
 */
describe('ChapterConfigController permissions', () => {
  it('asks for chapter-config:view on every route', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, ChapterConfigController),
    ).toEqual([SystemPermissions.CHAPTER_CONFIG_VIEW]);
  });

  it.each(['patchConfig', 'recomputePalette'] as const)(
    '%s also requires chapter-config:manage and declares no any-of list',
    (handler) => {
      const route = ChapterConfigController.prototype[handler];
      expect(Reflect.getMetadata(PERMISSIONS_KEY, route)).toEqual([
        SystemPermissions.CHAPTER_CONFIG_MANAGE,
      ]);
      expect(Reflect.getMetadata(PERMISSIONS_ANY_KEY, route)).toBeUndefined();
    },
  );

  it('leaves the read at the class gate', () => {
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        ChapterConfigController.prototype.getConfig,
      ),
    ).toBeUndefined();
  });
});
