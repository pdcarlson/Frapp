import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
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
import { reportCaughtFailure } from '../../../infrastructure/observability/report-caught-failure';
import { ActService } from '../act/act.service';
import { CorpusRetrievalService } from '../corpus/corpus-retrieval.service';
import { EventService } from '../event.service';
import { FinancialInvoiceService } from '../financial-invoice.service';
import { MeetingService } from '../meeting.service';
import { PointsService } from '../points.service';
import { RbacService } from '../rbac.service';
import { TaskService } from '../task.service';
import { ASK_TOOLS, toolsMemberMayUse, type AskTool } from './ask-tool';
import { duesInvoicesForAsk } from './ask-tools';

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
/** An event the member must attend this soon is asked about before a sooner optional one. */
const REQUIRED_EVENT_FIRST_DAYS = 7;
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
  /** The member's roles in this chapter, as `ChapterGuard` read them. */
  roleIds: readonly string[];
  /** The chapter's module switches, as `ChapterGuard` read them. */
  enabledModules: Record<string, boolean> | null;
  /** The member's IANA time zone. */
  timeZone: string;
}

interface UpcomingEvent {
  name: string;
  start: Date;
  /** The member must attend it. */
  required: boolean;
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

/**
 * An event's day the way a member would say it. A weekday only while it can
 * mean one date; after that, the date.
 */
function dayOf(start: Date, now: Date, timeZone: string): string {
  const days = daysBetween(now, start, timeZone);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return days <= 6
    ? `on ${weekday(start, timeZone)}`
    : `on ${monthAndDay(start, timeZone)}`;
}

@Injectable()
export class AskSuggestionsService {
  private readonly logger = new Logger(AskSuggestionsService.name);

  constructor(
    private readonly rbac: RbacService,
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

    const next = this.nextEvent(upcoming ?? [], now);
    const questions: Partial<Record<AskSuggestionKind, string>> = {
      dues: dues ?? undefined,
      tasks: tasks ?? undefined,
      event: next
        ? askSuggestionText.event(
            next.name,
            dayOf(next.start, now, input.timeZone),
          )
        : undefined,
      minutes: minutes ?? undefined,
      points: points ? askSuggestionText.points() : undefined,
    };
    const suggestions: AskSuggestion[] = QUESTION_ORDER.flatMap((kind) => {
      const text = questions[kind];
      return text ? [{ kind, text, request: false }] : [];
    }).slice(0, ASK_SUGGESTED_QUESTIONS_MAX);

    const request = (actions ?? []).includes('create_task')
      ? this.request(
          [...(next ? [next] : []), ...(upcoming ?? [])],
          now,
          input.timeZone,
        )
      : null;
    if (request) {
      suggestions.push({ kind: 'request', text: request, request: true });
    }
    return suggestions;
  }

  /**
   * One read, or nothing. A member who may not take actions is refused by
   * `ActService` in the ordinary way, and that too is nothing to suggest.
   * Any other failure is reported with the kind and the error, never a
   * record's text.
   */
  private async read<T>(
    kind: AskSuggestionKind,
    run: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ForbiddenException) return null;
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: `ask-suggestion-read:${kind}`,
        message: `an opening suggestion could not be read: ${kind}`,
        // A database or programming error. Neither carries a record's text.
        error,
      });
      return null;
    }
  }

  /**
   * The unpaid invoice due soonest, among the ones the dues tool reads
   * (`duesInvoicesForAsk`), so the answer always has it.
   */
  private async dues(input: AskSuggestionsInput): Promise<string | null> {
    const open = duesInvoicesForAsk(
      await this.invoices.findByUser(input.userId, input.chapterId),
    )
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
    const events = await this.events.findByChapter(
      input.chapterId,
      input.userId,
      {
        endsAfter: now.toISOString(),
        startsBefore: new Date(
          now.getTime() + EVENT_AHEAD_DAYS * DAY_MS,
        ).toISOString(),
      },
    );
    const roles = [...input.roleIds];
    return events
      .filter((event) => Date.parse(event.start_time) > now.getTime())
      .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time))
      .flatMap((event) => {
        const { status } = eventAttendanceFor(event, roles);
        const name = askSuggestionName(event.name);
        return name && status !== 'not_invited'
          ? [
              {
                name,
                start: new Date(event.start_time),
                required: status === 'required',
              },
            ]
          : [];
      });
  }

  /**
   * The event worth asking about: one the member must attend in the next
   * week, before a sooner one that is optional for them, because "when and
   * where" is asked most about what they have to be at. Otherwise the next.
   */
  private nextEvent(
    upcoming: readonly UpcomingEvent[],
    now: Date,
  ): UpcomingEvent | null {
    const soon = now.getTime() + REQUIRED_EVENT_FIRST_DAYS * DAY_MS;
    return (
      upcoming.find(
        (event) => event.required && event.start.getTime() <= soon,
      ) ??
      upcoming[0] ??
      null
    );
  }

  /** The newest posted minutes the member can read that Ask can search now. */
  private async minutes(
    input: AskSuggestionsInput,
    now: Date,
  ): Promise<string | null> {
    // A narrow read: the newest few posted minutes in the window, not the
    // chapter's whole history with every body, on each open of Ask.
    const recent = await this.meetings.listPostedSince(
      input.chapterId,
      input.userId,
      new Date(now.getTime() - MINUTES_BACK_DAYS * DAY_MS),
      MINUTES_CHECKED,
    );
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
   * The one request: a task to get ready for the first coming event that is
   * two to six days out (the one asked about, when it fits), due the day
   * before it. Only the two weekday names come from the record. Two to six
   * days out, both days are still ahead and neither weekday can mean two
   * dates.
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
    // The calendar day before, in the member's zone. Not 24 hours before:
    // around a clock change that lands on the same day or skips one.
    const eventDay = Date.parse(
      `${localDateIn(event.start, timeZone)}T12:00:00.000Z`,
    );
    return askSuggestionText.request(
      weekday(new Date(eventDay), 'UTC'),
      weekday(new Date(eventDay - DAY_MS), 'UTC'),
    );
  }
}
