import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import {
  DISCORD_IMPORT_REPOSITORY,
  type IDiscordImportRepository,
} from '../../domain/repositories/discord-import.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';
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
} from '../../domain/entities/discord-import.entity';

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
 * Messages per insert. PostgREST caps a response at `max_rows` (1000), and this
 * stays well under it so a short page unambiguously means the rows ran out.
 */
export const IMPORT_BATCH_SIZE = 200;

/** Imported messages deleted per purge round trip. */
export const PURGE_BATCH_SIZE = 500;

/** Most recent warnings kept on the job row. */
export const MAX_WARNINGS = 50;

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
  ) {}

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
      this.logger.error('Discord import sweep failed; skipping this tick', error);
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
        return await this.runImportSlice(job, lockToken, now);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Discord import ${job.id} failed: ${message}`,
          error instanceof Error ? error.stack : undefined,
        );
        await this.importRepo.update(job.id, job.chapter_id, {
          status: 'failed',
          error: message,
        });
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
      await this.importRepo.update(job.id, chapterId, {
        status: 'running',
        parts_total: parts.length,
      });
    }

    const warnings = [...job.warnings];
    let partIndex = job.cursor_part_index;
    let messageIndex = job.cursor_message_index;
    let imported = job.imported_messages;
    let skipped = job.messages_skipped;
    let attachmentsImported = job.attachments_imported;
    let attachmentsSkipped = job.attachments_skipped;

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

        await this.importRepo.update(job.id, chapterId, {
          imported_messages: imported,
          messages_skipped: skipped,
          attachments_imported: attachmentsImported,
          attachments_skipped: attachmentsSkipped,
          cursor_part_index: partIndex,
          cursor_message_index: messageIndex,
          cursor_part_message_count: parsed.messages.length,
          warnings: warnings.slice(-MAX_WARNINGS),
        });

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
          return { claimed: true, importId: job.id, messagesImported: imported };
        }
      }

      await this.importRepo.updateChannel(mapping.id, job.id, {
        target_channel_id: targetChannelId,
        imported_count: mapping.imported_count + channelImported,
        status:
          messageIndex >= parsed.messages.length ? 'completed' : 'running',
      });

      if (messageIndex < parsed.messages.length) break;
      partIndex += 1;
      messageIndex = 0;
    }

    const finished = partIndex >= parts.length;
    await this.importRepo.update(job.id, chapterId, {
      status: finished ? 'completed' : 'running',
      cursor_part_index: partIndex,
      cursor_message_index: messageIndex,
      imported_messages: imported,
      messages_skipped: skipped,
      attachments_imported: attachmentsImported,
      attachments_skipped: attachmentsSkipped,
      warnings: warnings.slice(-MAX_WARNINGS),
      completed_at: finished ? new Date().toISOString() : null,
    });

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

    const rows = [];
    const attachmentSources = new Map<string, DiscordExportMessage>();
    for (const message of batch) {
      if (message.id && existing.has(message.id)) continue;
      const row = toImportedMessage({
        message,
        channelId: targetChannelId,
        importId,
        resolveAssetPath,
        resolveReplyTarget: (externalId) => existing.get(externalId) ?? null,
        attachmentCount: (message.attachments ?? []).length,
      });
      if (!row) {
        warnings.push(
          `Skipped a message with no id or timestamp in this export.`,
        );
        continue;
      }
      rows.push(row);
      attachmentSources.set(row.external_message_id, message);
    }

    const inserted = await this.importRepo.insertMessages(rows);

    let attachmentsImported = 0;
    let attachmentsSkipped = 0;
    const attachmentRows = [];
    for (const [externalId, messageId] of inserted) {
      const source = attachmentSources.get(externalId);
      if (!source) continue;
      const { rows: attachments, unresolved } = toImportedAttachments(
        source,
        (relativePath) => {
          const file = mediaByRelativePath.get(relativePath);
          return file
            ? {
                bucket: file.bucket,
                storage_path: file.storage_path,
                content_type: file.content_type,
              }
            : null;
        },
      );
      attachmentsSkipped += unresolved.length;
      for (const path of unresolved) {
        warnings.push(`No uploaded file for attachment: ${path}`);
      }
      attachmentRows.push(
        ...attachments.map((attachment) => ({
          ...attachment,
          message_id: messageId,
          channel_id: targetChannelId,
        })),
      );
    }
    if (attachmentRows.length > 0) {
      attachmentsImported = await this.importRepo.insertAttachments(
        attachmentRows,
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
    if (mapping.target_channel_id) return mapping.target_channel_id;
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
      if (round < PURGE_BATCH_SIZE) break;
      const held = await this.importRepo.renewLease(
        job.id,
        lockToken,
        new Date(),
        LEASE_MS,
      );
      if (!held) return { claimed: true, importId: job.id, finished: false };
    }

    const prefix = job.storage_prefix ?? archiveImportPrefix(job.chapter_id, job.id);
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
