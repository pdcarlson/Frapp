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
  const goalService = {
    getGoals: jest.fn(),
    setGoals: jest.fn(),
    goalsForUser: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [GoalsController],
      providers: [{ provide: ChapterGoalService, useValue: goalService }],
    }).compile();
    controller = module.get(GoalsController);
  });

  afterEach(() => jest.clearAllMocks());

  const gate = (method: keyof GoalsController) =>
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      Object.getOwnPropertyDescriptor(GoalsController.prototype, method)!
        .value as object,
    ) as unknown;

  it("reads behind chapter-config:view, writes behind manage, and serves a member's own behind members:view", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, GoalsController)).toEqual([
      SupabaseAuthGuard,
      ChapterGuard,
      PermissionsGuard,
    ]);
    // No class-level gate: each route names its own, so the member's own
    // read isn't held behind chapter-config:view.
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, GoalsController),
    ).toBeUndefined();
    expect(gate('getGoals')).toEqual([SystemPermissions.CHAPTER_CONFIG_VIEW]);
    expect(gate('setGoals')).toEqual([
      SystemPermissions.CHAPTER_CONFIG_VIEW,
      SystemPermissions.CHAPTER_CONFIG_MANAGE,
    ]);
    expect(gate('getMyGoals')).toEqual([SystemPermissions.MEMBERS_VIEW]);
  });

  it("serves the caller's own goals", async () => {
    const mine = { points: 40, service: null, study: 360 };
    goalService.goalsForUser.mockResolvedValue(mine);
    await expect(controller.getMyGoals('chapter-1', 'user-1')).resolves.toBe(
      mine,
    );
    expect(goalService.goalsForUser).toHaveBeenCalledWith(
      'chapter-1',
      'user-1',
    );
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
    const noGoalRole = plainToInstance(GoalSetDto, {
      everyone: 360,
      roles: [
        { role_id: '22222222-2222-4222-8222-222222222222', target: null },
      ],
    });
    expect(await validate(noGoalRole)).toHaveLength(0);
  });
});
