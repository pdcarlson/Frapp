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
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MarkActivityReadDto } from '../dtos/activity.dto';

describe('ActivityController', () => {
  let controller: ActivityController;
  const activityService = {
    getActivity: jest.fn(),
    markRead: jest.fn(),
    startUnread: jest.fn(),
  };
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

  describe('reads (#4173)', () => {
    const ITEM = '0a000000-0000-4000-8000-000000004173';
    const errorsOf = async (body: unknown) =>
      (await validate(plainToInstance(MarkActivityReadDto, body))).map(
        (error) => error.property,
      );

    it('records the caller’s own opens, open to any member', async () => {
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, controller.markRead),
      ).toBeUndefined();

      await controller.markRead('chapter-1', 'user-1', {
        items: [{ kind: 'poll', item_id: ITEM }],
      });

      expect(activityService.markRead).toHaveBeenCalledWith(
        'chapter-1',
        'user-1',
        [{ kind: 'poll', item_id: ITEM }],
      );
    });

    it('begins the caller’s own dots, open to any member', async () => {
      expect(
        Reflect.getMetadata(PERMISSIONS_KEY, controller.startUnread),
      ).toBeUndefined();

      await controller.startUnread('chapter-1', 'user-1');

      expect(activityService.startUnread).toHaveBeenCalledWith(
        'chapter-1',
        'user-1',
      );
    });

    it('takes 1 to 100 items, each a known kind and a uuid', async () => {
      await expect(
        errorsOf({ items: [{ kind: 'link', item_id: ITEM }] }),
      ).resolves.toEqual([]);
      await expect(errorsOf({ items: [] })).resolves.toEqual(['items']);
      await expect(
        errorsOf({
          items: Array.from({ length: 101 }, () => ({
            kind: 'task',
            item_id: ITEM,
          })),
        }),
      ).resolves.toEqual(['items']);
      // A file is never unread (it is only ever the caller's own).
      await expect(
        errorsOf({ items: [{ kind: 'file', item_id: ITEM }] }),
      ).resolves.toEqual(['items']);
      await expect(
        errorsOf({ items: [{ kind: 'task', item_id: 'not-a-uuid' }] }),
      ).resolves.toEqual(['items']);
    });
  });
});
