import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { ActivityController } from './activity.controller';
import { ActivityService } from '../../application/services/activity.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SystemPermissions } from '#domain/constants/permissions';

describe('ActivityController', () => {
  let controller: ActivityController;
  const activityService = { getActivity: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [ActivityController],
      providers: [{ provide: ActivityService, useValue: activityService }],
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
});
