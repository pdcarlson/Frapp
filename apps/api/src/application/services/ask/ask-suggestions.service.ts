import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ASK_SUGGESTED_QUESTIONS_MAX,
  askSuggestionName,
  askSuggestionText,
  eventAttendanceFor,
  isModuleEnabled,
  type AskSuggestion,
  type AskSuggestionKind,
} from '@repo/validation';
import { SystemPermissions, WILDCARD } from '#domain/constants/permissions';
import { TaskStatus } from '#domain/entities/task.entity';
import { localDateIn } from '#domain/utils/zoned-time';
import { ActService } from '../act/act.service';
import { CorpusRetrievalService } from '../corpus/corpus-retrieval.service';
import { EventService } from '../event.service';
import { FinancialInvoiceService } from '../financial-invoice.service';
import { MeetingService } from '../meeting.service';
import { MemberService } from '../member.service';
import { PointsService } from '../points.service';
import { RbacService } from '../rbac.service';
import { TaskService } from '../task.service';
import { ASK_TOOLS, toolsMemberMayUse, type AskTool } from './ask-tool';

/**
 * What Ask opens with (#4700): up to three questions and one request, each
 * built from a record the member's own account holds right now. No model is
 * called, and there is no preset list: a member with nothing to ask about
 * gets nothing, and the client shows the plain opening.
 *
 * The rules that keep a suggestion honest:
 *
 * - **Frapp can answer it.** A question is offered only when the Ask tool
 *   that answers it is one this member is offered for a typed question
 *   (`toolsMemberMayUse`: the mirrored route's permission and module), and
 *   the minutes question only for minutes that are in the search index now.
 * - **It is read as the member.** Every read here is the read the member's
 *   own page makes, through the same service, with the chapter and the user
 *   from the request's guards.
 * - **A record's name never reaches the request planner.** A question names
 *   a record (an event, a task, an invoice), and a name is text another
 *   member wrote. The client sends a tapped question with `actions: false`
 *   and marks it `suggested` in the history, and
 *   `AskConversationService` leaves a suggested turn out of what the
 *   request lane reads (`docs/security/ai-prompt-injection.md` C3). The one
 *   request offered holds weekday names and nothing else from a record, so
 *   it is sent like words the member typed.
 * - **A read that fails drops its suggestion,** never the opening.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far ahead an event is worth asking about. */
const EVENT_AHEAD_DAYS = 14;
/** Minutes older than this are not offered. */
const MINUTES_BACK_DAYS = 60;
/** How many recent minutes are checked against the index. */
const MINUTES_CHECKED = 5;
const TASKS_READ = 100;
const MINUTES_SOURCE_TYPE = 'meeting_minutes';

/** Which Ask tool answers each kind of question. */
const ANSWERED_BY: Readonly<
  Record<Exclude<AskSuggestionKind, 'minutes' | 'request'>, string>
> = {
  dues: 'my_dues',
  tasks: 'my_tasks',
  event: 'events',
  points: 'my_points',
};

/** What comes first when there is more to ask about than fits. */
const QUESTION_ORDER: readonly AskSuggestionKind[] = [
  'dues',
  'tasks',
  'event',
  'minutes',
  'points',
];

export interface AskSuggestionsInput {
  /** From `ChapterGuard`. Never from the request. */
  chapterId: string;
  /** The member, from the auth guard. */
  userId: string;
  /** The chapter's module switches, as `ChapterGuard` read them. */
  enabledModules: Record<string, boolean> | null;
  /** The member's IANA time zone. */
  timeZone: string;
}

interface UpcomingEvent {
  name: string;
  start: Date;
}

function weekday(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(
    instant,
  );
}

/** "November 9". Never abbreviated. */
function monthAndDay(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    timeZone,
  }).format(instant);
}

/** Whole calendar days from `from` to `to`, as the member's zone counts them. */
function daysBetween(from: Date, to: Date, timeZone: string): number {
  const day = (instant: Date) =>
    Date.parse(`${localDateIn(instant, timeZone)}T00:00:00.000Z`);
  return Math.round((day(to) - day(from)) / DAY_MS);
}

@Injectable()
export class AskSuggestionsService {
  private readonly logger = new Logger(AskSuggestionsService.name);

  constructor(
    private readonly rbac: RbacService,
    private readonly members: MemberService,
    private readonly events: EventService,
    private readonly tasks: TaskService,
    private readonly invoices: FinancialInvoiceService,
    private readonly points: PointsService,
    private readonly meetings: MeetingService,
    private readonly corpus: CorpusRetrievalService,
    private readonly act: ActService,
    @Inject(ASK_TOOLS) private readonly tools: readonly AskTool[],
  ) {}

