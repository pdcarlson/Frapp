import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { isModuleEnabled } from '@repo/validation';
import {
  SystemPermissions,
  SystemRoleKeys,
} from '#domain/constants/permissions';
import { isUniqueViolation } from '#domain/constants/postgres-error-codes';
import type { AiRunRef } from '#domain/entities/ai-run.entity';
import type { AiSuggestion } from '#domain/entities/ai-suggestion.entity';
import { TaskStatus } from '#domain/entities/task.entity';
import {
  AI_SUGGESTION_REPOSITORY,
  type IAiSuggestionRepository,
} from '#domain/repositories/ai-suggestion.repository.interface';
import {
  CHAPTER_REPOSITORY,
  type IChapterRepository,
} from '#domain/repositories/chapter.repository.interface';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import {
  ROLE_REPOSITORY,
  type IRoleRepository,
} from '#domain/repositories/role.repository.interface';
import { isAiEnabled } from '#domain/utils/ai-enabled';
import {
  LAST_YEAR_MAX_NEW_PER_SWEEP,
  LAST_YEAR_MAX_WAITING,
  LAST_YEAR_SHIFT_DAYS,
  compareWithLastYear,
  lastYearWindows,
  seenThisYear,
  shiftDate,
  titleTokens,
  type LastYearThing,
} from '#domain/utils/last-year-comparison';
import { AiConsentService } from './ai/ai-consent.service';
import {
  AiRunFailure,
  AiRunRegistry,
  type AiRunContext,
  type AiRunHandler,
} from './ai-run-registry';
import { AiRunService } from './ai-run.service';
import { readEventPayload } from './ai-suggestion-event-kind';
import { readTaskPayload } from './ai-suggestion-task-kind';
import {
  AI_SUGGESTION_LIST_LIMIT,
  AiSuggestionService,
} from './ai-suggestion.service';
import { EventService } from './event.service';
import { NotificationService } from './notification.service';
import { RbacService } from './rbac.service';
import { TaskService } from './task.service';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

export const LAST_YEAR_RUN_KIND = 'last_year_sweep';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
/** 1970-01-05, a Monday: weeks are counted from it, so a week starts Monday. */
const FIRST_MONDAY_MS = 4 * DAY_MS;
/**
 * A chapter younger than this has no "this time last year" to read, so no
 * run is queued for it: last year's six-week stretch starts 52 weeks back.
 */
const MIN_CHAPTER_AGE_MS = (LAST_YEAR_SHIFT_DAYS - 42) * DAY_MS;

/** Which week `now` is in, counted in whole weeks from a Monday. */
export function lastYearWeekIndex(now: Date): number {
  return Math.floor((now.getTime() - FIRST_MONDAY_MS) / WEEK_MS);
}

/** A waiting suggestion this feature made, and the title it is about. */
function lastYearTitle(row: AiSuggestion): string | null {
  if (row.kind === 'event') {
    const event = readEventPayload(row.payload);
    return event.last_year_at ? event.name : null;
  }
  const task = readTaskPayload(row.payload);
  return task.last_year_on ? task.title : null;
}

