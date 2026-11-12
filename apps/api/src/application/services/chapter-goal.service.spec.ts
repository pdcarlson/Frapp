import { BadRequestException } from '@nestjs/common';
import { ChapterGoalService } from './chapter-goal.service';
import type { ChapterGoalRow } from '#domain/entities/chapter-goal.entity';
import type { Role } from '#domain/entities/role.entity';

const CHAPTER = 'chapter-1';
const PRESIDENT = 'role-president';
const BROTHER = 'role-brother';
const PLEDGE = 'role-pledge';

const role = (id: string, display_order: number): Role =>
  ({ id, chapter_id: CHAPTER, name: id, display_order }) as Role;

const ROLES = [role(PRESIDENT, 1), role(BROTHER, 5), role(PLEDGE, 6)];

const row = (
  metric: ChapterGoalRow['metric'],
  goals: ChapterGoalRow['goals'],
): ChapterGoalRow => ({
  chapter_id: CHAPTER,
  metric,
  goals,
  updated_at: '2026-11-12T00:00:00.000Z',
  updated_by: null,
});

function build(rows: ChapterGoalRow[] = [], roles: Role[] = ROLES) {
  const goalRepo = {
    findByChapter: jest.fn().mockResolvedValue(rows),
    upsert: jest.fn(
      async (_chapterId: string, metric: string, goals: unknown) =>
        row(
          metric as ChapterGoalRow['metric'],
          goals as ChapterGoalRow['goals'],
        ),
    ),
  };
  const roleRepo = {
    findByChapter: jest.fn().mockResolvedValue(roles),
    findByIds: jest.fn(async (ids: string[]) =>
      roles.filter((r) => ids.includes(r.id)),
    ),
  };
  return {
    service: new ChapterGoalService(goalRepo, roleRepo as never),
    goalRepo,
    roleRepo,
  };
}

describe('ChapterGoalService', () => {
  describe('goalsForMember', () => {
    it("holds a member to their highest-ranked role's goal, else everyone's", async () => {
      const { service } = build([
        row('points', {
          everyone: 40,
          roles: [
            { role_id: PLEDGE, target: 60 },
            { role_id: PRESIDENT, target: 20 },
          ],
        }),
        row('study', {
          everyone: null,
          roles: [{ role_id: PLEDGE, target: 480 }],
        }),
      ]);

      // A pledge who is also president answers to the president's goal.
      expect(
        await service.goalsForMember(CHAPTER, [PLEDGE, PRESIDENT]),
      ).toEqual({ points: 20, service: null, study: 480 });
      expect(await service.goalsForMember(CHAPTER, [PLEDGE])).toEqual({
        points: 60,
        service: null,
        study: 480,
      });
      // No role set apart: everyone's goal, and none where there is none.
      expect(await service.goalsForMember(CHAPTER, [BROTHER])).toEqual({
        points: 40,
        service: null,
        study: null,
      });
    });

    it('ignores a role that was deleted after its goal was set', async () => {
      const { service } = build([
        row('points', {
          everyone: 40,
          roles: [{ role_id: 'gone', target: 99 }],
        }),
      ]);
      expect((await service.goalsForMember(CHAPTER, ['gone'])).points).toBe(40);
      expect((await service.getGoals(CHAPTER)).points.roles).toEqual([]);
    });
  });

  describe('setGoals', () => {
    it('stores everyone and the roles set apart', async () => {
      const { service, goalRepo } = build();
      const goals = {
        everyone: 600,
        roles: [{ role_id: PLEDGE, target: 900 }],
      };
      await expect(
        service.setGoals(CHAPTER, 'service', goals, 'officer-1'),
      ).resolves.toEqual(goals);
      expect(goalRepo.upsert).toHaveBeenCalledWith(
        CHAPTER,
        'service',
        goals,
        'officer-1',
      );
    });

    it.each([
      [
        "a target past the measure's ceiling",
        'study',
        { everyone: 81 * 60, roles: [] },
      ],
      [
        'a role named twice',
        'points',
        {
          everyone: null,
          roles: [
            { role_id: PLEDGE, target: 10 },
            { role_id: PLEDGE, target: 20 },
          ],
        },
      ],
      [
        'a role outside the chapter',
        'points',
        {
          everyone: null,
          roles: [{ role_id: 'other-chapter-role', target: 10 }],
        },
      ],
      ['a fractional target', 'points', { everyone: 2.5, roles: [] }],
    ] as const)('refuses %s', async (_label, metric, goals) => {
      const { service, goalRepo } = build();
      await expect(
        service.setGoals(
          CHAPTER,
          metric,
          { everyone: goals.everyone, roles: [...goals.roles] },
          'officer-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(goalRepo.upsert).not.toHaveBeenCalled();
    });

    it('checks the roles within this chapter', async () => {
      const { service, roleRepo } = build();
      await service.setGoals(
        CHAPTER,
        'points',
        { everyone: null, roles: [{ role_id: BROTHER, target: 5 }] },
        'officer-1',
      );
      expect(roleRepo.findByIds).toHaveBeenCalledWith([BROTHER], CHAPTER);
    });
  });
});
