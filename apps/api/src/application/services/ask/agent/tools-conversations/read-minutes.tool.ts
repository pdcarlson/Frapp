import { Injectable, NotFoundException } from '@nestjs/common';
import {
  MEETING_SECTIONS,
  type MeetingContent,
  type MeetingSectionKey,
} from '@repo/validation';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
import { minutesTitle } from '../../../corpus/meeting-minutes-corpus-source';
import { MeetingService, type MeetingView } from '../../../meeting.service';
import { MemberService } from '../../../member.service';
import type {
  AgentEntity,
  AgentReadTool,
  AgentSource,
  AgentToolContext,
  AgentToolResult,
} from '../agent-tool';
import {
  distinctEntities,
  fitSources,
  flat,
  label,
  longDay,
  nothing,
  recordId,
} from './conversation-lines';

/** A decision or an action item is at most 1,000 characters as stored. */
const ITEM_TEXT_MAX = 1000;

const SECTION_LABEL = new Map<string, string>(
  MEETING_SECTIONS.map((section) => [section.key, section.label]),
);

const input = z.object({
  meeting: z
    .string()
    .min(1)
    .max(160)
    .describe(
      'The id of a minutes source from an earlier result ("meeting:..."), from list_meetings or search_records.',
    ),
});
type Args = z.infer<typeof input>;

const NOT_READABLE_NOTE =
  'Those minutes cannot be read: they are not there, or are not ones you can open.';

/**
 * One meeting's posted minutes in full, a source per section:
 * `GET /v1/meetings/:id`, through `MeetingService.get`, which is where who
 * may read minutes is decided (an Exec meeting's by who its event invites).
 * A meeting the asker cannot read, one in another chapter and one that is
 * not there all come back the same.
 *
 * Read live, not from the index, for what the index leaves out on purpose:
 * **who owns each action item**, by their name today, and whether the
 * asker was there. "What did I agree to do at chapter" is answered from
 * here.
 *
 * Only posted minutes. A draft is its author's until it posts
 * (`meetings.md`), and is not a source for anyone's answer, the author's
 * included.
 *
 * A decision and an action item are one line each, with the tool's words
 * first (the vote, the owner, the due day) and the officer's words after
 * the colon, so nothing typed into an item reads as its owner or its vote.
 */
@Injectable()
export class ReadMinutesTool implements AgentReadTool<Args> {
  readonly name = 'read_minutes';
  readonly description =
    "Reads one meeting's posted minutes in full: the summary, announcements, decisions with their votes, and action items with who owns each and when it is due. Takes the id of a minutes source from list_meetings or search_records.";
  readonly reading = 'Reading the minutes';
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'meetings';
  readonly effect = 'read' as const;
  readonly input = input;

  constructor(
    private readonly meetings: MeetingService,
    private readonly members: MemberService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId, timeZone } = context;
    const meetingId = recordId(args.meeting, 'meeting');
    if (!meetingId) return nothing(chapterId, NOT_READABLE_NOTE);
    let view: MeetingView;
    try {
      view = await this.meetings.get(chapterId, meetingId, userId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return nothing(chapterId, NOT_READABLE_NOTE);
      }
      throw error;
    }
    const { meeting, content } = view;
    if (meeting.chapter_id !== chapterId) {
      return nothing(chapterId, NOT_READABLE_NOTE);
    }
    if (meeting.status !== 'posted') {
      return nothing(
        chapterId,
        'Those minutes are still a draft and have not been posted.',
      );
    }

    const owners = new Set(
      content.action_items.flatMap((item) =>
        item.owner_user_id ? [item.owner_user_id] : [],
      ),
    );
    const nameOf = new Map<string, string>();
    if (owners.size > 0) {
      for (const entry of await this.members.findRosterByChapter(chapterId)) {
        if (owners.has(entry.user_id)) {
          nameOf.set(entry.user_id, label(entry.display_name, 'A member'));
        }
      }
    }

    const title = minutesTitle(meeting);
    const entities: AgentEntity[] = [];
    const sources: AgentSource[] = [];
    for (const key of view.sections) {
      const text = this.section(key, view, content, {
        userId,
        timeZone,
        nameOf,
      });
      if (!text) continue;
      sources.push({
        id: `meeting:${meeting.id}:${key}`,
        kind: 'minutes',
        title,
        detail: SECTION_LABEL.get(key) ?? key,
        date: meeting.event_start_time,
        target: { type: 'meeting', meeting_id: meeting.id },
        text,
        chat: false,
        authorIds: [],
        audience: { type: 'meeting', id: meeting.id },
      });
    }
    if (sources.length === 0) {
      return nothing(chapterId, 'Those minutes have nothing written in them.');
    }
    const fitted = fitSources(sources);
    // An owner is an entity when their action item is among what is shown,
    // and only when no other owner here goes by the same name: an answer
    // links a member by name, and one name must open one member.
    const items =
      fitted.sources.find(
        (source) => source.id === `meeting:${meeting.id}:action_items`,
      )?.text ?? '';
    const named = [...nameOf.values()];
    for (const [id, name] of nameOf) {
      const alone = named.filter((other) => other === name).length === 1;
      if (alone && items.includes(name)) {
        entities.push({ type: 'member', id, name });
      }
    }
    return {
      chapterId,
      sources: fitted.sources,
      entities: distinctEntities(entities),
      note: fitted.cut
        ? 'These minutes are longer than one result holds, so the end is cut. search_records finds passages past the cut.'
        : null,
      leftOutMessages: 0,
    };
  }

  /** One section as text, or '' when it holds nothing. */
  private section(
    key: MeetingSectionKey,
    view: MeetingView,
    content: MeetingContent,
    with_: { userId: string; timeZone: string; nameOf: Map<string, string> },
  ): string {
    switch (key) {
      case 'attendees': {
        const attendees = view.attendees;
        if (!attendees) return '';
        const count = (n: number, word: string) => `${n} ${word}`;
        const you = attendees.present.includes(with_.userId)
          ? 'You were checked in as present.'
          : attendees.late.includes(with_.userId)
            ? 'You were checked in late.'
            : attendees.excused.includes(with_.userId)
              ? 'You were excused.'
              : 'You were not checked in.';
        // Counts and the asker's own row. The list of who was absent is an
        // officer's read, and is not handed over name by name.
        return `${count(attendees.present.length, 'present')}, ${count(attendees.late.length, 'late')}, ${count(attendees.excused.length, 'excused')}. ${you}`;
      }
      case 'decisions':
        return content.decisions
          .map((decision) =>
            decision.vote
              ? `Decision (vote: ${decision.vote.for} for, ${decision.vote.against} against, ${decision.vote.abstain} abstaining): ${flat(decision.text, ITEM_TEXT_MAX)}`
              : `Decision: ${flat(decision.text, ITEM_TEXT_MAX)}`,
          )
          .join('\n');
      case 'action_items':
        return content.action_items
          .map((item) => {
            const owner = item.owner_user_id
              ? with_.nameOf.get(item.owner_user_id)
              : undefined;
            const facts = [
              owner
                ? `for ${owner}`
                : item.owner_user_id
                  ? 'for a member no longer on the roster'
                  : 'with no owner named',
              item.due_date
                ? `due ${longDay(item.due_date, with_.timeZone)}`
                : 'with no due day',
            ];
            return `Action item ${facts.join(', ')}: ${flat(item.text, ITEM_TEXT_MAX)}`;
          })
          .join('\n');
      default:
        return content[key].trim();
    }
  }
}
