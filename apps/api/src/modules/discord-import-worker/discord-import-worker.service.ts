import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import {
  DISCORD_IMPORT_REPOSITORY,
  type IDiscordImportRepository,
} from '../../domain/repositories/discord-import.repository.interface';
import {
  DISCORD_CONNECTION_REPOSITORY,
  type IDiscordConnectionRepository,
} from '../../domain/repositories/discord-connection.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';
import { MAX_ARCHIVE_EXPORT_PART_BYTES } from '@repo/validation';
import {
  CHAT_ARCHIVE_BUCKET,
  archiveImportPrefix,
} from '../../domain/constants/storage';
import {
  CHAT_CHANNEL_REPOSITORY,
  type IChatChannelRepository,
} from '../../domain/repositories/chat.repository.interface';
import {
  DiscordExportFormatError,
  parseExportPart,
  toImportedAttachments,
  toImportedMessage,
  type DiscordExportMessage,
} from '../../domain/utils/discord-export';
import type {
  DiscordImport,
  DiscordImportChannel,
  DiscordImportFile,
  DiscordImportStatus,
} from '../../domain/entities/discord-import.entity';
import { DiscordExportWorkerService } from './discord-export-worker.service';

/**
 * How long one tick may work before checkpointing and handing the job back.
 *
 * Comfortably inside the one-minute tick. A single long-running handler was the
 * alternative and is worse in three ways: it is invisible to the health check,
 * it loses everything on a restart, and `@nestjs/schedule` re-enters it every
 * minute regardless. Slices give restart-resume and progress reporting for free.
 */
export const SLICE_BUDGET_MS = 45_000;

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

/** Most recent warnings kept on the job row. */
export const MAX_WARNINGS = 50;

/**
 * Statuses in which a slice may keep going.
 *
 * Every write the worker makes to the job row is conditioned on one of these,
 * so an admin who cancels or deletes mid-slice actually stops it. The lease
 * cannot do this job: it arbitrates between *workers*, and a cancel is an
 * ordinary API write on the same row.
 */
