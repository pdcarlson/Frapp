import { Injectable, NotFoundException } from '@nestjs/common';
import {
  STANDARDS_MEETING_TYPE,
  eventOthersInvited,
  readMeetingContent,
} from '@repo/validation';
import type { Meeting } from '#domain/entities/meeting.entity';
import type { Event } from '#domain/entities/event.entity';
import {
  BACKGROUND_MEETINGS_MAX,
  CARRIED_ITEMS_MAX,
  TOPICS_PER_MEETING_MAX,
  reportingOffices,
  standingReportsOf,
  topicLines,
  type MinutesBackground,
  type MinutesBackgroundMeeting,
} from '#domain/utils/minutes-context';
import type { MinutesRosterMember } from '#domain/utils/minutes-draft';
import { MeetingService } from './meeting.service';
import { EventService } from './event.service';

/**
 * How many posted minutes before tonight are read to find the few of the
 * same kind. Read rule first, then type and audience, so this is the most
 * rows a draft ever loads for its background.
 */
const EARLIER_MINUTES_READ = 25;

/** What a draft is told from outside tonight's sources. */
export interface MeetingDraftContext {
  /** Tonight's agenda, in order (#4934). Empty when it has none. */
  agenda: string[];
  /** Undefined when no earlier minutes qualify. */
  background?: MinutesBackground;
}

/**
 * The context packet a minutes draft reads besides tonight's sources
 * (#5477, `spec/behavior/meetings.md` § What the draft knows from earlier
 * meetings): tonight's agenda, and a little of the last few posted minutes
 * of the same kind.
 *
 * Built when the draft is written, for the officer it acts for, and stored
 * nowhere. Which earlier minutes it reads:
 *
 * - only minutes that officer may read now (`MeetingService` read rule), and
 *   whose event they can still see;
 * - only posted minutes of the same type (and, for "other", the same label),
 *   never Standards;
 * - only meetings with the same audience as tonight's (the same roles
 *   required, invited and left out, and the same rule for everyone else), so
 *   nothing from an officers-only meeting reaches minutes the whole chapter
 *   reads once they are posted;
 * - the same series first, newest first, then the rest; at most three.
 *
 * Last meeting's action items are the newest of those minutes' action
 * items. Whether one is done is never known from records: the draft reads it
 * from tonight's sources or asks.
 */
@Injectable()
export class MeetingDraftContextService {
  constructor(
    private readonly meetings: MeetingService,
    private readonly events: EventService,
  ) {}

  async contextFor(
    chapterId: string,
    meeting: Meeting,
    userId: string,
    roster: readonly MinutesRosterMember[],
  ): Promise<MeetingDraftContext> {
    if (!meeting.event_id) return { agenda: [] };
    const tonight = await this.events
      .findById(meeting.event_id, chapterId, userId)
      .catch((error: unknown) => {
        if (error instanceof NotFoundException) return null;
        throw error;
      });
    if (!tonight) return { agenda: [] };
    const agenda = (tonight.agenda ?? [])
      .map((item) => item.text.trim())
      .filter((text) => text.length > 0);

    const earlier = await this.earlierMinutes(
      chapterId,
      meeting,
      tonight,
      userId,
    );
    if (earlier.length === 0) return { agenda };

    const names = new Map(roster.map((member) => [member.userId, member.name]));
    const meetings: MinutesBackgroundMeeting[] = earlier.map((row) => {
      const content = readMeetingContent(row.content);
      return {
        date: row.event_start_time.slice(0, 10),
        name: row.event_name,
        reports: reportingOffices(content.officer_reports),
        topics: topicLines(content.discussion_log).slice(
          0,
          TOPICS_PER_MEETING_MAX,
        ),
      };
    });
    const last = earlier[0];
    const carried = readMeetingContent(last.content)
      .action_items.filter((item) => item.text.trim().length > 0)
      .slice(0, CARRIED_ITEMS_MAX)
      .map((item, index) => ({
        id: `F${index + 1}`,
        text: item.text.trim(),
        ownerUserId: item.owner_user_id,
        ownerName: item.owner_user_id
          ? (names.get(item.owner_user_id) ?? null)
          : null,
        dueDate: item.due_date,
        fromDate: last.event_start_time.slice(0, 10),
      }));
    return {
      agenda,
      background: {
        meetings,
        carried,
        standingReports: standingReportsOf(meetings),
      },
    };
  }

  /** The earlier minutes the background reads, the same series first. */
  private async earlierMinutes(
    chapterId: string,
    meeting: Meeting,
    tonight: Event,
    userId: string,
  ): Promise<Meeting[]> {
    const rows = (
      await this.meetings.listPostedBefore(
        chapterId,
        userId,
        meeting.event_start_time,
        EARLIER_MINUTES_READ,
      )
    ).filter(
      (row) =>
        row.id !== meeting.id &&
        row.event_id !== null &&
        (row.meeting_type as string) !== STANDARDS_MEETING_TYPE &&
        row.meeting_type === meeting.meeting_type &&
        (meeting.meeting_type !== 'other' ||
          sameLabel(row.other_label, meeting.other_label)),
    );
    if (rows.length === 0) return [];
    const visible = new Map(
      (
        await this.events.findVisibleByIds(
          rows.map((row) => row.event_id as string),
          chapterId,
          userId,
        )
      ).map((event) => [event.id, event]),
    );
    const series = seriesOf(tonight);
    const kept = rows.filter((row) => {
      const event = visible.get(row.event_id as string);
      return !!event && sameAudience(event, tonight);
    });
    const inSeries = kept.filter(
      (row) => seriesOf(visible.get(row.event_id as string)!) === series,
    );
    const rest = kept.filter((row) => !inSeries.includes(row));
    return [...inSeries, ...rest].slice(0, BACKGROUND_MEETINGS_MAX);
  }
}

/** A series is its first occurrence; a one-off event is its own. */
function seriesOf(event: Event): string {
  return event.parent_event_id ?? event.id;
}

function sameLabel(a: string | null, b: string | null): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

function roleSet(ids: readonly string[] | null): string {
  return [...new Set(ids ?? [])].sort().join(',');
}

/**
 * Whether two events invite the same people by the same rule: the same
 * roles required, invited and left out, and the same answer for members
 * holding none of them.
 */
export function sameAudience(a: Event, b: Event): boolean {
  return (
    roleSet(a.required_role_ids) === roleSet(b.required_role_ids) &&
    roleSet(a.optional_role_ids) === roleSet(b.optional_role_ids) &&
    roleSet(a.excluded_role_ids) === roleSet(b.excluded_role_ids) &&
    eventOthersInvited(a) === eventOthersInvited(b)
  );
}
