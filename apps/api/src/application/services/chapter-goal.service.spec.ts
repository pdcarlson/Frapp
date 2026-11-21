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

function build(
  rows: ChapterGoalRow[] = [],
  roles: Role[] = ROLES,
  memberRoleIds: string[] | null = [BROTHER],
) {
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
  const memberRepo = {
    findByUserAndChapter: jest
      .fn()
      .mockResolvedValue(
        memberRoleIds === null ? null : { role_ids: memberRoleIds },
      ),
  };
  const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new ChapterGoalService(
      goalRepo,
      roleRepo as never,
      memberRepo as never,
      auditLog as never,
    ),
    goalRepo,
    roleRepo,
    memberRepo,
    auditLog,
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

    it('breaks a tie in display order by name, as the Roles page ranks', async () => {
      // Two roles at the same place (a Discord import can do this): "Alpha"
      // outranks "Zeta" whatever order the goals were saved in.
      const alpha = { ...role('role-z', 3), name: 'Alpha' };
      const zeta = { ...role('role-a', 3), name: 'Zeta' };
      const { service } = build(
        [
          row('points', {
            everyone: null,
            roles: [
              { role_id: zeta.id, target: 70 },
              { role_id: alpha.id, target: 30 },
            ],
          }),
        ],
        [zeta, alpha],
      );
      expect(
        (await service.goalsForMember(CHAPTER, [zeta.id, alpha.id])).points,
      ).toBe(30);
    });

    it("holds a role set apart with no goal to none, over everyone's", async () => {
      const { service } = build([
        row('study', {
          everyone: 360,
          roles: [{ role_id: PLEDGE, target: null }],
        }),
      ]);
      expect((await service.goalsForMember(CHAPTER, [PLEDGE])).study).toBe(
        null,
      );
      expect((await service.goalsForMember(CHAPTER, [BROTHER])).study).toBe(
        360,
      );
    });

    it("drops a stored role target past the measure's ceiling", async () => {
      const { service } = build([
        row('study', {
          everyone: 360,
          roles: [{ role_id: PLEDGE, target: 90_000 }],
        }),
      ]);
      expect((await service.getGoals(CHAPTER)).study.roles).toEqual([]);
      expect((await service.goalsForMember(CHAPTER, [PLEDGE])).study).toBe(360);
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

  describe('goalsForUser', () => {
    it("reads the caller's own roles", async () => {
      const { service, memberRepo } = build(
        [
          row('points', {
            everyone: 40,
            roles: [{ role_id: PLEDGE, target: 60 }],
          }),
        ],
        ROLES,
        [PLEDGE],
      );
      expect(await service.goalsForUser(CHAPTER, 'user-1')).toEqual({
        points: 60,
        service: null,
        study: null,
      });
      expect(memberRepo.findByUserAndChapter).toHaveBeenCalledWith(
        'user-1',
        CHAPTER,
      );
    });

    it("gives a caller with no member row everyone's goal", async () => {
      const { service } = build(
        [row('points', { everyone: 40, roles: [] })],
        ROLES,
        null,
      );
      expect((await service.goalsForUser(CHAPTER, 'user-1')).points).toBe(40);
    });
  });

  describe('setGoals', () => {
    it('audits the change, before and after', async () => {
      const { service, auditLog } = build([
        row('service', { everyone: 300, roles: [] }),
      ]);
      await service.setGoals(
        CHAPTER,
        'service',
        { everyone: 600, roles: [] },
        'officer-1',
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          chapterId: CHAPTER,
          actorUserId: 'officer-1',
          action: 'chapter_goals_updated',
          diff: {
            service: {
              from: { everyone: 300, roles: [] },
              to: { everyone: 600, roles: [] },
            },
          },
        }),
      );
    });

    it('lets a role be held to no goal', async () => {
      const { service, goalRepo } = build();
      const goals = {
        everyone: 360,
        roles: [{ role_id: PLEDGE, target: null }],
      };
      await service.setGoals(CHAPTER, 'study', goals, 'officer-1');
      expect(goalRepo.upsert).toHaveBeenCalledWith(
        CHAPTER,
        'study',
        goals,
        'officer-1',
      );
    });

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
        "a role's target past the measure's ceiling",
        'study',
        { everyone: null, roles: [{ role_id: PLEDGE, target: 90_000 }] },
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