const WORKER_MAY_CONTINUE: DiscordImportStatus[] = ['ready', 'running'];

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
    private readonly exportWorker: DiscordExportWorkerService,
    @Inject(DISCORD_CONNECTION_REPOSITORY)
    private readonly connectionRepo: IDiscordConnectionRepository,
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
  @Cron(CronExpression.EVERY_HOUR)
  async handleOAuthStateSweep(): Promise<void> {
    try {
      const reaped = await this.connectionRepo.deleteExpiredStates(new Date());
      if (reaped > 0) {
        this.logger.log(`Reaped ${reaped} expired Discord OAuth handshakes.`);
      }
    } catch (error) {
      // Same reasoning as the import sweep's catch: an unhandled rejection out
      // of a `@Cron` takes the API process down under Node's default
      // `--unhandled-rejections=throw`. A failed reap must cost one tick.
      this.logger.error('Discord OAuth state sweep failed', error);
    }
  }

  /**
   * The tick.
   *
   * The try/catch is not decoration: this handler reaches storage and the
   * database, and an unhandled rejection out of a `@Cron` under Node's default
   * `--unhandled-rejections=throw` takes the API process down with it. A failed
   * sweep must cost one tick, never the service.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleImportSweep(): Promise<void> {
    try {
      await this.sweepImports(new Date());
    } catch (error) {
      this.logger.error(
        'Discord import sweep failed; skipping this tick',
        error,
      );
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
      try {
        if (job.status === 'purging') {
          return await this.runPurgeSlice(job, lockToken, now);
        }
        // The purge is source-agnostic — it deletes rows and sweeps a storage
        // prefix, both of which look identical whichever way the bytes arrived.
        // Only the FETCH differs, so only the fetch branches.
        if (job.source === 'bot') {
          return await this.runBotExportSlice(job, lockToken, now);
        }
        return await this.runImportSlice(job, lockToken, now);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Discord import ${job.id} failed: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
        await this.importRepo.updateIfStatus(
          job.id,
          job.chapter_id,
          [...WORKER_MAY_CONTINUE, 'purging'],
          { status: 'failed', error: message },
        );
        return { claimed: true, importId: job.id, finished: true };
      } finally {
        await this.importRepo.releaseLease(job.id, lockToken).catch(() => {
          // A lost lease is the normal outcome of a slice that overran; the
          // next tick re-claims. Never worth failing the sweep over.
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

    const result = await this.exportWorker.runSlice({
      job,
      deadline,
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
      resolveTargetChannel: (mapping) =>
        this.resolveTargetChannel(mapping, chapterId, job.id),
      importBatch: (batch) =>
        this.importBatch({
          batch: batch.messages,
          targetChannelId: batch.targetChannelId,
          importId: job.id,
          mediaByRelativePath: batch.mediaByRelativePath,
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
    await this.importRepo.updateIfStatus(
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
      },
    );

    return {
      claimed: true,
      importId: job.id,
      messagesImported: result.messagesImported,
      finished: result.finished,
    };
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
        warnings.push(`Uploaded export part is missing: ${part.relative_path}`);
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
          `${part.relative_path} is ${Math.round(bytes.byteLength / 1024 / 1024)} MB, over the ${Math.round(MAX_ARCHIVE_EXPORT_PART_BYTES / 1024 / 1024)} MB limit for one export part — re-export with a smaller --partition. Skipped.`,
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
        warnings.push(`${part.relative_path}: ${error.message}`);
        partIndex += 1;
        messageIndex = 0;
        continue;
      }

      // The channel is keyed on the id read from THESE bytes, never on
      // whatever the client claimed when it uploaded. A wizard that lied about
      // which channel a part belonged to therefore cannot redirect a Discord
      // channel's history into a Signet channel the admin did not choose.
      const mapping = channelBySnowflake.get(parsed.channel.id ?? '');
      if (!mapping || mapping.mapping_action === 'skip') {
        if (!mapping) {
          warnings.push(
            `No mapping for #${parsed.channel.name ?? parsed.channel.id}; its messages were skipped.`,
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
          mediaByRelativePath,
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
      // `target_channel_id` is written back: the next part of this channel
      // reuses this object, and re-reading the original base would make part 1
      // overwrite part 0's contribution instead of adding to it.
      mapping.imported_count += channelImported;
      await this.importRepo.updateChannel(mapping.id, job.id, {
        target_channel_id: targetChannelId,
        imported_count: mapping.imported_count,
        status:
          messageIndex >= parsed.messages.length ? 'completed' : 'running',
      });

      if (messageIndex < parsed.messages.length) break;
      partIndex += 1;
      messageIndex = 0;
    }

    const finished = partIndex >= parts.length;
    await this.importRepo.updateIfStatus(
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
      },
    );

    return {
      claimed: true,
      importId: job.id,
      messagesImported: imported,
      finished,
    };
  }

  private async importBatch(args: {
    batch: DiscordExportMessage[];
    targetChannelId: string;
    importId: string;
    mediaByRelativePath: Map<string, DiscordImportFile>;
  }): Promise<{
    imported: number;
    skipped: number;
    attachmentsImported: number;
    attachmentsSkipped: number;
    warnings: string[];
  }> {
    const { batch, targetChannelId, importId, mediaByRelativePath } = args;
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

    const rows = [];
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
        warnings.push(`No uploaded file for attachment: ${path}`);
      }

      const row = toImportedMessage({
        message,
        channelId: targetChannelId,
        importId,
        resolveAssetPath,
        resolveReplyTarget: (externalId) => existing.get(externalId) ?? null,
        attachmentCount: attachments.length,
      });
      if (!row) {
        warnings.push(
          `Skipped a message with no id or timestamp in this export.`,
        );
        continue;
      }
      rows.push(row);
      attachmentsByExternalId.set(row.external_message_id, attachments);
    }

    const inserted = await this.importRepo.insertMessages(rows);

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
    const attachmentRows = [];
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
      attachmentsImported =
        await this.importRepo.insertAttachments(attachmentRows);
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
   * The Signet channel this Discord channel imports into.
   *
   * Creates one only when the admin asked for a new channel, and records the id
   * back onto the mapping row immediately — so a re-run reuses that channel
   * instead of minting a second one with the same name. `chat_channels` has no
   * unique constraint on `(chapter_id, name)`, so nothing else would catch it.
   */
  private async resolveTargetChannel(
    mapping: DiscordImportChannel,
    chapterId: string,
    importId: string,
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
        throw new Error(
          `Channel mapping for #${mapping.discord_channel_name} points at a channel outside this chapter.`,
        );
      }
      return mapping.target_channel_id;
    }
    if (mapping.mapping_action !== 'create_new' || !mapping.new_channel_name) {
      throw new Error(
        `Channel mapping for #${mapping.discord_channel_name} has no target.`,
      );
    }

    const created = await this.channelRepo.create({
      chapter_id: chapterId,
      name: mapping.new_channel_name,
      description: `Imported from Discord #${mapping.discord_channel_name}`,
      type: 'PUBLIC',
      required_permissions: null,
      member_ids: null,
      category_id: null,
      is_read_only: mapping.new_channel_is_read_only,
    });
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
      );
      if (!held) return { claimed: true, importId: job.id, finished: false };
    }

    const prefix =
      job.storage_prefix ?? archiveImportPrefix(job.chapter_id, job.id);
    // `listFiles` does not recurse, so each level the layout uses is swept
    // explicitly. Deleting an already-gone key reports success, which is what
    // makes a resumed purge idempotent.
    for (const sub of ['export', 'media']) {
      const paths = await this.storage.listFiles(
        CHAT_ARCHIVE_BUCKET,
        `${prefix}/${sub}`,
      );
      if (paths.length > 0) {
        await this.storage.deleteFiles(CHAT_ARCHIVE_BUCKET, paths);
      }
    }

    await this.importRepo.update(job.id, job.chapter_id, {
      status: 'purged',
      purged_at: new Date().toISOString(),
    });
    this.logger.log(
      `Purged Discord import ${job.id}: ${deleted} messages and its archive objects.`,
    );
    return { claimed: true, importId: job.id, finished: true };
  }
}
