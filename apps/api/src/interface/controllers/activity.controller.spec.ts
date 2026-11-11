import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { ActivityController } from './activity.controller';
import { ActivityService } from '../../application/services/activity.service';
import { ActivityLinkService } from '../../application/services/activity-link.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SystemPermissions } from '#domain/constants/permissions';

describe('ActivityController', () => {
  let controller: ActivityController;
  const activityService = { getActivity: jest.fn() };
  const linkService = {
    setState: jest.fn(),
    clearState: jest.fn(),
    setRemoved: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [ActivityController],
      providers: [
        { provide: ActivityService, useValue: activityService },
        { provide: ActivityLinkService, useValue: linkService },
      ],
    }).compile();
    controller = module.get(ActivityController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('runs the full guard chain, in order, behind members:view', () => {
    // The read returns chapter data, so a missing guard here is a leak, and
    // each guard reads what the one before it set.
    expect(Reflect.getMetadata(GUARDS_METADATA, ActivityController)).toEqual([
      SupabaseAuthGuard,
      ChapterGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ActivityController)).toEqual([
      SystemPermissions.MEMBERS_VIEW,
    ]);
  });

  it('hands the service the chapter, the caller and the chapter’s module toggles', async () => {
    const view = { needs_you_count: 0 };
    activityService.getActivity.mockResolvedValue(view);
    const enabledModules = { polls: false };

    const result = await controller.getActivity(
      'chapter-1',
      'user-1',
      enabledModules,
    );

    // The toggles are what keeps a switched-off module out of the page, so
    // they must reach the service as the guard read them, not as `null`.
    expect(activityService.getActivity).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
      enabledModules,
    );
    expect(result).toBe(view);
  });

  describe('links (#3897)', () => {
    const LINK = '0a000000-0000-4000-8000-000000000390';

    it('sets and clears the caller’s own state, open to any member', async () => {
      // Only the class's members:view: a member's Done or Hide needs no more.
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, controller.setLinkState),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, controller.clearLinkState),
      ).toBeUndefined();

      await controller.setLinkState('chapter-1', 'user-1', LINK, {
        state: 'done',
      });
      await controller.clearLinkState('chapter-1', 'user-1', LINK);

      expect(linkService.setState).toHaveBeenCalledWith(
        'chapter-1',
        'user-1',
        LINK,
        'done',
      );
      expect(linkService.clearState).toHaveBeenCalledWith(
        'chapter-1',
        'user-1',
        LINK,
      );
    });

    it('gates remove and restore on channels:manage', async () => {
      for (const handler of [controller.removeLink, controller.restoreLink]) {
        expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([
          SystemPermissions.CHANNELS_MANAGE,
        ]);
      }

      await controller.removeLink('chapter-1', 'user-1', LINK);
      await controller.restoreLink('chapter-1', LINK);

      expect(linkService.setRemoved).toHaveBeenNthCalledWith(
        1,
        'chapter-1',
        LINK,
        'user-1',
      );
      expect(linkService.setRemoved).toHaveBeenNthCalledWith(
        2,
        'chapter-1',
        LINK,
        null,
      );
    });
  });
});
