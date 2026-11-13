import { Injectable } from '@nestjs/common';
import { meetingTypeLabel, readMeetingContent } from '@repo/validation';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import type { Meeting } from '#domain/entities/meeting.entity';
import { MeetingService } from '../../../meeting.service';
import type {
  AgentReadTool,
  AgentSource,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  BAD_DATES_NOTE,
  boundedRange,
  fitSources,
  flat,
  longDateTime,
  longDay,
  nothing,
  readDateRange,
} from './conversation-lines';

/** With no dates given: a semester's worth of weekly meetings. */
const DEFAULT_DAYS = 120;
/** The longest stretch one call lists. */
const MAX_DAYS = 366;
const NAME_MAX = 120;

const input = z.object({
  since: z
    .string()
    .max(40)
    .default('')
    .describe(
      'Only meetings held from this day on, as 2026-09-01. Empty for the last four months.',
    ),
  until: z
    .string()
    .max(40)
    .default('')
    .describe('Only meetings held up to the end of this day, as 2026-11-07.'),
});
type Args = z.infer<typeof input>;

/** "3 decisions, 5 action items, a summary and announcements". */
function holds(meeting: Meeting): string {
  const content = readMeetingContent(meeting.content);
  const parts = [
    content.summary.trim() ? 'a summary' : null,
    content.announcements.trim() ? 'announcements' : null,
    content.decisions.length > 0
      ? `${content.decisions.length} ${content.decisions.length === 1 ? 'decision' : 'decisions'}`
      : null,
    content.action_items.length > 0
      ? `${content.action_items.length} action ${content.action_items.length === 1 ? 'item' : 'items'}`
      : null,
    content.officer_reports.trim() ? 'officer reports' : null,
    content.old_business.trim() ? 'old business' : null,
    content.new_business.trim() ? 'new business' : null,
    content.discussion_log.trim() ? 'a discussion log' : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'nothing written yet';
}

/**
 * The meetings that have minutes, newest first, and whether each set is
 * posted: `GET /v1/meetings`, through `MeetingService.list`, which returns
 * only what this member may read. It is the map `read_minutes` is called
 * from: each meeting is a source whose id that tool takes, and its line
 * says what the minutes hold, so the model opens the one that has the
 * decisions it was asked about and not all of them.
 *
 * A meeting on the calendar that nobody has started minutes for is not
 * here; it is an event, and the calendar's tool lists it. A draft is listed
 * only for the member who may already read it (its author, or an officer
 * who edits minutes), and only as "not posted".
 */
@Injectable()
export class ListMeetingsTool implements AgentReadTool<Args> {
  readonly name = 'list_meetings';
  readonly description =
    'Lists the meetings in a stretch of days that have minutes, newest first: when each was held, whether its minutes are posted, and what they hold. Use it to find the meeting to read with read_minutes, or to answer whether minutes are up.';
  readonly reading = 'Looking at meetings';
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'meetings';
  readonly effect = 'read' as const;
  readonly input = input;

  constructor(private readonly meetings: MeetingService) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, timeZone } = context;
    const read = readDateRange(args.since, args.until, timeZone);
    if (!read) return nothing(chapterId, BAD_DATES_NOTE);
    const range = boundedRange(read, context.now, DEFAULT_DAYS, MAX_DAYS);

    const rows = (await this.meetings.list(chapterId, context.userId))
      .filter((meeting) => {
        const held = Date.parse(meeting.event_start_time);
        return (
          meeting.chapter_id === chapterId &&
          held >= range.from.getTime() &&
          held < range.before.getTime()
        );
      })
      .sort((a, b) => b.event_start_time.localeCompare(a.event_start_time));
    const stretch = `between ${longDay(range.from.toISOString(), timeZone)} and ${longDay(new Date(range.before.getTime() - 1).toISOString(), timeZone)}`;
    if (rows.length === 0) {
      return nothing(
        chapterId,
        `No meetings ${stretch} have minutes you can read. A meeting nobody has started minutes for is only on the calendar.`,
      );
    }

    const fitted = fitSources(
      rows.map((meeting): AgentSource => {
        const posted = meeting.status === 'posted';
        const type = meetingTypeLabel(
          meeting.meeting_type,
          meeting.other_label,
        );
        const name = flat(meeting.event_name, NAME_MAX);
        return {
          id: `meeting:${meeting.id}`,
          kind: 'minutes',
          title: `${flat(type, NAME_MAX)} meeting: ${name}`,
          detail: posted ? 'Minutes posted' : 'Minutes not posted',
          date: meeting.event_start_time,
          target: { type: 'meeting', meeting_id: meeting.id },
          text: [
            `${flat(type, NAME_MAX)} meeting held ${longDateTime(meeting.event_start_time, timeZone)}, named: ${name}`,
            posted
              ? `Its minutes are posted${meeting.posted_at ? `, since ${longDay(meeting.posted_at, timeZone)}` : ''}, and hold ${holds(meeting)}.`
              : 'Its minutes are a draft and are not posted yet.',
          ].join('\n'),
          chat: false,
          authorIds: [],
        };
      }),
    );
    const notes = [
      fitted.dropped > 0
        ? `Showing the newest ${fitted.sources.length} of ${rows.length} meetings ${stretch}. Narrow the dates to see earlier ones.`
        : null,
      range.clamped
        ? 'A stretch longer than a year was asked for; only its last year is listed.'
        : null,
    ].filter(Boolean);
    return {
      chapterId,
      sources: fitted.sources,
      entities: [],
      note: notes.length > 0 ? notes.join(' ') : null,
      leftOutMessages: 0,
    };
  }
}
