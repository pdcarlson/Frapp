import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  GOAL_ROLE_LIMIT,
  GOAL_TARGET_MAX,
  isGoalTarget,
} from '@repo/validation';
import {
  GOAL_METRICS,
  type GoalMetric,
  type GoalSet,
} from '#domain/entities/chapter-goal.entity';
import type { Role } from '#domain/entities/role.entity';
import {
  CHAPTER_GOAL_REPOSITORY,
  type IChapterGoalRepository,
} from '#domain/repositories/chapter-goal.repository.interface';
import {
  ROLE_REPOSITORY,
  type IRoleRepository,
} from '#domain/repositories/role.repository.interface';

export type ChapterGoals = Record<GoalMetric, GoalSet>;

const NO_GOALS = (): GoalSet => ({ everyone: null, roles: [] });

/**
 * Chapter goals (#1062, `spec/behavior/activity.md` § Goals): what a chapter
 * holds its members to for points and service hours this semester and study
 * hours this week. Officers set them on each module's settings page; every
 * member sees a bar toward theirs in Activity's "This semester" block.
 *
 * A measure has a goal for everyone and, optionally, a different goal for
 * some roles (Discord's role overrides, the way Who's coming reads by role).
 * A member who holds several roles set apart is held to the one on their
 * highest-ranked role, the Roles page's order.
 */
@Injectable()
export class ChapterGoalService {
  constructor(
    @Inject(CHAPTER_GOAL_REPOSITORY)
    private readonly goalRepo: IChapterGoalRepository,
    @Inject(ROLE_REPOSITORY)
    private readonly roleRepo: IRoleRepository,
  ) {}

  /**
   * Every measure's goals, with roles that no longer exist left out (a role id
   * stays in the stored list after the role is deleted).
   */
  async getGoals(chapterId: string): Promise<ChapterGoals> {
    const [rows, roles] = await Promise.all([
      this.goalRepo.findByChapter(chapterId),
      this.roleRepo.findByChapter(chapterId),
    ]);
    return this.resolve(rows, roles);
  }

  /** Replace one measure's goals, after checking every role and target. */
  async setGoals(
    chapterId: string,
    metric: GoalMetric,
    goals: GoalSet,
    userId: string,
  ): Promise<GoalSet> {
    if (goals.everyone !== null && !isGoalTarget(metric, goals.everyone)) {
      throw new BadRequestException(targetMessage(metric));
    }
    if (goals.roles.length > GOAL_ROLE_LIMIT) {
      throw new BadRequestException(
        `Set apart at most ${GOAL_ROLE_LIMIT} roles.`,
      );
    }
    const seen = new Set<string>();
    for (const role of goals.roles) {
      if (seen.has(role.role_id)) {
        throw new BadRequestException('Each role can have only one goal.');
      }
      seen.add(role.role_id);
      if (!isGoalTarget(metric, role.target)) {
        throw new BadRequestException(targetMessage(metric));
      }
    }
    if (seen.size > 0) {
      const found = await this.roleRepo.findByIds([...seen], chapterId);
      if (found.length !== seen.size) {
        throw new BadRequestException('A role in this list no longer exists.');
      }
    }
    const row = await this.goalRepo.upsert(
      chapterId,
      metric,
      {
        everyone: goals.everyone,
        roles: goals.roles.map(({ role_id, target }) => ({ role_id, target })),
      },
      userId,
    );
    return row.goals;
  }

  /**
   * The member's goal on each measure: the goal on their highest-ranked role
   * that has one, else everyone's, else `null`.
   */
  async goalsForMember(
    chapterId: string,
    memberRoleIds: readonly string[],
  ): Promise<Record<GoalMetric, number | null>> {
    const [rows, roles] = await Promise.all([
      this.goalRepo.findByChapter(chapterId),
      this.roleRepo.findByChapter(chapterId),
    ]);
    const goals = this.resolve(rows, roles);
    const held = new Set(memberRoleIds);
    const rank = new Map(
      [...roles]
        .sort(
          (a, b) =>
            a.display_order - b.display_order ||
            a.name.localeCompare(b.name) ||
            a.id.localeCompare(b.id),
        )
        .map((role, index) => [role.id, index]),
    );
    const pick = (set: GoalSet): number | null => {
      let best: { target: number; rank: number } | null = null;
      for (const goal of set.roles) {
        if (!held.has(goal.role_id)) continue;
        const at = rank.get(goal.role_id) ?? Number.POSITIVE_INFINITY;
        if (!best || at < best.rank) best = { target: goal.target, rank: at };
      }
      return best ? best.target : set.everyone;
    };
    return {
      points: pick(goals.points),
      service: pick(goals.service),
      study: pick(goals.study),
    };
  }

  private resolve(
    rows: Awaited<ReturnType<IChapterGoalRepository['findByChapter']>>,
    roles: readonly Role[],
  ): ChapterGoals {
    const live = new Set(roles.map((role) => role.id));
    const goals: ChapterGoals = {
      points: NO_GOALS(),
      service: NO_GOALS(),
      study: NO_GOALS(),
    };
    for (const row of rows) {
      if (!(GOAL_METRICS as readonly string[]).includes(row.metric)) continue;
      const stored = row.goals ?? NO_GOALS();
      goals[row.metric] = {
        everyone: isGoalTarget(row.metric, stored.everyone)
          ? stored.everyone
          : null,
        roles: (Array.isArray(stored.roles) ? stored.roles : []).filter(
          (goal) =>
            live.has(goal.role_id) && isGoalTarget(row.metric, goal.target),
        ),
      };
    }
    return goals;
  }
}

function targetMessage(metric: GoalMetric): string {
  const max = GOAL_TARGET_MAX[metric];
  return metric === 'points'
    ? `A points goal is a whole number from 1 to ${max.toLocaleString('en-US')}.`
    : `An hours goal is more than 0 and at most ${max / 60} hours.`;
}
