import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import { randomUUID } from 'node:crypto';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import {
  MAX_IMPORT_ATTEMPTS,
  importFailureStreak,
  importRetryDelayMs,
  isTransientImportFailure,
} from './discord-import-retry';
import { toReportableError } from '../../infrastructure/observability/reportable-error';
import { isForeignKeyViolation } from '#domain/constants/postgres-error-codes';
import {
  DISCORD_IMPORT_REPOSITORY,
  type IDiscordImportRepository,
} from '#domain/repositories/discord-import.repository.interface';
import {
  DISCORD_CONNECTION_REPOSITORY,
  type IDiscordConnectionRepository,
} from '#domain/repositories/discord-connection.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import {
  MAX_ARCHIVE_EXPORT_PART_BYTES,
  MAX_WARNINGS,
} from '#domain/constants/discord-archive-limits';
import {
  CHAT_ARCHIVE_BUCKET,
  archiveImportPrefix,
} from '#domain/constants/storage';
import {
  CHAT_CATEGORY_REPOSITORY,
  CHAT_CHANNEL_REPOSITORY,
  type IChatCategoryRepository,
  type IChatChannelRepository,
} from '#domain/repositories/chat.repository.interface';
import {
  DiscordExportFormatError,
  parseExportPart,
  toImportedAttachments,
  toImportedMessage,
  type DiscordExportMessage,
  type ImportedMessageRow,
  type ImportMentionContext,
} from '#domain/utils/discord-export';
import {
  importChannelMentions,
  roleMentionNames,
  wholeChapterTargets,
} from '#domain/utils/discord-mentions';
import { parseRoleMapping } from '#domain/utils/discord-role-gates';
import {
  DiscordApiError,
  DiscordImportStoppedError,
  DiscordNotConfiguredError,
} from '#domain/adapters/discord.interface';
import { RbacService } from '../services/rbac.service';
import {
  NotificationService,
  type NotifyPayload,
} from '../services/notification.service';
import type {
  DiscordImport,
  DiscordImportChannel,
  DiscordImportFile,
  DiscordImportStatus,
} from '#domain/entities/discord-import.entity';
import { CHAT_MESSAGE_REPORT_REPOSITORY } from '#domain/repositories/chat-moderation.repository.interface';
import type { IChatMessageReportRepository } from '#domain/repositories/chat-moderation.repository.interface';
import { DiscordExportWorkerService } from './discord-export-worker.service';
import { ChannelCacheService } from '../services/channel-cache.service';
import {
  channelServesMergeKey,
  newChannelMergeKey,
} from '#domain/utils/discord-channel-merge';

/**
 * How long one tick may work before checkpointing and handing the job back.
 *
 * Comfortably inside the one-minute tick. A single long-running handler was the
 * alternative and is worse in three ways: it is invisible to the health check,
 * it loses everything on a restart, and `@nestjs/schedule` re-enters it every
 * minute regardless. Slices give restart-resume and progress reporting for free.
 */
const SLICE_BUDGET_MS = 45_000;

/** Lease length. Long enough that a slow slice never loses its own job. */
export const LEASE_MS = 5 * 60_000;

/**
 * Messages per insert. Sized well under PostgREST's `max_rows` (1000) to keep
 * each round trip small; it is a throughput choice, not a correctness one.
 * (An earlier version of this comment justified the headroom by claiming a
 * short page then means the rows ran out — that rule was #1628's bug, and it
 * never applied to an insert batch in the first place.)
 */
export const IMPORT_BATCH_SIZE = 200;

/**
 * Imported messages deleted per purge round trip. The purge loop terminates on
 * an empty round rather than a short one, so a server cap below this value
 * costs extra round trips instead of stranding rows — see `runPurgeSlice`.
 */
export const PURGE_BATCH_SIZE = 500;

/** The notification target that opens `/discord-import` on web. */
const DISCORD_IMPORT_NOTIFICATION_SCREEN = 'discord_import';

/**
 * What the admin who set an import up (`created_by`) is told when it ends on
 * its own: finished, or stopped on an error. A large server takes hours and
 * the page says they can leave, so either way they need to hear. One they
 * stopped themselves sends nothing. `admin`, like a filed chat report: officer
 * traffic with no member-facing switch. NORMAL, so quiet hours hold. The
 * target opens the import page on web; mobile has no such page and falls
 * through to the list.
 */
function importFinishedNotification(
  row: Pick<DiscordImport, 'status' | 'imported_messages' | 'guild_name'>,
): NotifyPayload {
  const base = {
    priority: 'NORMAL' as const,
    category: 'admin' as const,
    data: { target: { screen: DISCORD_IMPORT_NOTIFICATION_SCREEN } },
  };
  if (row.status === 'failed') {
    return {
      ...base,
      title: 'Discord import stopped',
      body: `The import${row.guild_name ? ` from ${row.guild_name}` : ''} stopped on an error. Open the Discord import page to see why.`,
    };
  }
  const count = row.imported_messages.toLocaleString('en-US');
  const one = row.imported_messages === 1;
  const from = row.guild_name ? ` from ${row.guild_name}` : '';
  return {
    ...base,
    title: 'Discord import finished',
    body: `${count} ${one ? 'message' : 'messages'}${from} ${one ? 'is' : 'are'} now in Frapp chat.`,
  };
}

/**
 * Statuses in which a slice may keep going.
 *
 * Every write the worker makes to the job row is conditioned on one of these,
 * so an admin who cancels or deletes mid-slice actually stops it. The lease
 * cannot do this job: it arbitrates between *workers*, and a cancel is an
 * ordinary API write on the same row.
 */
const WORKER_MAY_CONTINUE: DiscordImportStatus[] = ['ready', 'running'];

/** Discord's answers for a bot that lost its token, access, or the resource. */
const DISCORD_REFUSAL_STATUSES = new Set([401, 403, 404]);

/**
 * Whether an import ended on an expected stop rather than a fault: an
 * admin-facing stop (`DiscordImportStoppedError`, thrown by this worker and by
 * the bot export worker), the integration not configured, or Discord
 * refusing the bot (a revoked token, missing permissions, a deleted channel).
 * Everything else (the database, storage, the copy service, Discord timeouts
 * and 5xx, and its integrity refusals, which carry no status) is a fault.
 */
