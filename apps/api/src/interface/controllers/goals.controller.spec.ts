import { GUARDS_METADATA } from '@nestjs/common/constants';
import { TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { GoalsController } from './goals.controller';
import { ChapterGoalService } from '../../application/services/chapter-goal.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SystemPermissions } from '#domain/constants/permissions';
import { GoalMetricParamDto, GoalSetDto } from '../dtos/goals.dto';

describe('GoalsController', () => {
  let controller: GoalsController;
  const goalService = { getGoals: jest.fn(), setGoals: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [GoalsController],
      providers: [{ provide: ChapterGoalService, useValue: goalService }],
    }).compile();
    controller = module.get(GoalsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('reads behind chapter-config:view and writes behind chapter-config:manage', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, GoalsController)).toEqual([
      SupabaseAuthGuard,
      ChapterGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, GoalsController)).toEqual([
      SystemPermissions.CHAPTER_CONFIG_VIEW,
    ]);
    expect(
      Reflect.getMetadata(
        PERMISSIONS_KEY,
        Object.getOwnPropertyDescriptor(GoalsController.prototype, 'setGoals')!
          .value as object,
      ),
    ).toEqual([SystemPermissions.CHAPTER_CONFIG_MANAGE]);
  });

  it('hands the service the chapter, the measure, the goals and who set them', async () => {
    const goals = { everyone: 40, roles: [] };
    goalService.setGoals.mockResolvedValue(goals);
    await expect(
      controller.setGoals('chapter-1', 'user-1', { metric: 'points' }, goals),
    ).resolves.toBe(goals);
    expect(goalService.setGoals).toHaveBeenCalledWith(
      'chapter-1',
      'points',
      goals,
      'user-1',
    );
  });

  it('accepts only the three measures', async () => {
    const bad = plainToInstance(GoalMetricParamDto, { metric: 'dues' });
    expect(await validate(bad)).not.toHaveLength(0);
    const good = plainToInstance(GoalMetricParamDto, { metric: 'study' });
    expect(await validate(good)).toHaveLength(0);
  });

  it('takes a null everyone, and refuses a zero or a bad role id', async () => {
    const ok = plainToInstance(GoalSetDto, { everyone: null, roles: [] });
    expect(await validate(ok)).toHaveLength(0);
    const zero = plainToInstance(GoalSetDto, { everyone: 0, roles: [] });
    expect(await validate(zero)).not.toHaveLength(0);
    const badRole = plainToInstance(GoalSetDto, {
      everyone: null,
      roles: [{ role_id: 'not-a-uuid', target: 5 }],
    });
    expect(await validate(badRole)).not.toHaveLength(0);
  });
});
