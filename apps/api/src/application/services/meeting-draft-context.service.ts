import { Injectable, NotFoundException } from '@nestjs/common';
import {
  STANDARDS_MEETING_TYPE,
  eventOthersInvited,
  readAgendaTabledFrom,
  readMeetingContent,
} from '@repo/validation';
import type { Meeting } from '#domain/entities/meeting.entity';
import type { Event } from '#domain/entities/event.entity';
import type { MeetingType } from '@repo/validation';
import {
  BACKGROUND_MEETINGS_MAX,
  CARRIED_ITEMS_MAX,
  TOPICS_PER_MEETING_MAX,
  reportingOffices,
  standingReportsOf,
  stillOpenItems,
  topicLines,
  type MinutesBackground,
  type MinutesBackgroundMeeting,
  type MinutesCarriedItem,
} from '#domain/utils/minutes-context';
import type {
  MinutesAgendaItem,
  MinutesRosterMember,
} from '#domain/utils/minutes-draft';
import { MeetingService } from './meeting.service';
import { EventService } from './event.service';

/**
 * How many posted minutes of tonight's type before tonight are read to find
 * the few with the same audience: the most rows a draft's background loads.
 */
const EARLIER_MINUTES_READ = 25;

/** What a draft is told from outside tonight's sources. */
export interface MeetingDraftContext {
  /**
   * Tonight's agenda, in order (#4934), each item with where it was first
   * tabled when it came from an earlier Tabled list (#5534). Empty when it
   * has none.
   */
  agenda: MinutesAgendaItem[];
  /** Undefined when no earlier minutes qualify. */
  background?: MinutesBackground;
}

/**
 * The context packet a minutes draft reads besides tonight's sources
 * (#5477, `spec/behavior/meetings.md` § Drafting from notes, "What the draft
 * knows from earlier meetings"): tonight's agenda, and a little of the last
 * few posted minutes of the same kind.
 *
 * Built when the draft is written, for the officer it acts for, and stored
 * nowhere. Which earlier minutes it reads:
 *
 * - only minutes that officer may read now (`MeetingService` read rule), and
 *   whose event they can still see;
 * - only posted minutes of the same type (and, for "other", the same label;
 *   with no label, only tonight's own series), never Standards;
 * - only meetings with the same audience as tonight's (the same roles
 *   required, invited and left out, and the same rule for everyone else), so
 *   nothing from an officers-only meeting reaches minutes the whole chapter
 *   reads once they are posted;
 * - earlier meetings of tonight's series first, then the rest, each newest
 *   first; at most three. The first is "last meeting".
 *
 * Last meeting's open action items are its own action items and the ones
 * its minutes carried over and still list as open (`stillOpenItems`).
 * Whether one is done is never known from records: the draft reads it from
 * tonight's sources or asks.
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
      .map((item) => ({
        text: item.text.trim(),
        tabledFrom: readAgendaTabledFrom(item.tabled_from),
      }))
      .filter((item) => item.text.length > 0);

    const earlier = await this.earlierMinutes(
      chapterId,
      meeting,
      tonight,
      userId,
    );
    if (earlier.length === 0) return { agenda };

    const meetings: MinutesBackgroundMeeting[] = earlier.map(
      ({ row, sameSeries }) => {
        const content = readMeetingContent(row.content);
        return {
          startTime: row.event_start_time,
          name: row.event_name,
          sameSeries,
          reports: reportingOffices(content.officer_reports),
          topics: topicLines(content.discussion_log).slice(
            0,
            TOPICS_PER_MEETING_MAX,
          ),
        };
      },
    );
    return {
      agenda,
      background: {
        meetings,
        carried: carriedFrom(earlier[0].row, roster),
        standingReports: standingReportsOf(meetings),
      },
    };
  }

  /** The earlier minutes the background reads, tonight's series first. */
  private async earlierMinutes(
    chapterId: string,
    meeting: Meeting,
    tonight: Event,
    userId: string,
  ): Promise<{ row: Meeting; sameSeries: boolean }[]> {
    if ((meeting.meeting_type as string) === STANDARDS_MEETING_TYPE) return [];
    const found = await sameAudienceMinutes(this.meetings, this.events, {
      chapterId,
      userId,
      tonight,
      meetingType: meeting.meeting_type,
      otherLabel: meeting.other_label,
      excludeMeetingId: meeting.id,
    });
    const series = seriesOf(tonight);
    const kept = found.map(({ row, event }) => ({
      row,
      sameSeries: seriesOf(event) === series,
    }));
    return [
      ...kept.filter((entry) => entry.sameSeries),
      ...kept.filter((entry) => !entry.sameSeries),
    ].slice(0, BACKGROUND_MEETINGS_MAX);
  }
}