/**
 * "This time last year" (#3930, `spec/behavior/ai.md` § This time last year).
 * Officers turn over every year and the chapter's record does not: once a
 * week, for each chapter whose president has Ask on, this compares the
 * coming six weeks with the same six weeks a year ago and raises, as
 * suggestions an officer accepts or dismisses, the few things the chapter did
 * then that this year's calendar and task board don't show.
 *
 * - **No model call.** The comparison is dates and titles in code
 *   (`last-year-comparison.ts` says why), and the line an officer reads is a
 *   fixed sentence around last year's own title. Nothing leaves Frapp, so
 *   there is no member's Yes to ask for and no spend to hold.
 * - **Off unless** the server has AI on and the president has Ask on: Ask is
 *   the switch for the AI reading the chapter's own records on its behalf.
 * - **Acts for the president**, the officer who turns the chapter's AI on and
 *   who hears about the result. Last year's events are read as the president
 *   reads them, and last year's tasks only if the president manages tasks.
 *   This year's record is read whole, because it is only ever used to stay
 *   quiet: something already planned for a group the president is not in is
 *   still planned.
 * - **Never nagging.** At most three new suggestions a week, none while five
 *   are waiting, and a thing is raised once a year: dismissed, accepted or
 *   expired, it does not come back until next year. A waiting suggestion is
 *   taken back by the next sweep once the thing shows up on this year's
 *   record.
 * - **One push a week at most**, to the president, and only when something
 *   new was raised that they could act on.
 * - **Under a year of history, nothing**, silently. Chat is never read, so a
 *   Discord import adds no history here.
 */
@Injectable()
export class LastYearSuggestionsService implements AiRunHandler, OnModuleInit {
  readonly kind = LAST_YEAR_RUN_KIND;
  readonly label = 'Checking this time last year';
  readonly actsForMember = true;

  private readonly logger = new Logger(LastYearSuggestionsService.name);
  /** Chapters already queued this week by this process, so a daily tick is cheap. */
  private queuedWeek = -1;
  private readonly queued = new Set<string>();

