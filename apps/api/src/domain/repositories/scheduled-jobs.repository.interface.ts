import type {
  DispatchEntityType,
  DispatchThreshold,
} from '../entities/scheduled-notification-dispatch.entity';
import type { Task, TaskSeries } from '../entities/task.entity';

export const SCHEDULED_JOBS_REPOSITORY = 'SCHEDULED_JOBS_REPOSITORY';

export interface SweepEventRow {
  id: string;
  chapter_id: string;
  end_time: string;
}

/**
 * An event about to start. Carries the targeting fields because the reminder's
 * audience is resolved per event, and `name`/`start_time` because they are the
 * notification copy.
 */
export interface SweepUpcomingEventRow {
  id: string;
  chapter_id: string;
  name: string;
  start_time: string;
  /** Named in the reminder's body. Optional so older fixtures type-check. */
  location?: string | null;
  is_mandatory: boolean;
  /** Attendance by role (`eventAttendanceFor`): who the reminder reaches. */
  required_role_ids: string[] | null;
  optional_role_ids: string[] | null;
  excluded_role_ids: string[] | null;
  others_invited: boolean | null;
}

export interface SweepInvoiceRow {
  id: string;
  chapter_id: string;
  user_id: string;
  title: string;
  amount: number;
  due_date: string;
}

export interface SweepTaskRow {
  id: string;
  chapter_id: string;
  assignee_id: string;
  created_by: string;
  title: string;
  due_date: string;
  /** Set only on a task due at a time of day (#4003). */
  due_at?: string | null;
  /** The tier, role or group following it (#5473), told when it's overdue. */
  followed_by?: string | null;
  /** The group task it is a copy of (#4295 step 3), read for #5473. */
  group_id?: string | null;
}

export interface SweepPollRow {
  id: string;
  chapter_id: string;
  channel_id: string;
  expires_at: string;
}

/**
 * A chapter whose stored `theme_palette` an older engine wrote (#1165), with
 * the seed to re-derive it from.
 */
export interface StalePaletteRow {
  id: string;
  /**
   * `branding.colors.accent` as text, read with `->>` in the query itself.
   * The seed every palette writer uses (accent-engine.md §7), and also the
   * compare-and-set key for the write, so the two must be read the same way.
   * `null` when the chapter never picked an accent: the house seed.
   */
  seed: string | null;
}

/**
 * Data access for the scheduled sweeps (`ScheduledJobsService`).
 *
 * These reads are cross-chapter: a sweep runs across every chapter at once.
 * Rather than add a cross-chapter variant to three separate chapter-scoped
 * repositories (events, invoices, tasks), the queries that only the scheduler
 * needs live behind this one port. It is not the only unscoped port here:
 * `IChapterDirectoryRepository`, `IChatPushDispatchRepository` and
 * `IChatChannelRepository.findPushRouting` are too.
 *
 * Every `find*` returns `[]` on a read failure (logged): a sweep that cannot
 * read its candidates must not send a partial batch, and the next tick
 * retries. The implementation documents each query's window semantics.
 */
/** The sweep's write for one series' next copy (#5119). */
export interface MaterializeTaskSeriesCopyInput {
  seriesId: string;
  /** The `next_due_date` the sweep read: the compare-and-set. */
  expectedNext: string;
  /**
   * The `latest_due_at` the sweep read, compared too: an officer's change of
   * the time of day moves it without moving `next_due_date`.
   */
  expectedLatestDueAt: string;
  /** The copy's day. Later than `expectedNext` when days were skipped. */
  occurrenceDate: string;
  /** The copy's due moment, when it has a time of day. */
  dueAt: string | null;
  /** When this copy is due in the rule's zone: the series' next trigger. */
  latestDueAt: string;
  /** The day after this copy, or null when the rule ends with it. */
  nextDueDate: string | null;
  /** End the series after this copy. */
  end: boolean;
}

export interface IScheduledJobsRepository {
  /**
   * Live repeating-task series whose latest copy is due at or before `now`,
   * oldest trigger first, at most `limit` (#5119). Cross-chapter: the sweep
   * reads every chapter's.
   */
  findDueTaskSeries(now: Date, limit: number): Promise<TaskSeries[]>;
  /**
   * Make one series' next copy and move the series on, atomically and only
   * while it still expects `expectedNext`. Null when another instance (or an
   * officer's edit) got there first, or the day already had its copy.
   */
  materializeTaskSeriesCopy(
    input: MaterializeTaskSeriesCopyInput,
  ): Promise<Task | null>;
  /**
   * End a live series that still expects `expectedNext`, with no copy (its
   * rule ran out, or its assignee left). False when another write moved it.
   */
  endTaskSeries(seriesId: string, expectedNext: string): Promise<boolean>;
  findEventsPendingAutoAbsent(
    endedAfter: Date,
    endedBefore: Date,
  ): Promise<SweepEventRow[]>;
  findEventsStartingBetween(
    startAfter: Date,
    startOnOrBefore: Date,
  ): Promise<SweepUpcomingEventRow[]>;
  /**
   * The event's `start_time` as stored now, or `null` when the event is gone.
   * Read after a reminder claim is won, so a move that landed between the
   * sweep's read and its claim is caught (#1550). Throws on a database error.
   */
  findEventStartTime(
    chapterId: string,
    eventId: string,
  ): Promise<string | null>;
  findOpenInvoicesDueBetween(
    dueOnOrAfter: string,
    dueOnOrBefore: string,
  ): Promise<SweepInvoiceRow[]>;
  findIncompleteTasksDueBetween(
    dueOnOrAfter: string,
    dueOnOrBefore: string,
  ): Promise<SweepTaskRow[]>;
  /**
   * Open tasks due at a time of day whose `due_at` falls in `[from, to]`. The
   * day-based read above leaves these out: they are reminded by the hour.
   */
  findIncompleteTimedTasksDueBetween(
    from: Date,
    to: Date,
  ): Promise<SweepTaskRow[]>;
  findExpiredPollsPendingNotice(
    expiredAfter: Date,
    expiredBefore: Date,
  ): Promise<SweepPollRow[]>;
  findChaptersWithStalePalette(
    engineVersion: number,
  ): Promise<StalePaletteRow[]>;
  /** Compare-and-set; `false` is a lost race. Throws on a database error. */
  writeRecomputedPalette(
    row: StalePaletteRow,
    columns: {
      theme_palette: Record<string, string>;
      theme_palette_engine_version: number;
    },
  ): Promise<boolean>;
  /** `true` only for the caller that inserted the claim row. Never throws. */
  claimDispatch(
    chapterId: string,
    entityType: DispatchEntityType,
    entityId: string,
    threshold: DispatchThreshold,
    dueDate: string,
  ): Promise<boolean>;
  /** Compensates a claim whose send failed. Logs rather than throws. */
  releaseDispatch(
    chapterId: string,
    entityType: DispatchEntityType,
    entityId: string,
    threshold: DispatchThreshold,
    dueDate: string,
  ): Promise<void>;
}
