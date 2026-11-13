import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { AttendanceService } from '../../../attendance.service';
import { EventService } from '../../../event.service';
import { memberAttendance } from '../../../event-role-targeting';
import { MemberService } from '../../../member.service';
import { RbacService } from '../../../rbac.service';
import type {
  AgentReadTool,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  clockTime,
  count,
  dayArg,
  fitRows,
  found,
  listSourceId,
  liveSource,
  longDay,
  nothing,
  percent,
  quoted,
  readWindow,
  todayLine,
  windowWords,
} from './chapter-tool-kit';
import { ATTENDANCE_WORDS } from './event-lines';

const BACK_DAYS = 120;
const MAX_DAYS = 366;
const EVENTS_LIMIT = 60;

const input = z.object({
  from: dayArg(
    'First day to read, YYYY-MM-DD. Empty for about four months back.',
  ),
  to: dayArg('Last day to read, YYYY-MM-DD. Empty for today.'),
});
type Args = z.infer<typeof input>;

/**
 * What the asker attended: their own calendar (`GET /v1/events`) with their
 * own row for each event (`GET /v1/events/:id/attendance/me`, read for all
 * of them at once). Only events that have ended, so nothing still open for
 * check-in counts against them.
 */
@Injectable()
export class MyAttendanceAgentTool implements AgentReadTool<Args> {
  readonly name = 'my_attendance';
  readonly description =
    "The asking member's own attendance: for each event that has ended in a range of days, whether they were present, late, absent or excused, with how many required events they attended and their attendance rate. Defaults to about the last four months.";
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'events';
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Reading your attendance';

  constructor(
    private readonly events: EventService,
    private readonly attendance: AttendanceService,
    private readonly members: MemberService,
    private readonly rbac: RbacService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId, now, timeZone } = context;
    const window = readWindow(args, context, {
      backDays: BACK_DAYS,
      aheadDays: 0,
      maxDays: MAX_DAYS,
    });
    const [calendar, member, alumniRoleId] = await Promise.all([
      this.events.findByChapter(chapterId, userId, {
        endsAfter: window.start.toISOString(),
        startsBefore: window.end.toISOString(),
      }),
      this.members.findByUserAndChapter(userId, chapterId),
      this.rbac.getAlumniRoleId(chapterId),
    ]);
    const nowIso = now.toISOString();
    const ended = calendar
      .map((event) => ({
        event,
        asked: memberAttendance(event, member.role_ids ?? [], alumniRoleId),
      }))
      .filter(
        ({ event, asked }) =>
          event.end_time < nowIso && asked !== 'not_invited',
      )
      .sort((a, b) => b.event.start_time.localeCompare(a.event.start_time));
    const notes = window.shortened
      ? [`A read covers at most ${MAX_DAYS} days, so the range was shortened.`]
      : [];
    if (ended.length === 0) {
      return nothing(
        context,
        [
          'No event this member was invited to has ended in that range.',
          ...notes,
        ].join(' '),
      );
    }
    const rows = await this.attendance.getMyAttendanceForEvents(
      userId,
      chapterId,
      ended.map(({ event }) => event),
    );
    const rowOf = new Map(rows.map((row) => [row.event_id, row]));

    let required = 0;
    let attendedRequired = 0;
    let excused = 0;
    let attendedOptional = 0;
    const lines = ended.map(({ event, asked }) => {
      const row = rowOf.get(event.id);
      const came = row?.status === 'PRESENT' || row?.status === 'LATE';
      if (row?.status === 'EXCUSED') excused += 1;
      else if (asked === 'required') {
        required += 1;
        if (came) attendedRequired += 1;
      } else if (came) attendedOptional += 1;
      const status = row
        ? `you were ${ATTENDANCE_WORDS[row.status]}${came && row.check_in_time ? `, checked in at ${clockTime(row.check_in_time, timeZone)}` : ''}`
        : 'nothing was recorded for you';
      return `${quoted(event.name)} on ${longDay(event.start_time, timeZone)}: ${asked === 'required' ? 'required' : 'optional'}, ${status}.`;
    });
    const rate = percent(attendedRequired, required);
    const summary = [
      todayLine(context),
      `Events you were invited to that ended ${windowWords(window, timeZone)}: ${ended.length}.`,
      `Required events, leaving out the ones you were excused from: ${required}.`,
      `Required events you attended (present or late): ${attendedRequired}.`,
      ...(rate ? [`Your attendance rate at required events: ${rate}.`] : []),
      `Events you were excused from: ${excused}.`,
      `Optional events you attended: ${attendedOptional}.`,
    ];
    const shown = fitRows(summary, lines, EVENTS_LIMIT);
    const cut = lines.length - shown.length;
    const cutLine =
      cut > 0
        ? `${count(cut, 'earlier event')} not listed here. The counts above include them.`
        : null;
    if (cutLine)
      notes.push(
        `Showing the newest ${shown.length} of ${lines.length} events.`,
      );
    return found(
      context,
      liveSource({
        id: listSourceId(this.name, args.from, args.to),
        kind: 'events',
        audience: { type: 'asker' },
        title: 'Your attendance',
        page: 'events',
        lines: [...summary, ...shown, ...(cutLine ? [cutLine] : [])],
      }),
      null,
      notes.length > 0 ? notes.join(' ') : null,
    );
  }
}