  constructor(
    @Inject(AI_SUGGESTION_REPOSITORY)
    private readonly suggestionRows: IAiSuggestionRepository,
    @Inject(CHAPTER_REPOSITORY) private readonly chapters: IChapterRepository,
    @Inject(MEMBER_REPOSITORY) private readonly members: IMemberRepository,
    @Inject(ROLE_REPOSITORY) private readonly roles: IRoleRepository,
    private readonly suggestions: AiSuggestionService,
    private readonly consent: AiConsentService,
    private readonly events: EventService,
    private readonly tasks: TaskService,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationService,
    private readonly runs: AiRunService,
    private readonly registry: AiRunRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  /**
   * Queues this week's run for each chapter with Ask on, a president to act
   * for, and a year behind it. Safe to call daily: a chapter's run for a week
   * is queued once (the run queue's dedupe key), and a failed one is tried
   * again the next day. Returns how many chapters were visited.
   */
  async sweep(now = new Date()): Promise<number> {
    if (!isAiEnabled()) return 0;
    const week = lastYearWeekIndex(now);
    if (week !== this.queuedWeek) {
      this.queuedWeek = week;
      this.queued.clear();
    }

    let visited = 0;
    for (const chapterId of await this.consent.chaptersWithSwitchOn('ask')) {
      if (this.queued.has(chapterId)) continue;
      try {
        const chapter = await this.chapters.findById(chapterId);
        const old =
          chapter !== null &&
          Date.parse(chapter.created_at) <= now.getTime() - MIN_CHAPTER_AGE_MS;
        const president = old ? await this.presidentOf(chapterId) : null;
        if (president) {
          await this.runs.enqueue({
            chapterId,
            kind: LAST_YEAR_RUN_KIND,
            dedupeKey: `last-year:${chapterId}:w${week}`,
            requestedBy: null,
            actingUserId: president,
            input: { week },
          });
          visited += 1;
        }
        // A chapter with no president, or too young, is asked again next
        // week: neither changes within one.
        this.queued.add(chapterId);
      } catch (error) {
        // One chapter's failure must not cost the others their week.
        reportCaughtFailure(this.logger, {
          level: 'warning',
          site: 'last-year-sweep-enqueue',
          message: `could not queue the last-year run for chapter ${chapterId}`,
          error,
        });
      }
    }
    return visited;
  }

  async run({ run }: AiRunContext): Promise<AiRunRef> {
    const chapterId = run.chapter_id;
    const actor = run.acting_user_id;
    if (!actor) {
      throw new AiRunFailure('not_permitted', 'last-year run has no member');
    }
    if (!(await this.consent.chapterSwitchOn(chapterId, 'ask'))) {
      throw new AiRunFailure(
        'ai_unavailable',
        `Ask is off in chapter ${chapterId}`,
      );
    }
    const chapter = await this.chapters.findById(chapterId);
    if (!chapter) {
      throw new AiRunFailure('source_gone', `chapter ${chapterId} is gone`);
    }
    const modules = chapter.enabled_modules ?? null;
    const moduleOn = (key: string) =>
      modules === null || isModuleEnabled(modules, key);
    const [mayAddEvents, mayManageTasks] = await Promise.all([
      moduleOn('events') &&
        this.rbac.memberHasAnyPermission(chapterId, actor, [
          SystemPermissions.EVENTS_CREATE,
        ]),
      moduleOn('tasks') &&
        this.rbac.memberHasAnyPermission(chapterId, actor, [
          SystemPermissions.TASKS_MANAGE,
        ]),
    ]);
    if (!mayAddEvents && !mayManageTasks) return { proposed: 0, withdrawn: 0 };

    const now = new Date();
    const windows = lastYearWindows(now);
    const [lastYearEvents, thisYearEvents, allTasks] = await Promise.all([
      mayAddEvents
        ? this.events.findByChapter(chapterId, actor, {
            endsAfter: windows.lastYear.from.toISOString(),
            startsBefore: windows.lastYear.to.toISOString(),
          })
        : [],
      // Read whole, never as the member: only used to stay quiet.
      this.events.findByChapter(chapterId, undefined, {
        endsAfter: windows.thisYear.from.toISOString(),
        startsBefore: windows.thisYear.to.toISOString(),
      }),
      this.tasks.list(chapterId, actor, true),
    ]);

    // A task counts as this year's when it is due in the window, or was
    // made since the window opened (a task due later, already on the board).
    const seenFrom = windows.thisYear.from.toISOString().slice(0, 10);
    const seenTo = windows.thisYear.to.toISOString().slice(0, 10);
    const thisYearTitles = [
      ...thisYearEvents.map((event) => event.name),
      ...allTasks
        .filter(
          (task) =>
            (task.due_date >= seenFrom && task.due_date <= seenTo) ||
            Date.parse(task.created_at) >= windows.thisYear.from.getTime(),
        )
        .map((task) => task.title),
    ];

    // What is waiting from earlier sweeps: take back what has since shown up
    // on this year's record, and count the rest against the cap.
    const seenTokens = thisYearTitles.map(titleTokens);
    const waiting = (
      await this.suggestionRows.listPending(chapterId, {
        permissions: null,
        now: now.toISOString(),
        offset: 0,
        limit: AI_SUGGESTION_LIST_LIMIT,
      })
    ).flatMap((row) => {
      const title = lastYearTitle(row);
      return title === null ? [] : [{ id: row.id, title }];
    });
    const nowSeen = waiting.filter((row) =>
      seenThisYear(row.title, seenTokens),
    );
    const withdrawn = await this.suggestionRows.deletePending(
      chapterId,
      nowSeen.map((row) => row.id),
    );
    const room = Math.min(
      LAST_YEAR_MAX_NEW_PER_SWEEP,
      LAST_YEAR_MAX_WAITING - (waiting.length - withdrawn),
    );
    if (room <= 0) return { proposed: 0, withdrawn };

    const things = compareWithLastYear({
      now,
      lastYearEvents,
      tasks: mayManageTasks
        ? allTasks.map((task) => ({
            id: task.id,
            title: task.title,
            description: task.description,
            due_date: task.due_date,
            completed: task.stored_status === TaskStatus.COMPLETED,
            subtasks: (task.subtasks ?? []).map((subtask) => subtask.title),
          }))
        : [],
      thisYearTitles,
    });
    const taken = await this.suggestionRows.findTakenDedupeKeys(
      chapterId,
      things.map((thing) => thing.dedupeKey),
    );
    const fresh = things
      .filter((thing) => !taken.has(thing.dedupeKey))
      .slice(0, room);

    const created: { row: AiSuggestion; thing: LastYearThing }[] = [];
    for (const thing of fresh) {
      const row = await this.propose(chapterId, run.id, actor, thing);
      if (row) created.push({ row, thing });
    }
    if (created.length > 0) {
      await this.tellPresident(chapterId, actor, modules, created);
    }
    return { proposed: created.length, withdrawn };
  }

  /**
   * One thing, one suggestion, whose source is last year's own record, so
   * only an officer who can open that record sees it. No push from here
   * (`notify: []`): the sweep sends one for the week.
   */
  private async propose(
    chapterId: string,
    runId: string,
    actor: string,
    thing: LastYearThing,
  ): Promise<AiSuggestion | null> {
    const title = thing.type === 'event' ? thing.name : thing.title;
    try {
      const { created } = await this.suggestions.proposeBatch({
        chapterId,
        batchId: randomUUID(),
        runId,
        requestedFor: actor,
        source: { type: thing.type, id: thing.sourceId, title, text: title },
        proposals: [
          {
            kind: thing.type,
            payload:
              thing.type === 'event'
                ? {
                    name: thing.name,
                    last_year_at: thing.lastYearAt,
                    times: thing.times,
                  }
                : {
                    title: thing.title,
                    description: thing.description,
                    // Nobody: the officer who did it last year has likely
                    // handed the job on.
                    assignee_id: null,
                    due_date: shiftDate(thing.lastYearOn, LAST_YEAR_SHIFT_DAYS),
                    subtasks: [...thing.subtasks],
                    last_year_on: thing.lastYearOn,
                  },
            // Last year's own title, word for word: the why.
            quote: title,
            dedupeKey: thing.dedupeKey,
          },
        ],
        notify: [],
      });
      return created[0] ?? null;
    } catch (error) {
      // Another try of this run wrote it a moment ago.
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  /** The week's one push. Best-effort: the suggestions are saved either way. */
  private async tellPresident(
    chapterId: string,
    president: string,
    modules: Record<string, boolean> | null,
    created: readonly { row: AiSuggestion; thing: LastYearThing }[],
  ): Promise<void> {
    try {
      // Only what they could act on: the list applies the same three checks
      // an accept does.
      const { items } = await this.suggestions.listForUser(
        chapterId,
        president,
        { enabledModules: modules },
      );
      const listed = new Set(items.map((item) => item.id));
      const mine = created.filter(({ row }) => listed.has(row.id));
      if (mine.length === 0) return;
      const [{ row, thing }] = mine;
      const title = thing.type === 'event' ? thing.name : thing.title;
      await this.notifications.notifyMembers(chapterId, [president], {
        title: 'This time last year',
        body:
          mine.length === 1
            ? `The chapter had “${title}” around now last year, and I don’t see it this year. Correct me if it’s already planned.`
            : `${mine.length} things the chapter did around now last year aren’t on this year’s calendar or task board. Correct me if they’re already planned.`,
        priority: 'NORMAL',
        category: thing.type === 'event' ? 'events' : 'tasks',
        data: {
          target: {
            screen: 'ai_suggestions',
            batchId: row.batch_id,
            sourceType: row.source_type,
            sourceId: row.source_id,
          },
        },
      });
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'last-year-sweep-notify',
        message: `last-year push failed in chapter ${chapterId}`,
        error,
      });
    }
  }

  private async presidentOf(chapterId: string): Promise<string | null> {
    const [members, role] = await Promise.all([
      this.members.findByChapter(chapterId),
      this.roles.findByChapterAndSystemKey(chapterId, SystemRoleKeys.PRESIDENT),
    ]);
    if (!role) return null;
    return (
      members.find((member) => member.role_ids.includes(role.id))?.user_id ??
      null
    );
  }
}
