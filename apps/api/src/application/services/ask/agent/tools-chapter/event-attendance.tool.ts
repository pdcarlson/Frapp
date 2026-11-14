import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import type { EventAttendanceStatus } from '#domain/entities/event-attendance.entity';
import { AttendanceService } from '../../../attendance.service';
import { EventService } from '../../../event.service';
import { MemberService } from '../../../member.service';
import { oneLine } from '../../ask-lines';
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
  holds,
  liveSource,
  nothing,
  People,
  percent,
  todayLine,
  wordsArg,
} from './chapter-tool-kit';
import {
  ambiguityNote,
  ATTENDANCE_WORDS,
  eventHeadline,
  findEvent,
} from './event-lines';

const MEMBERS_LIMIT = 200;
const ORDER: EventAttendanceStatus[] = ['ABSENT', 'LATE', 'EXCUSED', 'PRESENT'];

const input = z.object({
  event: wordsArg(
    "The event's name or part of it. Empty to find it by day alone.",
    120,
  ),
  on: dayArg(
    'The day the event was on, YYYY-MM-DD. Empty for the most recent one with that name.',
  ),
});
type Args = z.infer<typeof input>;

/**
 * Who came to one event, for a member who runs events: `GET
 * /v1/events/:id/attendance`. The reason a member gave for an excuse is on
 * that page and is not read here: it is theirs, and "who came" does not
 * need it.
 */
@Injectable()
export class EventAttendanceAgentTool implements AgentReadTool<Args> {
  readonly name = 'event_attendance';
  readonly description =
    'Who came to one event, for a member who runs events: each member marked present, late, absent or excused, with the counts and the attendance rate. Find the event by its name, its day or both; with a name alone it is the most recent one.';
  readonly permission = SystemPermissions.EVENTS_UPDATE;
  readonly module = 'events';
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Reading who came';

  constructor(
    private readonly events: EventService,
    private readonly attendance: AttendanceService,
    private readonly members: MemberService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, timeZone } = context;
    // Offered only to an `events:update` holder; checked again here so the
    // whole-event read can never run for anyone else.
    if (!holds(context, SystemPermissions.EVENTS_UPDATE)) {
      return nothing(context, 'This member cannot see who came to an event.');
    }
    if (!args.event && !args.on) {
      return nothing(context, 'Give the name of the event, its day, or both.');
    }
    const foundEvent = await findEvent(this.events, args, context, 'past');
    const event = foundEvent.event;
    if (!event) {
      return nothing(
        context,
        'No event fits that. The events tool lists the calendar.',
      );
    }
    const [rows, roster] = await Promise.all([
      this.attendance.getAttendance(event.id, chapterId),
      this.members.findRosterByChapter(chapterId),
    ]);
    if (rows.length === 0) {
      return nothing(
        context,
        [
          'Nobody has been marked for that event: nobody has checked in, and absences are marked after check-in closes.',
          ambiguityNote(foundEvent),
        ]
          .filter(Boolean)
          .join(' '),
      );
    }
    const people = new People(roster);
    const tally: Record<EventAttendanceStatus, number> = {
      PRESENT: 0,
      LATE: 0,
      ABSENT: 0,
      EXCUSED: 0,
    };
    for (const row of rows) tally[row.status] += 1;
    const came = tally.PRESENT + tally.LATE;
    const counted = came + tally.ABSENT;
    const rate = percent(came, counted);
    const over = Date.parse(event.end_time) < context.now.getTime();
    const summary = [
      todayLine(context),
      `${eventHeadline(event, context)}.`,
      `Present: ${tally.PRESENT}. Late: ${tally.LATE}. Absent: ${tally.ABSENT}. Excused: ${tally.EXCUSED}.`,
      `Came (present or late): ${came}.`,
      ...(rate
        ? [
            `Attendance rate: ${rate} (${came} of ${counted}, leaving out the excused).`,
          ]
        : []),
      ...(over
        ? []
        : [
            'This event has not ended, so more members may check in and absences are not marked yet.',
          ]),
    ];
    // Who was missing first: it is what an officer asks about.
    const lines = [...rows]
      .filter((row) => people.has(row.user_id))
      .map((row) => ({ row, name: people.name(row.user_id) }))
      .sort(
        (a, b) =>
          ORDER.indexOf(a.row.status) - ORDER.indexOf(b.row.status) ||
          a.name.localeCompare(b.name),
      )
      .map(
        ({ row, name }) =>
          `${name}: ${ATTENDANCE_WORDS[row.status]}${(row.status === 'PRESENT' || row.status === 'LATE') && row.check_in_time ? `, checked in at ${clockTime(row.check_in_time, timeZone)}` : ''}.`,
      );
    const former = rows.length - lines.length;
    if (former > 0) {
      summary.push(
        `${count(former, 'of those marked is', 'of those marked are')} no longer in the chapter and not named.`,
      );
    }
    const shown = fitRows(summary, lines, MEMBERS_LIMIT);
    const cut = lines.length - shown.length;
    const cutLine =
      cut > 0
        ? `${count(cut, 'more member')} not listed here. The counts above include them.`
        : null;
    const notes = [
      ambiguityNote(foundEvent),
      cutLine ? `Showing ${shown.length} of ${lines.length} members.` : null,
    ].filter(Boolean);
    return found(
      context,
      liveSource({
        id: `event:${event.id}:attendance`,
        kind: 'events',
        title: 'Attendance',
        detail: oneLine(event.name),
        date: event.start_time,
        page: 'events',
        lines: [...summary, ...shown, ...(cutLine ? [cutLine] : [])],
      }),
      people,
      notes.length > 0 ? notes.join(' ') : null,
    );
  }
}
