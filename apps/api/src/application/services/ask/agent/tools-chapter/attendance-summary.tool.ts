import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { AttendanceService } from '../../../attendance.service';
import { EventService } from '../../../event.service';
import { MemberService } from '../../../member.service';
import type {
  AgentReadTool,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  count,
  dayArg,
  fitRows,
  found,
  holds,
  inBatches,
  listSourceId,
  liveSource,
  nothing,
  People,
  percent,
  readWindow,
  todayLine,
  windowWords,
} from './chapter-tool-kit';

const BACK_DAYS = 60;
const MAX_DAYS = 185;
/** The most events one summary reads; each is one attendance read. */
const EVENTS_LIMIT = 20;
const READS_AT_ONCE = 5;
const MEMBERS_LIMIT = 150;

const input = z.object({
  from: dayArg('First day to read, YYYY-MM-DD. Empty for two months back.'),
  to: dayArg('Last day to read, YYYY-MM-DD. Empty for today.'),
});
type Args = z.infer<typeof input>;

interface Tally {
  came: number;
  absent: number;
  excused: number;
}

/**
 * Attendance across recent events, member by member, for a member who runs
 * events: `GET /v1/events` and then `GET /v1/events/:id/attendance` for each
 * event that has ended, which is how the Events page gets there too. The
 * adding up is done here.
 */
@Injectable()
export class AttendanceSummaryAgentTool implements AgentReadTool<Args> {
  readonly name = 'attendance_summary';
  readonly description =
    'Attendance across the events of a range of days, member by member, for a member who runs events: how many each member attended, missed and was excused from, and their rate, with the members missing the most first. Use it for who is slipping on attendance. Defaults to the last two months.';
  readonly permission = SystemPermissions.EVENTS_UPDATE;
  readonly module = 'events';
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Adding up attendance';

  constructor(
    private readonly events: EventService,
    private readonly attendance: AttendanceService,
    private readonly members: MemberService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId, now, timeZone } = context;
    if (!holds(context, SystemPermissions.EVENTS_UPDATE)) {
      return nothing(context, 'This member cannot see who came to events.');
    }
    const window = readWindow(args, context, {
      backDays: BACK_DAYS,
      aheadDays: 0,
      maxDays: MAX_DAYS,
    });
    const [calendar, roster] = await Promise.all([
      this.events.findByChapter(chapterId, userId, {
        endsAfter: window.start.toISOString(),
        startsBefore: window.end.toISOString(),
      }),
      this.members.findRosterByChapter(chapterId),
    ]);
    const nowIso = now.toISOString();
    const ended = calendar
      .filter((event) => event.end_time < nowIso)
      .sort((a, b) => b.start_time.localeCompare(a.start_time));
    const read = ended.slice(0, EVENTS_LIMIT);
    const perEvent = await inBatches(read, READS_AT_ONCE, (event) =>
      this.attendance.getAttendance(event.id, chapterId),
    );
    const marked = perEvent.filter((rows) => rows.length > 0);
    const notes = [
      ...(window.shortened
        ? [
            `A read covers at most ${MAX_DAYS} days, so the range was shortened.`,
          ]
        : []),
      ...(ended.length > read.length
        ? [
            `Only the newest ${EVENTS_LIMIT} of ${ended.length} events in that range were read. A shorter range reads all of its events.`,
          ]
        : []),
    ];
    if (marked.length === 0) {
      return nothing(
        context,
        ['No event in that range has attendance marked.', ...notes].join(' '),
      );
    }

    const people = new People(roster);
    const tallies = new Map<string, Tally>();
    for (const row of marked.flat()) {
      if (!people.has(row.user_id)) continue;
      const tally = tallies.get(row.user_id) ?? {
        came: 0,
        absent: 0,
        excused: 0,
      };
      if (row.status === 'EXCUSED') tally.excused += 1;
      else if (row.status === 'ABSENT') tally.absent += 1;
      else tally.came += 1;
      tallies.set(row.user_id, tally);
    }
    const ranked = [...tallies]
      .map(([id, tally]) => ({ name: people.name(id), ...tally }))
      .sort(
        (a, b) =>
          b.absent - a.absent ||
          a.came - b.came ||
          a.name.localeCompare(b.name),
      );
    const rows = ranked.map((member) => {
      const counted = member.came + member.absent;
      const rate = percent(member.came, counted);
      return `${member.name}: attended ${member.came} of ${counted}${rate ? ` (${rate})` : ''}, absent ${member.absent}, excused ${member.excused}.`;
    });
    const missedAny = ranked.filter((member) => member.absent > 0).length;
    const summary = [
      todayLine(context),
      `Events with attendance marked ${windowWords(window, timeZone)}: ${marked.length}.`,
      `Members marked at one or more of them: ${ranked.length}.`,
      `Members with one or more absences: ${missedAny}.`,
      'Each line counts the events that member was marked at, leaving out the ones they were excused from. The members who missed the most come first.',
    ];
    const shown = fitRows(summary, rows, MEMBERS_LIMIT);
    const cut = rows.length - shown.length;
    const cutLine =
      cut > 0
        ? `${count(cut, 'more member')} not listed here, each with fewer absences than those above.`
        : null;
    if (cutLine)
      notes.push(`Showing ${shown.length} of ${rows.length} members.`);
    return found(
      context,
      liveSource({
        id: listSourceId(this.name, args.from, args.to),
        kind: 'events',
        title: 'Attendance',
        page: 'events',
        lines: [...summary, ...shown, ...(cutLine ? [cutLine] : [])],
      }),
      people,
      notes.length > 0 ? notes.join(' ') : null,
    );
  }
}
