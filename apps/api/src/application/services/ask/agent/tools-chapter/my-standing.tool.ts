import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { ActivityStandingService } from '../../../activity-standing.service';
import type {
  AgentReadTool,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  duration,
  found,
  listSourceId,
  liveSource,
  nothing,
  percent,
} from './chapter-tool-kit';

const input = z.object({});
type Args = z.infer<typeof input>;

/**
 * Where the asker stands with the chapter: `GET /v1/activity/standing`, the
 * numbers behind the ring on their Activity page. How far each one is from
 * its goal is worked out here.
 */
@Injectable()
export class MyStandingAgentTool implements AgentReadTool<Args> {
  readonly name = 'my_standing';
  readonly description =
    "Where the asking member stands with the chapter, the way their Activity page shows it: points this semester against their goal and their place, required events attended this semester and their attendance rate, service hours against their goal, and study time this week against their goal. Use it for 'am I on track' and 'what do I still need'.";
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  // The route itself is always on; each part answers for its own module.
  readonly module = null;
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Reading where you stand';

  constructor(private readonly standing: ActivityStandingService) {}

  async run(_args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId, now } = context;
    const standing = await this.standing.getStanding(
      chapterId,
      userId,
      context.enabledModules,
      { now },
    );
    const lines: string[] = [];
    const { points, required_events: events, service, study } = standing;
    if (points) {
      lines.push(
        `Your points this semester: ${points.total}.`,
        points.rank !== null
          ? `Your place on the points standings: ${points.rank} of ${points.ranked}.`
          : 'You are not on the points standings this semester.',
      );
      if (points.goal !== null) {
        lines.push(
          `Your points goal this semester: ${points.goal}.`,
          points.total >= points.goal
            ? 'You have reached your points goal.'
            : `You need ${points.goal - points.total} more points to reach your goal.`,
        );
      } else lines.push('You have no points goal this semester.');
    }
    if (events) {
      const rate = percent(events.attended, events.required);
      lines.push(
        `Required events so far this semester, leaving out the ones you were excused from: ${events.required}.`,
        `Required events you attended: ${events.attended}.`,
        ...(rate ? [`Your attendance rate at required events: ${rate}.`] : []),
        `Required events you missed: ${events.required - events.attended}.`,
        `Required events you were excused from: ${events.excused}.`,
      );
    }
    if (service) {
      lines.push(
        `Your approved service time this semester: ${duration(service.approved_minutes)}.`,
        `Your service time waiting for approval: ${duration(service.pending_minutes)}.`,
      );
      if (service.goal_minutes !== null) {
        lines.push(
          `Your service goal this semester: ${duration(service.goal_minutes)}.`,
          service.approved_minutes >= service.goal_minutes
            ? 'You have reached your service goal.'
            : `You need ${duration(service.goal_minutes - service.approved_minutes)} more of approved service to reach your goal.`,
        );
      } else lines.push('You have no service goal this semester.');
    }
    if (study) {
      lines.push(`Your study time this week: ${duration(study.minutes)}.`);
      if (study.goal_minutes !== null) {
        lines.push(
          `Your study goal for the week: ${duration(study.goal_minutes)}.`,
          study.minutes >= study.goal_minutes
            ? 'You have reached your study goal for the week.'
            : `You need ${duration(study.goal_minutes - study.minutes)} more of study this week to reach your goal.`,
        );
      } else lines.push('You have no study goal for the week.');
    }
    const unread =
      standing.unavailable.length > 0
        ? `Part of the standing could not be read just now (${standing.unavailable.join(', ')}), so it is missing here, not zero.`
        : null;
    if (lines.length === 0) {
      return nothing(
        context,
        unread ?? 'This chapter tracks nothing a standing is made of.',
      );
    }
    return found(
      context,
      liveSource({
        id: listSourceId(this.name),
        kind: 'points',
        title: 'Your standing',
        page: null,
        lines,
      }),
      null,
      unread,
    );
  }
}
