import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import type { ServiceEntryStatus } from '#domain/entities/service-entry.entity';
import { ActivityStandingService } from '../../../activity-standing.service';
import { ServiceEntryService } from '../../../service-entry.service';
import type {
  AgentReadTool,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  count,
  dayArg,
  duration,
  fitRows,
  found,
  listSourceId,
  liveSource,
  longDay,
  nothing,
  quoted,
} from './chapter-tool-kit';
import { serviceDays } from './service-days';

const ENTRIES_LIMIT = 40;

const STATUS_WORDS: Record<ServiceEntryStatus, string> = {
  APPROVED: 'approved',
  PENDING: 'waiting for approval',
  REJECTED: 'not approved',
};

const input = z.object({
  from: dayArg(
    'First day of service to list, YYYY-MM-DD. Empty for about four months back.',
  ),
  to: dayArg('Last day of service to list, YYYY-MM-DD. Empty for today.'),
});
type Args = z.infer<typeof input>;

/**
 * The asker's own hours: the service they logged (`GET /v1/service-entries`
 * as a member reads it) and, from their standing (`GET
 * /v1/activity/standing`), their semester's service against its goal and
 * this week's study time.
 *
 * Study sessions are not listed one by one. The route that lists them
 * (`GET /v1/study-sessions`) also settles a session whose pause ran out,
 * which is a write, and a tool changes nothing.
 */
@Injectable()
export class MyHoursAgentTool implements AgentReadTool<Args> {
  readonly name = 'my_hours';
  readonly description =
    "The asking member's own hours: the service they logged in a range of days, each entry with its length and whether it was approved, the totals, their service goal this semester and how far they are from it, and their study time this week against its goal.";
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'hours';
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Reading your hours';

  constructor(
    private readonly service: ServiceEntryService,
    private readonly standing: ActivityStandingService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId, now, timeZone } = context;
    const days = serviceDays(args, context);
    const [entries, standing] = await Promise.all([
      // `userId` is the asker's, as the route sets it for anyone who does
      // not approve service.
      this.service.findByChapterFiltered(chapterId, {
        userId,
        startDate: days.from,
        endDate: days.to,
      }),
      this.standing.getStanding(chapterId, userId, context.enabledModules, {
        now,
      }),
    ]);
    const minutesOf = (status: ServiceEntryStatus) =>
      entries
        .filter((entry) => entry.status === status)
        .reduce((sum, entry) => sum + entry.duration_minutes, 0);
    const range = `from ${longDay(days.from, timeZone)} to ${longDay(days.to, timeZone)}`;
    const summary = [
      `Service entries you logged ${range}: ${entries.length}.`,
      `Approved service in that range: ${duration(minutesOf('APPROVED'))}.`,
      `Service waiting for approval in that range: ${duration(minutesOf('PENDING'))}.`,
    ];
    const { service, study } = standing;
    if (service) {
      summary.push(
        `Your approved service time this semester: ${duration(service.approved_minutes)}.`,
      );
      if (service.goal_minutes !== null) {
        summary.push(
          `Your service goal this semester: ${duration(service.goal_minutes)}.`,
          service.approved_minutes >= service.goal_minutes
            ? 'You have reached your service goal.'
            : `You need ${duration(service.goal_minutes - service.approved_minutes)} more of approved service to reach your goal.`,
        );
      }
    }
    if (study) {
      summary.push(`Your study time this week: ${duration(study.minutes)}.`);
      if (study.goal_minutes !== null) {
        summary.push(
          `Your study goal for the week: ${duration(study.goal_minutes)}.`,
          study.minutes >= study.goal_minutes
            ? 'You have reached your study goal for the week.'
            : `You need ${duration(study.goal_minutes - study.minutes)} more of study this week to reach your goal.`,
        );
      }
    }
    if (entries.length === 0 && !service && !study) {
      return nothing(context, 'This member has no hours in that range.');
    }
    const rows = [...entries]
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(
        (entry) =>
          `${longDay(entry.date, timeZone)}: ${duration(entry.duration_minutes)} of service, ${STATUS_WORDS[entry.status]}${entry.description ? `, ${quoted(entry.description)}` : ''}.`,
      );
    const shown = fitRows(summary, rows, ENTRIES_LIMIT);
    const cut = rows.length - shown.length;
    const cutLine =
      cut > 0
        ? `${count(cut, 'earlier entry', 'earlier entries')} not listed here. The totals above include them.`
        : null;
    const notes = [
      days.shortened
        ? 'A read covers at most a year, so the range was shortened.'
        : null,
      cutLine
        ? `Showing the newest ${shown.length} of ${rows.length} entries.`
        : null,
    ].filter(Boolean);
    return found(
      context,
      liveSource({
        id: listSourceId(this.name, args.from, args.to),
        kind: 'points',
        title: 'Your hours',
        page: null,
        lines: [...summary, ...shown, ...(cutLine ? [cutLine] : [])],
      }),
      null,
      notes.length > 0 ? notes.join(' ') : null,
    );
  }
}
