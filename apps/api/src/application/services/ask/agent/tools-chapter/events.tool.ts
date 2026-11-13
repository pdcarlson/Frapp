import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SystemPermissions } from '#domain/constants/permissions';
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
  count,
  dayArg,
  fitRows,
  found,
  listSourceId,
  liveSource,
  nothing,
  plainName,
  quoted,
  readWindow,
  todayLine,
  windowWords,
  wordsArg,
} from './chapter-tool-kit';
import { eventHeadline } from './event-lines';

const BACK_DAYS = 30;
const AHEAD_DAYS = 120;
const MAX_DAYS = 366;
const EVENTS_LIMIT = 60;

const input = z.object({
  from: dayArg(
    'First day to read, YYYY-MM-DD. Empty for a month back from today.',
  ),
  to: dayArg(
    'Last day to read, YYYY-MM-DD. Empty for four months ahead of today.',
  ),
  words: wordsArg(
    'Only events whose name, description or place has every one of these words, for example formal or chapter meeting. Empty for every event.',
  ),
});
type Args = z.infer<typeof input>;

/** The calendar the asker sees: `GET /v1/events`, narrowed to a stretch of days and to words. */
@Injectable()
export class EventsAgentTool implements AgentReadTool<Args> {
  readonly name = 'events';
  readonly description =
    'The chapter calendar: events in a range of days, optionally only those matching some words. Each has its date, time and place, whether the asking member must attend, and the points it is worth. Defaults to a month back and four months ahead.';
  readonly permission = SystemPermissions.MEMBERS_VIEW;
  readonly module = 'events';
  readonly effect = 'read' as const;
  readonly input = input;
  readonly reading = 'Reading the events calendar';

  constructor(
    private readonly events: EventService,
    private readonly members: MemberService,
    private readonly rbac: RbacService,
  ) {}

  async run(args: Args, context: AgentToolContext): Promise<AgentToolResult> {
    const { chapterId, userId, now } = context;
    const window = readWindow(args, context, {
      backDays: BACK_DAYS,
      aheadDays: AHEAD_DAYS,
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
    const words = plainName(args.words).split(' ').filter(Boolean);
    const matching = calendar.filter((event) => {
      const text = plainName(
        `${event.name} ${event.description ?? ''} ${event.location ?? ''}`,
      );
      return words.every((word) => text.includes(word));
    });
    const notes = window.shortened
      ? [`A read covers at most ${MAX_DAYS} days, so the range was shortened.`]
      : [];
    if (matching.length === 0) {
      return nothing(
        context,
        [
          words.length > 0
            ? 'No event in that range has those words.'
            : 'No events in that range.',
          ...notes,
        ].join(' '),
      );
    }

    // What is coming first, nearest first; then what has happened, newest
    // first. A meeting that repeats has last week's line too, and "when is
    // chapter meeting" means the next one.
    const nowIso = now.toISOString();
    const sorted = [...matching].sort((a, b) =>
      a.start_time.localeCompare(b.start_time),
    );
    const upcoming = sorted.filter((event) => event.end_time >= nowIso);
    const past = sorted.filter((event) => event.end_time < nowIso).reverse();
    const rows = [...upcoming, ...past].map((event) => {
      const over = event.end_time < nowIso;
      const asked = memberAttendance(
        event,
        member.role_ids ?? [],
        alumniRoleId,
      );
      const parts = [
        eventHeadline(event, context),
        asked === 'required'
          ? over
            ? 'You were required to attend'
            : 'You are required to attend'
          : asked === 'optional'
            ? 'Optional for you'
            : over
              ? 'You were not invited'
              : 'You are not invited',
        event.point_value > 0 ? `Worth ${event.point_value} points` : null,
        event.description ? `About: ${quoted(event.description)}` : null,
      ];
      return `${parts.filter(Boolean).join('. ')}.`;
    });
    const summary = [
      todayLine(context),
      `Events ${windowWords(window, context.timeZone)}: ${upcoming.length} coming up and ${past.length} already happened.`,
    ];
    const shown = fitRows(summary, rows, EVENTS_LIMIT);
    const cut = rows.length - shown.length;
    const cutLine =
      cut > 0
        ? `${count(cut, 'more event')} in this range not listed here. The Events page has all of them.`
        : null;
    if (cutLine) {
      notes.push(
        `Showing ${shown.length} of ${rows.length} events. A shorter range or some words narrows it.`,
      );
    }
    return found(
      context,
      liveSource({
        id: listSourceId(this.name, args.from, args.to, args.words),
        kind: 'events',
        title: 'Events',
        page: 'events',
        lines: [...summary, ...shown, ...(cutLine ? [cutLine] : [])],
      }),
      null,
      notes.length > 0 ? notes.join(' ') : null,
    );
  }
}
