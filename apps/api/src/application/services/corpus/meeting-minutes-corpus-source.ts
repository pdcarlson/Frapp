import { Inject, Injectable } from '@nestjs/common';
import {
  MEETING_SECTIONS,
  meetingTypeLabel,
  readMeetingContent,
  type MeetingContent,
} from '@repo/validation';
import type { Meeting } from '#domain/entities/meeting.entity';
import {
  MEETING_REPOSITORY,
  type IMeetingRepository,
} from '#domain/repositories/meeting.repository.interface';
import type { CorpusSection } from '#domain/utils/corpus-chunker';
import { MeetingService } from '../meeting.service';
import type { CorpusSourceAdapter, CorpusSourceRead } from './corpus-source';

const SECTION_LABEL = new Map<string, string>(
  MEETING_SECTIONS.map((section) => [section.key, section.label]),
);

/** "November 9, 2026", in UTC: a title must not move with the server's zone. */
function longDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(iso));
}

/**
 * An action item's due day in words. The stored value is only checked for
 * its shape, so a day that isn't on the calendar ("2026-02-30") is written
 * as it was stored and never turned into a different day.
 */
function dueDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  const real =
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  return real ? longDate(date.toISOString()) : value;
}

/**
 * The minutes as sections of text, one per section of the template that has
 * anything in it. A decision carries its vote and an action item its due
 * day, in words.
 *
 * An action item's owner is left out on purpose. The owner is a member id,
 * and writing their name into a passage would keep a copy that no rename or
 * account deletion reaches (`data-retention.md`). Who owns what is live
 * data, which Ask reads through a tool, not from the index.
 */
export function minutesSections(content: MeetingContent): CorpusSection[] {
  const sections: CorpusSection[] = [];
  const add = (key: string, text: string) => {
    if (text.trim()) {
      sections.push({
        heading: SECTION_LABEL.get(key) ?? key,
        page: null,
        text,
      });
    }
  };

  add('summary', content.summary);
  add('announcements', content.announcements);
  add(
    'decisions',
    content.decisions
      .map((decision) =>
        decision.vote
          ? `${decision.text} (Vote: ${decision.vote.for} for, ${decision.vote.against} against, ${decision.vote.abstain} abstaining.)`
          : decision.text,
      )
      .join('\n\n'),
  );
  add(
    'action_items',
    content.action_items
      .map((item) => {
        const due = item.due_date ? dueDay(item.due_date) : null;
        return due ? `${item.text} (Due ${due}.)` : item.text;
      })
      .join('\n\n'),
  );
  add('officer_reports', content.officer_reports);
  add('old_business', content.old_business);
  add('new_business', content.new_business);
  add('discussion_log', content.discussion_log);
  return sections;
}

/** "Exec meeting minutes: Budget review, November 9, 2026". */
export function minutesTitle(meeting: Meeting): string {
  const type = meetingTypeLabel(meeting.meeting_type, meeting.other_label);
  return `${type} meeting minutes: ${meeting.event_name}, ${longDate(meeting.event_start_time)}`;
}

/**
 * Posted minutes as a corpus source (#720).
 *
 * Only posted minutes are indexed; a draft is its author's until it posts,
 * and the database drops a source that is no longer posted. A Standards
 * meeting has no row to index (`meetings.md` § Standards meetings).
 *
 * Who may read: `MeetingService.canRead`, the one rule for minutes
 * (`meetings.md` § Who can read minutes). It is asked per meeting at
 * retrieval, so Exec minutes are retrieved only for the members the Exec
 * meeting's event invites, and never from a copy of that rule kept here.
 */
@Injectable()
export class MeetingMinutesCorpusSource implements CorpusSourceAdapter {
  readonly type = 'meeting_minutes';

  constructor(
    @Inject(MEETING_REPOSITORY) private readonly meetings: IMeetingRepository,
    private readonly meetingService: MeetingService,
  ) {}

  async read(chapterId: string, sourceId: string): Promise<CorpusSourceRead> {
    const meeting = await this.meetings.findById(chapterId, sourceId);
    if (!meeting || meeting.status !== 'posted') return { status: 'gone' };

    const sections = minutesSections(readMeetingContent(meeting.content));
    if (sections.length === 0) return { status: 'skipped', reason: 'no_text' };

    return {
      status: 'ok',
      content: {
        title: minutesTitle(meeting),
        sourceAt: meeting.event_start_time,
        decays: true,
        sections,
      },
    };
  }

  async readableBy(
    chapterId: string,
    userId: string,
    sourceIds: readonly string[],
  ): Promise<Set<string>> {
    // `readableAmong` is `canRead` for a list. A draft the member wrote is
    // readable to them by that rule, and is still not a source: only posted
    // minutes are, so the posted check stays here.
    const ids = [...new Set(sourceIds)];
    const [readable, meetings] = await Promise.all([
      this.meetingService.readableAmong(chapterId, userId, ids),
      Promise.all(ids.map((id) => this.meetings.findById(chapterId, id))),
    ]);
    return new Set(
      meetings.flatMap((meeting) =>
        meeting && meeting.status === 'posted' && readable.has(meeting.id)
          ? [meeting.id]
          : [],
      ),
    );
  }
}