function isExpectedStop(error: unknown): boolean {
  if (
    error instanceof DiscordImportStoppedError ||
    error instanceof DiscordNotConfiguredError
  ) {
    return true;
  }
  return (
    error instanceof DiscordApiError &&
    error.status !== null &&
    DISCORD_REFUSAL_STATUSES.has(error.status)
  );
}

/**
 * Why an import stopped when the Frapp channel a Discord channel imports into
 * was deleted (#2922). An officer may delete any channel, one an import
 * merges into included; the mapping row keeps its record with no target, and
 * the import stops rather than write that history somewhere nobody chose.
 *
 * It points at deleting the import and importing again, not at remapping and
 * restarting as the older stops do: the channel took the history already
 * imported into it, an upload's restart resumes past it, and a remap forgets
 * the channels the import created, so a restart would make each again (#2947).
 */
function targetDeleted(
  mapping: Pick<DiscordImportChannel, 'discord_channel_name'>,
  detail = 'was deleted',
): DiscordImportStoppedError {
  const name = `#${mapping.discord_channel_name}`;
  return new DiscordImportStoppedError(
    `The Frapp channel ${name} was importing into ${detail}, so the import stopped. To bring ${name} in, delete this import and import again.`,
  );
}

/**
 * The line the import's page shows while it waits out a temporary error
 * (#1692), so an admin watching a stalled import can tell "trying again" from
 * "stopped". It says nothing about the cause: the cause is a database or
 * network detail that goes to Sentry, not a sentence an admin can act on.
 */
function retryNote(
  job: Pick<DiscordImport, 'status'>,
  attempt: number,
  delayMs: number,
): string {
  const what = job.status === 'purging' ? 'Deleting' : 'The import';
  const minutes = delayMs / 60_000;
  const wait = minutes === 1 ? 'a minute' : `${minutes} minutes`;
  return `${what} hit a temporary problem and paused. Try ${attempt + 1} of ${MAX_IMPORT_ATTEMPTS} starts in about ${wait}.`;
}

export interface ImportSweepResult {
  claimed: boolean;
  importId?: string;
  messagesImported?: number;
  finished?: boolean;
}

/**
 * Advances Discord imports, one time-boxed slice per tick.
 *
 * Runs in-process on the API against the already-registered
 * `ScheduleModule.forRoot()`, matching the posture the other chat workers use
 * (ADR-09). Unlike a Realtime subscriber, a `@Cron` handler fires on **every**
 * replica, so multi-instance safety here comes from the compare-and-swap claim
 * in the repository rather than from deployment topology — the same reasoning
 * `ScheduledJobsModule` documents for `scheduled_notification_dispatches`.
 */
@Injectable()
export class DiscordImportWorkerService {
  private readonly logger = new Logger(DiscordImportWorkerService.name);

  /** This process's identity in the lease, for operator log-reading only. */
  private readonly workerId = `${process.pid}-${randomUUID().slice(0, 8)}`;

  /**
   * In-process re-entrancy guard.
   *
   * The database claim stops two *instances* colliding; this stops one instance
   * starting a second slice while the previous one is still inside its budget.
   * They solve different problems and both are needed.
   */
  private running = false;

  constructor(
    @Inject(DISCORD_IMPORT_REPOSITORY)
    private readonly importRepo: IDiscordImportRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: IStorageProvider,
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(CHAT_CATEGORY_REPOSITORY)
    private readonly categoryRepo: IChatCategoryRepository,
    private readonly exportWorker: DiscordExportWorkerService,
    @Inject(DISCORD_CONNECTION_REPOSITORY)
    private readonly connectionRepo: IDiscordConnectionRepository,
    private readonly rbac: RbacService,
    private readonly channelCache: ChannelCacheService,
    // An open chat report holds the attachments it snapshotted (#2481), and
    // an imported message's attachments live under the import's prefix.
    @Inject(CHAT_MESSAGE_REPORT_REPOSITORY)
    private readonly reportRepo: IChatMessageReportRepository,
    // Tells the admin who set an import up that it ended: a large server
    // takes hours, and the page says they will hear.
    private readonly notifications: NotificationService,
  ) {}