  async suggest(
    input: AskSuggestionsInput,
    now: Date = new Date(),
  ): Promise<AskSuggestion[]> {
    const held = new Set(
      await this.rbac.getEffectivePermissions(input.chapterId, input.userId),
    );
    const offered = new Set(
      toolsMemberMayUse(
        this.tools.filter((tool) => tool.effect === 'read'),
        held,
        input.enabledModules,
      ).map((tool) => tool.name),
    );
    const answers = (kind: keyof typeof ANSWERED_BY) =>
      offered.has(ANSWERED_BY[kind]);

    const [dues, tasks, upcoming, minutes, points, actions] = await Promise.all(
      [
        answers('dues') ? this.read('dues', () => this.dues(input)) : null,
        answers('tasks') ? this.read('tasks', () => this.myTasks(input)) : null,
        answers('event')
          ? this.read('event', () => this.upcoming(input, now))
          : null,
        // Minutes are answered from the search index, not a tool, so the
        // check is the Minutes page's own (`MeetingController`).
        (held.has(WILDCARD) || held.has(SystemPermissions.MEMBERS_VIEW)) &&
        isModuleEnabled(input.enabledModules, 'meetings')
          ? this.read('minutes', () => this.minutes(input, now))
          : null,
        answers('points')
          ? this.read('points', () => this.hasPoints(input))
          : null,
        this.read('request', () => this.act.availableActions(input)),
      ],
    );

    const questions: Partial<Record<AskSuggestionKind, string>> = {
      dues: dues ?? undefined,
      tasks: tasks ?? undefined,
      event: upcoming?.[0]
        ? askSuggestionText.event(upcoming[0].name)
        : undefined,
      minutes: minutes ?? undefined,
      points: points ? askSuggestionText.points() : undefined,
    };
    const suggestions: AskSuggestion[] = QUESTION_ORDER.flatMap((kind) => {
      const text = questions[kind];
      return text ? [{ kind, text, request: false }] : [];
    }).slice(0, ASK_SUGGESTED_QUESTIONS_MAX);

    const request = (actions ?? []).includes('create_task')
      ? this.request(upcoming ?? [], now, input.timeZone)
      : null;
    if (request) {
      suggestions.push({ kind: 'request', text: request, request: true });
    }
    return suggestions;
  }

  /**
   * One read, or nothing. A member who may not take actions is refused by
   * `ActService` in the ordinary way, and that too is nothing to suggest.
   * Only the kind is logged, never a record's text.
   */
  private async read<T>(
    kind: AskSuggestionKind,
    run: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      if ((error as { status?: number } | null)?.status !== 403) {
        this.logger.warn(`an opening suggestion could not be read: ${kind}`);
      }
      return null;
    }
  }

  /** The unpaid invoice due soonest, as the member's Dues page shows it. */
  private async dues(input: AskSuggestionsInput): Promise<string | null> {
    const open = (await this.invoices.findByUser(input.userId, input.chapterId))
      .filter((invoice) => invoice.status === 'OPEN')
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    const title = askSuggestionName(open[0]?.title);
    return title ? askSuggestionText.dues(title) : null;
  }

  /** The member's own unfinished tasks: one by name, several by count. */
  private async myTasks(input: AskSuggestionsInput): Promise<string | null> {
    const open = (
      await this.tasks.list(input.chapterId, input.userId, false, {
        confirmed: false,
        limit: TASKS_READ,
      })
    ).filter((task) => task.stored_status !== TaskStatus.COMPLETED);
    if (open.length > 1) return askSuggestionText.tasks(open.length);
    const title = askSuggestionName(open[0]?.title);
    return title ? askSuggestionText.task(title) : null;
  }

  /**
   * What is coming that the member is invited to, soonest first, and only
   * the events whose name can be shown on one line.
   */
  private async upcoming(
    input: AskSuggestionsInput,
    now: Date,
  ): Promise<UpcomingEvent[]> {
    const [events, member] = await Promise.all([
      this.events.findByChapter(input.chapterId, input.userId, {
        endsAfter: now.toISOString(),
        startsBefore: new Date(
          now.getTime() + EVENT_AHEAD_DAYS * DAY_MS,
        ).toISOString(),
      }),
      this.members.findByUserAndChapter(input.userId, input.chapterId),
    ]);
    return events
      .filter(
        (event) =>
          Date.parse(event.start_time) > now.getTime() &&
          eventAttendanceFor(event, member.role_ids ?? []).status !==
            'not_invited',
      )
      .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))
      .flatMap((event) => {
        const name = askSuggestionName(event.name);
        return name ? [{ name, start: new Date(event.start_time) }] : [];
      });
  }

  /** The newest posted minutes the member can read that Ask can search now. */
  private async minutes(
    input: AskSuggestionsInput,
    now: Date,
  ): Promise<string | null> {
    const since = now.getTime() - MINUTES_BACK_DAYS * DAY_MS;
    const recent = (await this.meetings.list(input.chapterId, input.userId))
      .filter(
        (meeting) =>
          meeting.status === 'posted' &&
          Date.parse(meeting.event_start_time) >= since,
      )
      .sort(
        (a, b) =>
          Date.parse(b.event_start_time) - Date.parse(a.event_start_time),
      )
      .slice(0, MINUTES_CHECKED);
    if (recent.length === 0) return null;
    const indexed = await this.corpus.indexedAmong(
      input.chapterId,
      MINUTES_SOURCE_TYPE,
      recent.map((meeting) => meeting.id),
    );
    for (const meeting of recent) {
      const name = askSuggestionName(meeting.event_name);
      if (name && indexed.has(meeting.id)) {
        return askSuggestionText.minutes(
          name,
          monthAndDay(new Date(meeting.event_start_time), input.timeZone),
        );
      }
    }
    return null;
  }

  /** Whether the member's points have moved this semester. */
  private async hasPoints(input: AskSuggestionsInput): Promise<boolean> {
    const semester = await this.points.getUserSummary(
      input.chapterId,
      input.userId,
      'semester',
    );
    return semester.transactions.length > 0;
  }

  /**
   * The one request: a task to get ready for the member's next event, due
   * the day before it. Only the two weekday names come from the record. It
   * is offered for an event two to six days out, so both days are still
   * ahead and neither weekday can mean two dates.
   */
  private request(
    upcoming: readonly UpcomingEvent[],
    now: Date,
    timeZone: string,
  ): string | null {
    const event = upcoming.find((item) => {
      const days = daysBetween(now, item.start, timeZone);
      return days >= 2 && days <= 6;
    });
    if (!event) return null;
    return askSuggestionText.request(
      weekday(event.start, timeZone),
      weekday(new Date(event.start.getTime() - DAY_MS), timeZone),
    );
  }
}
