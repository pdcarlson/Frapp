import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { MemberService } from '../../../member.service';
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
  People,
} from './chapter-tool-kit';
import { serviceDays } from './service-days';

const BACK_DAYS = 30;
const MEMBERS_LIMIT = 250;

const input = z.object({
  from: dayArg(
    'First day of service to count, YYYY-MM-DD. Empty for thirty days back.',
  ),
  to: dayArg('Last day of service to count, YYYY-MM-DD. Empty for today.'),
});
type Args = z.infer<typeof input>;

/**
 * The chapter's approved service in a range of days: `GET
 * /v1/service-entries/leaderboard`, which every member sees, set beside the
 * roster (`GET /v1/members`) so the members with none are named too.
 */
@Injectable()
export class ServiceHoursAgentTool implements AgentReadTool<Args> {
  readonly name = 'service_hours';
  readonly description =
    "Approved service hours across the chapter in a range of days: each member's total, the chapter's total, and which active members have none. Use it for who has or has not logged service. Defaults to the last thirty days.";
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'hours';
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Reading service hours';

  constructor(
    private readonly service: ServiceEntryService,
    private readonly members: MemberService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, timeZone } = context;
    const days = serviceDays(args, context, BACK_DAYS);
    const [board, profiles] = await Promise.all([
      this.service.leaderboard(chapterId, {
        startDate: days.from,
        endDate: days.to,
      }),
      this.members.findProfilesByChapter(chapterId),
    ]);
    if (profiles.length === 0) {
      return nothing(context, 'The chapter has no members to count.');
    }
    const people = new People(profiles);
    const logged = board.filter((row) => people.has(row.user_id));
    const withService = new Set(logged.map((row) => row.user_id));
    // An alumni member is not expected to log service, so they are not
    // named as having none.
    const none = profiles
      .filter(
        (profile) => !profile.is_alumni && !withService.has(profile.user_id),
      )
      .sort((a, b) => a.display_name.localeCompare(b.display_name));
    const total = logged.reduce((sum, row) => sum + row.total_minutes, 0);
    const active = profiles.filter((profile) => !profile.is_alumni).length;
    const summary = [
      `Approved service from ${longDay(days.from, timeZone)} to ${longDay(days.to, timeZone)}.`,
      `Members with approved service in that range: ${logged.length}.`,
      `Active members with none in that range: ${none.length} of ${active}.`,
      `The chapter's approved service in that range: ${duration(total)}.`,
    ];
    const rows = [
      ...[...logged]
        .sort((a, b) => b.total_minutes - a.total_minutes)
        .map(
          (row) =>
            `${people.name(row.user_id)}: ${duration(row.total_minutes)} across ${count(row.entry_count, 'entry', 'entries')}.`,
        ),
      ...none.map(
        (profile) =>
          `${people.name(profile.user_id)}: no approved service in that range.`,
      ),
    ];
    const shown = fitRows(summary, rows, MEMBERS_LIMIT);
    const cut = rows.length - shown.length;
    const cutLine =
      cut > 0
        ? `${count(cut, 'more member')} not listed here. The counts above include them.`
        : null;
    const notes = [
      'Only approved service is counted; an entry still waiting for approval is not.',
      days.shortened
        ? 'A read covers at most a year, so the range was shortened.'
        : null,
      cutLine ? `Showing ${shown.length} of ${rows.length} members.` : null,
    ].filter(Boolean);
    return found(
      context,
      liveSource({
        id: listSourceId(this.name, args.from, args.to),
        kind: 'points',
        title: 'Service hours',
        page: null,
        lines: [...summary, ...shown, ...(cutLine ? [cutLine] : [])],
      }),
      people,
      notes.join(' '),
    );
  }
}