  /**
   * Reap spent and expired OAuth handshakes.
   *
   * `discord_oauth_states` gains a row per "Connect Discord" click and every one
   * of them is dead within 15 minutes, so without this the table only grows —
   * and any officer can grow it at will, since minting is an ordinary
   * permitted action with no cap. Hourly rather than per-minute because nothing
   * depends on the rows being gone promptly: an expired state is already inert,
   * `consumeState` refuses it on `expires_at` regardless of whether it is still
   * on disk. This is housekeeping, not a control.
   */
  @ReportedCron(CronExpression.EVERY_HOUR)
  async handleOAuthStateSweep(): Promise<void> {
    try {
      const reaped = await this.connectionRepo.deleteExpiredStates(new Date());
      if (reaped > 0) {
        this.logger.log(`Reaped ${reaped} expired Discord OAuth handshakes.`);
      }
    } catch (error) {
      // Same reasoning as the import sweep: `@ReportedCron` would report a
      // rejection, but only as `cron:handle-oauth-state-sweep` at `error`;
      // this names the sweep, at the level a reaping miss deserves.
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'discord-oauth-state-sweep',
        message: 'Discord OAuth state sweep failed',
        error,
      });
    }
  }

  /**
   * The tick.
   *
   * The try/catch is not decoration: this handler reaches storage and the
   * database. `@ReportedCron` would report a rejection under the handler's
   * name (#3498); caught here, a failed sweep costs one tick and reports to
   * Sentry as `discord-import-sweep-tick`, the site its alerts and specs
   * know.
   */
  @ReportedCron(CronExpression.EVERY_MINUTE)
  async handleImportSweep(): Promise<void> {
    try {
      await this.sweepImports(new Date());
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: 'discord-import-sweep-tick',
        message: 'Discord import sweep failed; skipping this tick',
        error,
      });
    }
  }

  /** Takes an explicit `now` so tests drive a fixed clock. */
  async sweepImports(now: Date): Promise<ImportSweepResult> {
    if (this.running) return { claimed: false };
    this.running = true;
    try {
      const claim = await this.importRepo.claimNextRunnable(
        now,
        LEASE_MS,
        this.workerId,
      );
      if (!claim) return { claimed: false };

      const { job, lockToken } = claim;
      // The claim's clock is fixed for the tick; this one measures how long
      // the slice ran, so a pause starts when the slice failed, not when the
      // tick began (a slice can run most of its 45 s budget first).
      const sliceStartedAt = Date.now();
      // Set when the slice failed on a temporary error (#1692): the job is
      // released with its lease running to then, so no tick claims it sooner.
      let pauseUntil: Date | undefined;
      // A slice that ended cleanly after a failed one ends the streak.
      let endRetryStreak = false;
      try {
        let result: ImportSweepResult;
        if (job.status === 'purging') {
          result = await this.runPurgeSlice(job, lockToken, now);
        } else if (job.source === 'bot') {
          // The purge is source-agnostic — it deletes rows and sweeps a
          // storage prefix, both of which look identical whichever way the
          // bytes arrived. Only the FETCH differs, so only the fetch branches.
          result = await this.runBotExportSlice(job, lockToken, now);
        } else {
          result = await this.runImportSlice(job, lockToken, now);
        }
        // Any count at all is cleared: a streak, or a pre-#1692 row that
        // counted every claim.
        endRetryStreak = job.attempt_count !== 0;
        return result;
      } catch (error) {
        // Read through `toReportableError`, not `String()`: before #1264 a
        // repository threw PostgREST's plain `{ code, message }` object, which
        // `String()` turned into "[object Object]" in the log and on the page,
        // and anything else that is not an `Error` still would.
        const message = toReportableError(error).message;
        const attempt = importFailureStreak(job.attempt_count) + 1;
        const transient =
          !isExpectedStop(error) && isTransientImportFailure(error);

        if (transient && attempt < MAX_IMPORT_ATTEMPTS) {
          // Leave the job runnable and try again after a pause: a PostgREST
          // blip, a reset connection or a migration's schema-cache reload
          // clears on its own, and failing here used to end an import hours
          // in. Set before the write below, so a failure there still pauses.
          const delayMs = importRetryDelayMs(attempt);
          pauseUntil = new Date(
            now.getTime() + (Date.now() - sliceStartedAt) + delayMs,
          );
          reportCaughtFailure(this.logger, {
            level: 'warning',
            site: 'discord-import-job-retrying',
            message: `Discord import ${job.id} hit a temporary error on try ${attempt} of ${MAX_IMPORT_ATTEMPTS}; trying again in ${delayMs / 60_000} min`,
            error,
          });
          await this.importRepo.updateIfStatus(
            job.id,
            job.chapter_id,
            [...WORKER_MAY_CONTINUE, 'purging'],
            { error: retryNote(job, attempt, delayMs), attempt_count: attempt },
          );
          return { claimed: true, importId: job.id, finished: false };
        }

        if (isExpectedStop(error)) {
          logThrowable(
            this.logger,
            'warn',
            `Discord import ${job.id} failed`,
            error,
          );
        } else {
          reportCaughtFailure(this.logger, {
            level: 'error',
            site: 'discord-import-job-failed',
            message: `Discord import ${job.id} failed`,
            error,
          });
        }
        const failed = await this.importRepo.updateIfStatus(
          job.id,
          job.chapter_id,
          [...WORKER_MAY_CONTINUE, 'purging'],
          {
            status: 'failed',
            error: transient
              ? `Stopped after ${MAX_IMPORT_ATTEMPTS} tries that each hit a temporary error. The last one: ${message}`
              : message,
          },
        );
        // A deletion that failed is not news to send: the admin who asked
        // for it is watching it count down. An import that failed is.
        if (job.status !== 'purging') await this.announceFinished(failed);
        return { claimed: true, importId: job.id, finished: true };
      } finally {
        await this.importRepo
          .releaseLease(job.id, lockToken, { endRetryStreak, pauseUntil })
          .catch(() => {
            // A lost lease is the normal outcome of a slice that overran;
            // the next tick re-claims. Never worth failing the sweep over.
            // A pause that fails to write is lost with it, and the job runs
            // again after LEASE_MS instead: a different wait, not a lost job.
          });
      }
    } finally {
      this.running = false;
    }
  }

  // ── bot export ────────────────────────────────────────────────────────────

  /**
   * Run one slice of a bot-sourced import.
   *
   * Everything Discord-specific lives in `DiscordExportWorkerService`; this
   * method is the bridge that hands it the three things it must NOT reimplement
   * — the status-guarded checkpoint, the chapter-scoped channel resolution, and
   * the batch writer. All three are the phase-2 originals, unchanged.
   *
   * That is the whole point of the shape. `importBatch` is where dedupe-before-
   * insert, the two-pass reply repair and the attachment-count bookkeeping
   * live, and a second copy of any of them would be a second place for the
   * same subtle bug. The bot path differs in where messages come from and
   * nowhere else.
   */
  private async runBotExportSlice(
    job: DiscordImport,
    lockToken: string,
    now: Date,
  ): Promise<ImportSweepResult> {
    const chapterId = job.chapter_id;
    const deadline = now.getTime() + SLICE_BUDGET_MS;

    if (job.status !== 'running') {
      const started = await this.importRepo.updateIfStatus(
        job.id,
        chapterId,
        WORKER_MAY_CONTINUE,
        { status: 'running' },
      );
      if (!started) {
        return { claimed: true, importId: job.id, messagesImported: 0 };
      }
    }

    // What a role mention reads as (#2875): its Discord name. The Frapp roles
    // are read once per slice only for the fallback, an entry whose Discord
    // name was never recorded.
    const frappRoleNames = new Map(
      (await this.rbac.findByChapter(chapterId)).map((role) => [
        role.id,
        role.name,
      ]),
    );
    const roleNames = roleMentionNames({
      roleMapping: parseRoleMapping(job.role_mapping),
      frappRoleNames,
      guildId: job.guild_id,
    });

    const result = await this.exportWorker.runSlice({
      job,
      deadline,
      roleName: (id) => roleNames.get(id) ?? null,
      wholeChapterTargets: (rows) => this.wholeChapterTargets(chapterId, rows),
      /**
       * One checkpoint, two questions, both of which must be answered before
       * the next page is fetched: may this job still be advanced (the admin has
       * not cancelled), and do we still hold the lease (no other replica took
       * it over). False to either means stop — not "finish the slice".
       */
      checkpoint: async (patch) => {
        const stillRunning = await this.importRepo.updateIfStatus(
          job.id,
          chapterId,
          WORKER_MAY_CONTINUE,
          {
            total_messages: patch.totalMessages,
            imported_messages: patch.imported,
            messages_skipped: patch.skipped,
            attachments_imported: patch.attachmentsImported,
            attachments_skipped: patch.attachmentsSkipped,
            warnings: patch.warnings.slice(-MAX_WARNINGS),
          },
        );
        if (!stillRunning) {
          this.logger.log(
            `Discord import ${job.id} left the running state mid-slice; stopping.`,
          );
          return false;
        }
        const held = await this.importRepo.renewLease(
          job.id,
          lockToken,
          new Date(),
          LEASE_MS,
        );
        if (!held) {
          this.logger.warn(
            `Lost the lease on Discord import ${job.id} mid-slice; yielding.`,
          );
        }
        return held;
      },
      resolveTargetChannel: (mapping, siblings) =>
        this.resolveTargetChannel(mapping, chapterId, job.id, siblings),
      importBatch: (batch) =>
        this.importBatch({
          batch: batch.messages,
          targetChannelId: batch.targetChannelId,
          importId: job.id,
          chapterId,
          channelName: batch.channelName,
          mediaByRelativePath: batch.mediaByRelativePath,
          mentionContext: batch.mentionContext,
        }),
    });

    // The closing write is status-guarded like every other one: a slice that
    // ran alongside a cancel must not resurrect the job by writing `running`
    // over `cancelled` on its way out.
    //
    // It also persists the slice's OWN totals rather than relying on the last
    // `checkpoint`. A slice can finish having never entered a page loop — every
    // mapped channel deleted in Discord, say, which raises a warning per
    // channel and then completes — and `checkpoint` is the only writer inside
    // that loop. Without this the admin gets a green "Completed · 0 messages"
    // with an empty warning list and no statement of what went wrong.
    const closed = await this.importRepo.updateIfStatus(
      job.id,
      chapterId,
      WORKER_MAY_CONTINUE,
      {
        status: result.finished ? 'completed' : 'running',
        total_messages: result.totals.totalMessages,
        imported_messages: result.totals.imported,
        messages_skipped: result.totals.skipped,
        attachments_imported: result.totals.attachmentsImported,
        attachments_skipped: result.totals.attachmentsSkipped,
        warnings: result.totals.warnings.slice(-MAX_WARNINGS),
        completed_at: result.finished ? new Date().toISOString() : null,
        // A finished import shows no "trying again" note (#1692), even when
        // the release that would have cleared it does not land.
        ...(result.finished ? { error: null } : {}),
      },
    );
    await this.announceFinished(closed);

    return {
      claimed: true,
      importId: job.id,
      messagesImported: result.messagesImported,
      finished: result.finished,
    };
  }

  /**
   * Notify the admin who set the import up, once a closing write has made it
   * `completed` or `failed`. Those writes are status-guarded, so only one
   * slice reaches this with the closed row. Only while they can still open
   * the import page (`channels:manage` in this chapter): an officer who has
   * since left the role, or the chapter, is not sent the chapter's news.
   * Best-effort: the import is over whether or not the notice goes out, so a
   * failure is logged and never fails the slice.
   */
  private async announceFinished(row: DiscordImport | null): Promise<void> {
    if (!row?.created_by) return;
    if (row.status !== 'completed' && row.status !== 'failed') return;
    try {
      const admins = await this.rbac.findUserIdsWithPermissions(
        row.chapter_id,
        ['channels:manage'],
      );
      if (!admins.includes(row.created_by)) return;
      await this.notifications.notifyUser(
        row.created_by,
        row.chapter_id,
        importFinishedNotification(row),
      );
    } catch (error) {
      // One notice to one officer: `warning`, reported so it isn't silent
      // (#4096).
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'discord-import-finished-notify',
        message: `Could not send the finished notice for import ${row.id}`,
        error,
      });
    }
  }

  // ── import ────────────────────────────────────────────────────────────────

  private async runImportSlice(
    job: DiscordImport,
    lockToken: string,
    now: Date,
  ): Promise<ImportSweepResult> {
    const chapterId = job.chapter_id;
    const deadline = now.getTime() + SLICE_BUDGET_MS;

    const files = await this.importRepo.findFiles(job.id, chapterId);
    const parts = files
      .filter((file) => file.kind === 'export')
      .sort((a, b) => (a.part_index ?? 0) - (b.part_index ?? 0));
    const mediaByRelativePath = new Map(
      files
        .filter((file) => file.kind === 'media' && file.uploaded_at !== null)
        .map((file) => [file.relative_path, file]),
    );

    const channels = await this.importRepo.findChannels(job.id, chapterId);
    const channelBySnowflake = new Map(
      channels.map((channel) => [channel.discord_channel_id, channel]),
    );
    // DCE has already named the tokens in an export's text (its JSON writer
    // renders content as plain text), so this only matters for an export made
    // with `--markdown false`. Such an export names no roles, and its
    // `mentions` users carry their own names.
    const mentionContext: ImportMentionContext = {
      roleName: () => null,
      channel: importChannelMentions(
        channels,
        await this.wholeChapterTargets(chapterId, channels),
      ),
    };

    if (job.status !== 'running') {
      const started = await this.importRepo.updateIfStatus(
        job.id,
        chapterId,
        WORKER_MAY_CONTINUE,
        { status: 'running', parts_total: parts.length },
      );
      if (!started) {
        return { claimed: true, importId: job.id, messagesImported: 0 };
      }
    }

    const warnings = [...job.warnings];
    let partIndex = job.cursor_part_index;
    let messageIndex = job.cursor_message_index;
    let imported = job.imported_messages;
    let skipped = job.messages_skipped;
    let attachmentsImported = job.attachments_imported;
    let attachmentsSkipped = job.attachments_skipped;
    // Counted as parts are opened rather than by a preflight pass over the
    // whole export: a denominator that grows is honest about what is known, and
    // a separate counting pass would double every import's read cost to make a
    // percentage marginally smoother.
    let totalMessages = job.total_messages;

    while (partIndex < parts.length) {
      if (Date.now() >= deadline) break;

      const part = parts[partIndex];
      const bytes = await this.storage.downloadFile(
        part.bucket,
        part.storage_path,
      );
      if (!bytes) {
        warnings.push(
          `Export file "${part.relative_path}" is missing from the upload, so its messages were skipped.`,
        );
        partIndex += 1;
        messageIndex = 0;
        continue;
      }

      // The size gate at mint time reads a byte count the CLIENT declared, so it
      // is a usability check, not a control: a caller can register a part as 1
      // byte and PUT 100 MB, which the bucket accepts (`application/json` is
      // allowlisted at the bucket's 100 MB ceiling). This is the enforcement
      // point, against the bytes that actually arrived — and it has to be here,
      // before `JSON.parse`, because parsing is what would exhaust the heap.
      // A part that trips it is skipped with a warning rather than retried, so
      // the cursor advances and the import cannot loop on it forever.
      if (bytes.byteLength > MAX_ARCHIVE_EXPORT_PART_BYTES) {
        warnings.push(
          `Export file "${part.relative_path}" is ${Math.round(bytes.byteLength / 1024 / 1024)} MB, over the ${Math.round(MAX_ARCHIVE_EXPORT_PART_BYTES / 1024 / 1024)} MB limit for one export file, so its messages were skipped. Re-export with a smaller --partition.`,
        );
        partIndex += 1;
        messageIndex = 0;
        continue;
      }

      let parsed;
      try {
        parsed = parseExportPart(bytes);
      } catch (error) {
        if (!(error instanceof DiscordExportFormatError)) throw error;
        warnings.push(
          `Export file "${part.relative_path}" couldn't be read (${error.message}), so its messages were skipped.`,
        );
        partIndex += 1;
        messageIndex = 0;
        continue;
      }

      // The channel is keyed on the id read from THESE bytes, never on
      // whatever the client claimed when it uploaded. A wizard that lied about
      // which channel a part belonged to therefore cannot redirect a Discord
      // channel's history into a Frapp channel the admin did not choose.
      const mapping = channelBySnowflake.get(parsed.channel.id ?? '');
      if (!mapping || mapping.mapping_action === 'skip') {
        if (!mapping) {
          warnings.push(
            `#${parsed.channel.name ?? parsed.channel.id} had no place chosen in Frapp, so its messages were skipped.`,
          );
        }
        partIndex += 1;
        messageIndex = 0;
        continue;
      }

      const targetChannelId = await this.resolveTargetChannel(
        mapping,
        chapterId,
        job.id,
        channels,
      );
      // Counted per channel. `imported` is the job-wide running total, so
      // adding it to the channel row would credit each channel with every
      // message the whole import has written so far.
      let channelImported = 0;

      // Count each part's length exactly once, EVER — not once per slice.
      //
      // A slice can end after parsing a part and before any batch advances the
      // cursor (an 8 MB download plus parse can outlast the remaining budget on
      // its own). The next slice then re-opens that same part at message 0, so
      // a naive `messageIndex === 0` test adds its length again every minute:
      // the denominator grows without bound and the admin's progress bar walks
      // backwards toward 0% while nothing is actually stuck.
      //
      // The durable test is the persisted cursor, not a per-slice set. A part is
      // being opened for the first time iff it is past the cursor's part, or it
      // IS the cursor's part and no length was ever recorded for it.
      const firstOpen =
        partIndex > job.cursor_part_index ||
        (partIndex === job.cursor_part_index &&
          job.cursor_part_message_count === 0);
      if (firstOpen && messageIndex === 0) {
        totalMessages += parsed.messages.length;
      }

      while (messageIndex < parsed.messages.length) {
        if (Date.now() >= deadline) break;

        const batch = parsed.messages.slice(
          messageIndex,
          messageIndex + IMPORT_BATCH_SIZE,
        );
        const outcome = await this.importBatch({
          batch,
          targetChannelId,
          importId: job.id,
          chapterId,
          channelName: mapping.discord_channel_name,
          mediaByRelativePath,
          mentionContext,
        });

        imported += outcome.imported;
        channelImported += outcome.imported;
        skipped += outcome.skipped;
        attachmentsImported += outcome.attachmentsImported;
        attachmentsSkipped += outcome.attachmentsSkipped;
        warnings.push(...outcome.warnings);
        messageIndex += batch.length;

        const stillRunning = await this.importRepo.updateIfStatus(
          job.id,
          chapterId,
          WORKER_MAY_CONTINUE,
          {
            total_messages: totalMessages,
            imported_messages: imported,
            messages_skipped: skipped,
            attachments_imported: attachmentsImported,
            attachments_skipped: attachmentsSkipped,
            cursor_part_index: partIndex,
            cursor_message_index: messageIndex,
            cursor_part_message_count: parsed.messages.length,
            warnings: warnings.slice(-MAX_WARNINGS),
          },
        );
        // Null means the admin cancelled (or queued a purge) while this batch
        // was in flight. Stop here rather than finishing the slice: the
        // messages already written stay, and the purge — or a re-start — is
        // what decides what happens to them.
        if (!stillRunning) {
          this.logger.log(
            `Discord import ${job.id} left the running state mid-slice; stopping.`,
          );
          return {
            claimed: true,
            importId: job.id,
            messagesImported: imported,
          };
        }

        // A lost lease means another instance already took this job over.
        // Stop immediately rather than writing alongside it.
        const held = await this.importRepo.renewLease(
          job.id,
          lockToken,
          new Date(),
          LEASE_MS,
        );
        if (!held) {
          this.logger.warn(
            `Lost the lease on Discord import ${job.id} mid-slice; yielding.`,
          );
          return {
            claimed: true,
            importId: job.id,
            messagesImported: imported,
          };
        }
      }

      // Accumulate onto the in-memory row as well, for the same reason
      // `target_channel_id` is written back onto it: the next part of this
      // channel reuses this object, and re-reading the original base would
      // make part 1 overwrite part 0's contribution instead of adding to it.
      //
      // The target itself is not written here: the row already holds it
      // (`resolveTargetChannel` records a channel it creates or reuses at
      // once). Written again, it would point the row back at a channel an
      // officer deleted since the last insert, which fails the foreign key and
      // the import with it (#2922).
      mapping.imported_count += channelImported;
      await this.importRepo.updateChannel(mapping.id, job.id, {
        imported_count: mapping.imported_count,
        status:
          messageIndex >= parsed.messages.length ? 'completed' : 'running',
      });

      if (messageIndex < parsed.messages.length) break;
      partIndex += 1;
      messageIndex = 0;
    }

    const finished = partIndex >= parts.length;
    const closed = await this.importRepo.updateIfStatus(
      job.id,
      chapterId,
      WORKER_MAY_CONTINUE,
      {
        status: finished ? 'completed' : 'running',
        total_messages: totalMessages,
        cursor_part_index: partIndex,
        cursor_message_index: messageIndex,
        imported_messages: imported,
        messages_skipped: skipped,
        attachments_imported: attachmentsImported,
        attachments_skipped: attachmentsSkipped,
        warnings: warnings.slice(-MAX_WARNINGS),
        completed_at: finished ? new Date().toISOString() : null,
        ...(finished ? { error: null } : {}),
      },
    );
    await this.announceFinished(closed);

    return {
      claimed: true,
      importId: job.id,
      messagesImported: imported,
      finished,
    };
  }

  /**
   * Whether each Frapp channel this import's rows point at is readable by the
   * whole chapter, which decides whether a mention of it is named (#2875).
   * Chapter-scoped, like every other read of a target.
   */
  private wholeChapterTargets(
    chapterId: string,
    rows: readonly DiscordImportChannel[],
  ): Promise<Map<string, boolean>> {
    return wholeChapterTargets(rows, (ids) =>
      this.channelRepo.findByIds(chapterId, ids),
    );
  }

  private async importBatch(args: {
    batch: DiscordExportMessage[];
    targetChannelId: string;
    importId: string;
    chapterId: string;
    /** The Discord channel these messages came from, for the failure sentence. */
    channelName: string;
    mediaByRelativePath: Map<string, DiscordImportFile>;
    mentionContext: ImportMentionContext;
  }): Promise<{
    imported: number;
    skipped: number;
    attachmentsImported: number;
    attachmentsSkipped: number;
    warnings: string[];
  }> {
    const {
      batch,
      targetChannelId,
      importId,
      mediaByRelativePath,
      mentionContext,
    } = args;
    const warnings: string[] = [];

    const snowflakes = batch
      .map((message) => message.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);

    // Read before write. The dedupe index is PARTIAL, and PostgREST cannot use
    // a partial unique index as an ON CONFLICT arbiter — see the interface
    // doc on `findExistingExternalIds` for the verified behaviour. The read is
    // not wasted: it also resolves reply targets and makes `messages_skipped`
    // a real number on a re-run.
    const existing = await this.importRepo.findExistingExternalIds(
      targetChannelId,
      snowflakes,
    );

    const resolveAssetPath = (relativePath: string): string | null =>
      mediaByRelativePath.get(relativePath)?.storage_path ?? null;
    const resolveAsset = (relativePath: string) => {
      const file = mediaByRelativePath.get(relativePath);
      return file
        ? {
            bucket: file.bucket,
            storage_path: file.storage_path,
            content_type: file.content_type,
          }
        : null;
    };

    const rows: ImportedMessageRow[] = [];
    const attachmentsByExternalId = new Map<
      string,
      ReturnType<typeof toImportedAttachments>['rows']
    >();
    let attachmentsSkipped = 0;

    for (const message of batch) {
      if (message.id && existing.has(message.id)) continue;

      // Attachments are resolved BEFORE the message row is built, because
      // `attachment_count` has to be the number of rows that will actually
      // exist — not the number of entries the export listed. Two references to
      // one object collapse to a single row (the table is unique per object per
      // message) and a reference whose file was never uploaded produces none.
      // Counting the raw array tells every client to fetch attachments that are
      // not there, which renders as a list that never resolves.
      const { rows: attachments, unresolved } = toImportedAttachments(
        message,
        resolveAsset,
      );
      attachmentsSkipped += unresolved.length;
      for (const path of unresolved) {
        warnings.push(
          `"${path}" wasn't in the upload, so it was not imported. The message it belongs to was.`,
        );
      }

      const row = toImportedMessage({
        message,
        channelId: targetChannelId,
        importId,
        resolveAssetPath,
        resolveReplyTarget: (externalId) => existing.get(externalId) ?? null,
        attachmentCount: attachments.length,
        mentionContext,
      });
      if (!row) {
        warnings.push(
          `A message with no id or time in the export was skipped.`,
        );
        continue;
      }
      rows.push(row);
      attachmentsByExternalId.set(row.external_message_id, attachments);
    }

    const inserted = await this.intoTarget(args, () =>
      this.importRepo.insertMessages(rows),
    );

    // Second pass for replies within this batch. The existence read above ran
    // before the insert, so a reply whose target is in the same batch could not
    // resolve then — and in a real export a reply usually sits a few messages
    // after the thing it answers, which is the same batch far more often than
    // not.
    const known = new Map([...existing, ...inserted]);
    const replyPairs: { id: string; reply_to_id: string }[] = [];
    for (const row of rows) {
      if (row.reply_to_id) continue;
      const targetExternalId = row.payload.reply_to_external_id;
      if (!targetExternalId) continue;
      const target = known.get(targetExternalId);
      const self = inserted.get(row.external_message_id);
      if (target && self) replyPairs.push({ id: self, reply_to_id: target });
    }
    if (replyPairs.length > 0) {
      await this.importRepo.setReplyTargets(replyPairs);
    }

    let attachmentsImported = 0;
    const attachmentRows: Parameters<
      IDiscordImportRepository['insertAttachments']
    >[0] = [];
    for (const [externalId, messageId] of inserted) {
      for (const attachment of attachmentsByExternalId.get(externalId) ?? []) {
        attachmentRows.push({
          ...attachment,
          message_id: messageId,
          channel_id: targetChannelId,
        });
      }
    }
    if (attachmentRows.length > 0) {
      attachmentsImported = await this.intoTarget(args, () =>
        this.importRepo.insertAttachments(attachmentRows),
      );
    }

    return {
      imported: inserted.size,
      skipped: batch.length - rows.length,
      attachmentsImported,
      attachmentsSkipped,
      warnings,
    };
  }

  /**
   * A write into the target channel, with a failure that names the reason
   * when the channel was deleted mid-batch (#2922).
   *
   * The channel is resolved once per part or page, and an officer may delete
   * it any time after that. The foreign key then refuses the insert, so
   * nothing lands in a missing channel, but the raw `23503` would be the
   * import's only explanation. Re-read to tell that apart from a violation
   * with another cause, which is rethrown as it is, as it also is when the
   * re-read itself fails: the violation is the error worth keeping.
   */
  private async intoTarget<T>(
    args: { targetChannelId: string; chapterId: string; channelName: string },
    write: () => Promise<T>,
  ): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (!isForeignKeyViolation(error)) throw error;
      const gone = await this.channelRepo
        .findById(args.targetChannelId, args.chapterId)
        .then(
          (channel) => channel === null,
          () => false,
        );
      if (gone) throw targetDeleted({ discord_channel_name: args.channelName });
      throw error;
    }
  }

  /**
   * The Frapp channel this Discord channel imports into.
   *
   * Creates one only when the admin asked for a new channel, and records the id
   * back onto the mapping row immediately — so a re-run reuses that channel
   * instead of minting a second one with the same name. `chat_channels` has no
   * unique constraint on `(chapter_id, name)`, so nothing else would catch it.
   *
   * Like-named rows share one (#2856): a row whose `newChannelMergeKey`
   * matches a row of this import that already has its channel reuses that
   * channel instead of creating a second of the same name. `siblings` is the
   * import's rows as this slice loaded them, which carries the targets
   * written back by earlier slices and, through the write-back below, by
   * this one.
   */
  private async resolveTargetChannel(
    mapping: DiscordImportChannel,
    chapterId: string,
    importId: string,
    siblings: readonly DiscordImportChannel[],
  ): Promise<string> {
    if (mapping.target_channel_id) {
      // Re-verified here, not trusted from the row. The service validates the
      // target when the admin picks it, but that was a different request: the
      // channel can be deleted and its id reused, or a future writer could
      // reach `replaceChannels` without the check. `chat_messages` has no
      // `chapter_id` of its own, so a channel from another chapter is a valid
      // foreign key and nothing downstream would notice — and the purge scopes
      // its delete by this import's chapter, so anything written elsewhere
      // could never be removed. Two cheap reads beat one unrecoverable import.
      const target = await this.channelRepo.findById(
        mapping.target_channel_id,
        chapterId,
      );
      if (!target) {
        // Usually deleted since this slice read the row: an officer may
        // delete any channel, one an import writes into included (#2922).
        throw targetDeleted(
          mapping,
          "was deleted, or isn't one of this chapter's channels",
        );
      }
      // Checked here too, for a mapping saved before the service refused it.
      if (target.type === 'DM' || target.type === 'GROUP_DM') {
        throw new DiscordImportStoppedError(
          `Channel mapping for #${mapping.discord_channel_name} points at a direct message. Map the channels again, then restart the import.`,
        );
      }
      // And the audit log, where only Frapp posts (#3909).
      if (target.is_audit_log) {
        throw new DiscordImportStoppedError(
          `Channel mapping for #${mapping.discord_channel_name} points at the audit log. Map the channels again, then restart the import.`,
        );
      }
      // A new-channel row's target is the channel this import made for it,
      // so it must still have the readers the row asks for. It may not: an
      // upload mapped before #2856 kept whatever target the client sent, and
      // a channel can be re-gated while the import runs. Stopping says so,
      // where carrying on could widen who reads the messages.
      if (
        mapping.mapping_action === 'create_new' &&
        !channelServesMergeKey(target, mapping)
      ) {
        throw new DiscordImportStoppedError(
          `The channel recorded for #${mapping.discord_channel_name} no longer has the readers its mapping asks for. Map the channels again, then restart the import.`,
        );
      }
      return mapping.target_channel_id;
    }
    // A merge with no target is one whose channel was deleted after it was
    // mapped: `target_channel_id` is `on delete set null`, so the row keeps
    // its record, and the mapping routes and `start` refuse a merge that
    // names none (#2922). Its history has nowhere the admin chose, so the
    // import stops and says why rather than guessing a channel.
    if (mapping.mapping_action === 'use_existing') {
      throw targetDeleted(mapping);
    }
    if (mapping.mapping_action !== 'create_new' || !mapping.new_channel_name) {
      throw new DiscordImportStoppedError(
        `Channel mapping for #${mapping.discord_channel_name} has no target.`,
      );
    }

    const key = newChannelMergeKey(mapping);
    // Every channel a like-named row already has, first found first. A gone
    // one is passed over for the next, so a group whose first channel was
    // deleted still lands in one replacement rather than one each.
    const candidates = key
      ? [
          ...new Set(
            siblings.flatMap((other) =>
              other.id !== mapping.id &&
              other.target_channel_id !== null &&
              newChannelMergeKey(other) === key
                ? [other.target_channel_id]
                : [],
            ),
          ),
        ]
      : [];
    for (const candidate of candidates) {
      // Read back through the chapter like any target, and reused only while
      // the channel itself still has this row's readers: the row that points
      // at it may carry a target it did not create (an upload mapped before
      // #2856), or the channel may have been re-gated since.
      const target = await this.channelRepo.findById(candidate, chapterId);
      if (target && channelServesMergeKey(target, mapping)) {
        await this.importRepo.updateChannel(mapping.id, importId, {
          target_channel_id: target.id,
        });
        mapping.target_channel_id = target.id;
        return target.id;
      }
    }

    // The group `start` resolved, read back through the chapter: an officer
    // may delete it while the import runs, and a channel then lands with no
    // group. A delete between this read and the insert meets the foreign key,
    // so the insert is tried again with no group rather than failing.
    const categoryId = mapping.new_channel_category_id
      ? ((
          await this.categoryRepo.findById(
            mapping.new_channel_category_id,
            chapterId,
          )
        )?.id ?? null)
      : null;
    const name = mapping.new_channel_name;
    const create = (category_id: string | null) =>
      this.channelRepo.create({
        chapter_id: chapterId,
        name,
        description: `Imported from Discord #${mapping.discord_channel_name}`,
        // The admin's choice, recorded on the mapping. On the bot path a
        // channel that was private in Discord, held a private thread, or whose
        // privacy the scan could not read reaches here as PUBLIC only by an
        // explicit choice (the mapping route refuses the default); an upload
        // has no privacy to go on. ROLE_GATED always carries at least one
        // permission (DB CHECK).
        type: mapping.new_channel_type,
        required_permissions:
          mapping.new_channel_type === 'ROLE_GATED'
            ? mapping.new_channel_required_permissions
            : null,
        member_ids: null,
        category_id,
        is_read_only: mapping.new_channel_is_read_only,
      });
    let created: Awaited<ReturnType<typeof create>>;
    try {
      created = await create(categoryId);
    } catch (error) {
      if (categoryId === null || !isForeignKeyViolation(error)) throw error;
      created = await create(null);
    }
    // Recorded before the mapping row learns its target: remapping a failed
    // import rewrites the mapping rows without targets, and this is how the
    // purge still finds a channel the import made (#2905).
    await this.importRepo.recordCreatedChannel(importId, created.id);
    // The audit log is flagged only while a chapter is seeded
    // (`chat_channels_flag_audit_log`), so a channel made here should never
    // be it. If it is, stop before any history lands in it
    // (#3909); recorded first, so the purge can still find it.
    if (created.is_audit_log) {
      throw new DiscordImportStoppedError(
        `The new channel for #${mapping.discord_channel_name} became the chapter's audit log. Rename it in the mapping, then restart the import.`,
      );
    }
    await this.importRepo.updateChannel(mapping.id, importId, {
      target_channel_id: created.id,
    });
    // Write it back onto the in-memory row too, not just the database.
    // `channelBySnowflake` hands the SAME object back for every part of a
    // channel, and a channel split by `--partition` is several parts — so
    // reading only the database value would leave this `null` on the next part
    // and mint a second channel with the same name. `chat_channels` has no
    // unique `(chapter_id, name)`, so nothing downstream would catch it: the
    // chapter would end up with one identically-named channel per part, each
    // holding a slice of the history.
    mapping.target_channel_id = created.id;
    return created.id;
  }

  // ── purge ─────────────────────────────────────────────────────────────────

  private async runPurgeSlice(
    job: DiscordImport,
    lockToken: string,
    now: Date,
  ): Promise<ImportSweepResult> {
    const deadline = now.getTime() + SLICE_BUDGET_MS;

    // Rows first, objects second. An object with no row pointing at it is
    // invisible and recoverable by re-importing; a row pointing at a deleted
    // object keeps minting signed URLs for bytes that are not there.
    //
    // `purged_messages` is the admin's progress bar (#2944). It is recorded with
    // each lease renewal rather than counted on read: counting the rows left
    // would scan up to the whole import on every poll. The total starts from
    // the claimed row, so a purge resumed across slices, or re-requested after
    // one failed, keeps counting from where it stopped; only the lease holder
    // writes it, so no other writer races the read-then-add.
    let deleted = 0;
    for (;;) {
      if (Date.now() >= deadline) {
        return { claimed: true, importId: job.id, finished: false };
      }
      const round = await this.importRepo.deleteImportedMessages(
        job.id,
        job.chapter_id,
        PURGE_BATCH_SIZE,
      );
      deleted += round;
      // Only a round that deleted *nothing* proves the rows ran out (#1628).
      // `deleteImportedMessages` selects its candidates with `.limit()`, and
      // PostgREST serves `min(limit, max_rows)` — so on a project whose cap is
      // below PURGE_BATCH_SIZE, a short round is the server capping the read,
      // not the end of the data. Breaking there would leave imported messages
      // behind and then fall straight through to deleting the storage objects
      // and marking the job purged: rows pointing at bytes that are gone, on a
      // job nothing revisits. That is the failure the comment above forbids.
      if (round === 0) break;
      const held = await this.importRepo.renewLease(
        job.id,
        lockToken,
        new Date(),
        LEASE_MS,
        { purged_messages: job.purged_messages + deleted },
      );
      if (!held) return { claimed: true, importId: job.id, finished: false };
    }

    // Then the channels this import created, now that its rows are gone (#2905).
    // Left behind, each met a re-import of the same server as a name clash to
    // resolve, or as a duplicate when hidden from the admin (#2799). The
    // function keeps any channel that still holds a message of any kind, an
    // attachment, a points-ledger link, or a merge into it by an import that
    // isn't deleted (#2922), and it checks and deletes each one under the
    // channel's row lock, so a message sent meanwhile keeps its channel. It
    // also takes a channel another deleted import made that this one merged
    // into, which that import's purge had to keep.
    const channelsDeleted = await this.importRepo.deleteEmptyCreatedChannels(
      job.id,
      job.chapter_id,
    );
    // As `ChatService.deleteChannel` does: nothing can post into a deleted
    // channel, but a cached row would outlive it by up to the cache's TTL.
    for (const channelId of channelsDeleted) {
      this.channelCache.invalidate(channelId);
    }
    // Then the channel groups it created, now that its channels are gone,
    // under the same rules: a group still holding a channel, or one a live
    // import still means to fill, stays.
    await this.importRepo.deleteEmptyCreatedCategories(job.id, job.chapter_id);

    const prefix =
      job.storage_prefix ?? archiveImportPrefix(job.chapter_id, job.id);
    // An open chat report on an imported message holds the objects it
    // snapshotted (#2481), as it does against a member's own delete: deleting
    // the import must not erase the evidence either. They stay until the
    // report resolves, and its release deletes them then, since no message
    // references them any more. Read once, before any delete. A failed read
    // fails the slice like any other purge fault (the import is marked
    // `failed`, and deleting it again resumes), rather than guess "nothing".
    const held = new Set(
      (await this.reportRepo.findHeldObjects(job.chapter_id))
        .filter(({ bucket }) => bucket === CHAT_ARCHIVE_BUCKET)
        .map(({ storage_path }) => storage_path),
    );
    // `listFiles` does not recurse, so each level the layout uses is swept
    // explicitly. Deleting an already-gone key reports success, which is what
    // makes a resumed purge idempotent.
    for (const sub of ['export', 'media']) {
      const paths = (
        await this.storage.listFiles(CHAT_ARCHIVE_BUCKET, `${prefix}/${sub}`)
      ).filter((path) => !held.has(path));
      if (paths.length > 0) {
        await this.storage.deleteFiles(CHAT_ARCHIVE_BUCKET, paths);
      }
    }

    await this.importRepo.update(job.id, job.chapter_id, {
      status: 'purged',
      purged_at: new Date().toISOString(),
      error: null,
    });
    // The running total, not this slice's: a large purge spans many slices,
    // and the last one can delete nothing if the one before emptied the rows.
    this.logger.log(
      `Purged Discord import ${job.id}: ${job.purged_messages + deleted} messages, ${channelsDeleted.length} emptied channels it or another deleted import created, and its archive objects.`,
    );
    return { claimed: true, importId: job.id, finished: true };
  }
}