/**
 * Posted minutes held before `tonight` that `userId` may read, of events
 * they can still see that invite the same people by the same rule
 * (`sameAudience`), newest first, with each one's event. At most
 * `EARLIER_MINUTES_READ` are read. Of one type (and, for "other", the same
 * label), or of every type but Standards when `meetingType` is null. Shared
 * by the draft's background (#5477) and the agenda's suggestions (#5534).
 */
export async function sameAudienceMinutes(
  meetings: Pick<MeetingService, 'listPostedBefore'>,
  events: Pick<EventService, 'findVisibleByIds'>,
  options: {
    chapterId: string;
    userId: string;
    tonight: Event;
    meetingType: MeetingType | null;
    otherLabel?: string | null;
    excludeMeetingId?: string;
  },
): Promise<{ row: Meeting; event: Event }[]> {
  const { chapterId, userId, tonight, meetingType } = options;
  const rows = (
    await meetings.listPostedBefore(
      chapterId,
      userId,
      tonight.start_time,
      meetingType,
      EARLIER_MINUTES_READ,
    )
  ).filter(
    (row) =>
      row.id !== options.excludeMeetingId &&
      row.event_id !== null &&
      row.event_id !== tonight.id &&
      (row.meeting_type as string) !== STANDARDS_MEETING_TYPE &&
      (meetingType === null || row.meeting_type === meetingType) &&
      (meetingType !== 'other' ||
        sameLabel(row.other_label, options.otherLabel ?? null)),
  );
  if (rows.length === 0) return [];
  // The events themselves: their audience and series, which the read rule
  // above doesn't hand back, and only those this member still sees.
  const visible = new Map(
    (
      await events.findVisibleByIds(
        rows.map((row) => row.event_id as string),
        chapterId,
        userId,
      )
    ).map((event) => [event.id, event]),
  );
  // Other with no label says nothing about what kind of meeting it is, so
  // only earlier meetings of tonight's own series count: a one-off
  // "Ben Cunningham Meeting" reads no other meeting's action items.
  const seriesOnly =
    meetingType === 'other' && !(options.otherLabel ?? '').trim();
  return rows.flatMap((row) => {
    const event = visible.get(row.event_id as string);
    return event &&
      sameAudience(event, tonight) &&
      (!seriesOnly || seriesOf(event) === seriesOf(tonight))
      ? [{ row, event }]
      : [];
  });
}

/**
 * Last meeting's open action items: its own, then the ones its minutes
 * carried over and still list as open, each once.
 */
function carriedFrom(
  last: Meeting,
  roster: readonly MinutesRosterMember[],
): MinutesCarriedItem[] {
  const content = readMeetingContent(last.content);
  const names = new Map(roster.map((member) => [member.userId, member.name]));
  const byName = (name: string | null) => {
    if (!name) return null;
    const matches = roster.filter(
      (member) => member.name.toLowerCase() === name.toLowerCase(),
    );
    return matches.length === 1 ? matches[0].userId : null;
  };
  const items = [
    ...content.action_items.map((item) => ({
      text: item.text.trim(),
      ownerUserId: item.owner_user_id,
      dueDate: item.due_date,
    })),
    ...[
      ...stillOpenItems(content.old_business),
      ...stillOpenItems(content.discussion_log),
    ].map((item) => ({
      text: item.text,
      ownerUserId: byName(item.ownerName),
      dueDate: null,
    })),
  ].filter((item) => item.text.length > 0);
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const key = item.text.toLowerCase().replace(/[.\s]+$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, CARRIED_ITEMS_MAX)
    .map((item, index) => ({
      id: `F${index + 1}`,
      text: item.text,
      ownerUserId: item.ownerUserId,
      ownerName: item.ownerUserId
        ? (names.get(item.ownerUserId) ?? null)
        : null,
      dueDate: item.dueDate,
      fromStartTime: last.event_start_time,
    }));
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
 * Who an event invites, as one string: the roles required, invited and
 * left out, and the answer for members holding none of them. Two events
 * with the same key invite the same people by the same rule, and show to
 * the same members. Stored on a suggestion (#5534), so a row is only ever
 * read for an event that invites the same people as when it was written.
 */
export function audienceKey(event: Event): string {
  return [
    `r:${roleSet(event.required_role_ids)}`,
    `o:${roleSet(event.optional_role_ids)}`,
    `x:${roleSet(event.excluded_role_ids)}`,
    `e:${eventOthersInvited(event) ? 1 : 0}`,
  ].join(';');
}

/**
 * Whether two events invite the same people by the same rule: the same
 * roles required, invited and left out, and the same answer for members
 * holding none of them.
 */
export function sameAudience(a: Event, b: Event): boolean {
  return audienceKey(a) === audienceKey(b);
}
