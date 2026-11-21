import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { AttendanceService } from '../../../attendance.service';
import { EventExcuseService } from '../../../event-excuse.service';
import { EventService } from '../../../event.service';
import { memberAttendance } from '../../../event-role-targeting';
import { MemberService } from '../../../member.service';
import { RbacService } from '../../../rbac.service';
import { oneLine } from '../../ask-lines';
import type {
  AgentReadTool,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  clockTime,
  dayArg,
  found,
  liveSource,
  nothing,
  quoted,
  todayLine,
  wordsArg,
} from './chapter-tool-kit';
import {
  ambiguityNote,
  ATTENDANCE_WORDS,
  eventHeadline,
  findEvent,
} from './event-lines';

const input = z.object({
  event: wordsArg(
    "The event's name or part of it, for example formal or chapter meeting. Empty to find it by day alone.",
    120,
  ),
  on: dayArg(
    'The day the event is on, YYYY-MM-DD, when the name alone fits several (a weekly meeting). Empty for the nearest one.',
  ),
});
type Args = z.infer<typeof input>;

/**
 * One event in full, with what the asker's own event page shows about them:
 * `GET /v1/events/:id`, `GET /v1/events/:id/attendance/me` and `GET
 * /v1/events/:id/excuses/me`.
 */
@Injectable()
export class OpenEventAgentTool implements AgentReadTool<Args> {
  readonly name = 'open_event';
  readonly description =
    "One event in full, found by its name, its day or both: when and where it is, what it is about, the organizer's notes, whether the asking member must attend, whether they checked in, and where their excuse stands. Use it after the events tool when a question is about one event.";
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'events';
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Opening an event';

  constructor(
    private readonly events: EventService,
    private readonly attendance: AttendanceService,
    private readonly excuses: EventExcuseService,
    private readonly members: MemberService,
    private readonly rbac: RbacService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId, timeZone } = context;
    if (!args.event && !args.on) {
      return nothing(context, 'Give the name of the event, its day, or both.');
    }
    const foundEvent = await findEvent(this.events, args, context, 'upcoming');
    const event = foundEvent.event;
    if (!event) {
      return nothing(
        context,
        'No event fits that. The events tool lists the calendar.',
      );
    }
    const [mine, excuse, member, alumniRoleId] = await Promise.all([
      this.attendance.getMyAttendance(event.id, userId, chapterId),
      this.excuses.getMine(event.id, userId, chapterId),
      this.members.findByUserAndChapter(userId, chapterId),
      this.rbac.getAlumniRoleId(chapterId),
    ]);
    const over = Date.parse(event.end_time) < context.now.getTime();
    const asked = memberAttendance(event, member.role_ids ?? [], alumniRoleId);
    const lines = [
      todayLine(context),
      `${eventHeadline(event, context)}.`,
      asked === 'required'
        ? over
          ? 'You were required to attend.'
          : 'You are required to attend.'
        : asked === 'optional'
          ? 'It is optional for you.'
          : over
            ? 'You were not invited.'
            : 'You are not invited.',
      event.point_value > 0
        ? `It is worth ${event.point_value} points.`
        : 'It is worth no points.',
      event.description ? `About: ${quoted(event.description)}.` : null,
      event.notes ? `Organizer's notes: ${quoted(event.notes)}.` : null,
      mine
        ? `Your attendance: ${ATTENDANCE_WORDS[mine.status]}${mine.check_in_time ? `, checked in at ${clockTime(mine.check_in_time, timeZone)}` : ''}.`
        : over
          ? 'Your attendance: nothing was recorded for you.'
          : 'Your attendance: you have not checked in.',
      excuse.excuse
        ? `Your excuse: ${excuse.excuse.status === 'APPROVED' ? 'approved' : excuse.excuse.status === 'DECLINED' ? 'declined' : 'sent and waiting for an answer'}.`
        : null,
    ].filter((line): line is string => Boolean(line));
    return found(
      context,
      liveSource({
        id: `event:${event.id}`,
        kind: 'events',
        audience: { type: 'asker' },
        title: 'Events',
        detail: oneLine(event.name),
        date: event.start_time,
        page: 'events',
        lines,
      }),
      null,
      ambiguityNote(foundEvent),
    );
  }
}
