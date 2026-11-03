import type {
  DispatchEntityType,
  DispatchThreshold,
} from '../entities/scheduled-notification-dispatch.entity';

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
  is_mandatory: boolean;
  required_role_ids: string[] | null;
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
export interface IScheduledJobsRepository {
  findEventsPendingAutoAbsent(
    endedAfter: Date,
    endedBefore: Date,
  ): Promise<SweepEventRow[]>;
  findEventsStartingBetween(
    startAfter: Date,
    startOnOrBefore: Date,
  ): Promise<SweepUpcomingEventRow[]>;
  findOpenInvoicesDueBetween(
    dueOnOrAfter: string,
    dueOnOrBefore: string,
  ): Promise<SweepInvoiceRow[]>;
  findIncompleteTasksDueBetween(
    dueOnOrAfter: string,
    dueOnOrBefore: string,
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
