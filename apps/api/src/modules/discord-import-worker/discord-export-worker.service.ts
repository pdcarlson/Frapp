import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DISCORD_IMPORT_REPOSITORY,
  type IDiscordImportRepository,
} from '../../domain/repositories/discord-import.repository.interface';
import {
  DISCORD_CONNECTION_REPOSITORY,
  type IDiscordConnectionRepository,
} from '../../domain/repositories/discord-connection.repository.interface';
import {
  DISCORD_BOT_GATEWAY,
  DISCORD_MESSAGE_PAGE_LIMIT,
  type IDiscordBotGateway,
} from '../../domain/adapters/discord.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '../../domain/adapters/storage.interface';
import {
  CHAT_ARCHIVE_BUCKET,
  archiveMediaObjectPath,
} from '../../domain/constants/storage';
import {
  isAllowedUploadMime,
  isWithinArchiveUploadSizeLimit,
} from '@repo/validation';
import {
  MISSING_MESSAGE_CONTENT_INTENT_ERROR,
  EMPTY_CONTENT_TALLY,
  discordAttachmentKey,
  isLikelyMissingMessageContentIntent,
  tallyMessageContent,
  toExportShapeMessage,
  type DiscordApiAttachment,
  type DiscordApiMessage,
  type MessageContentTally,
} from '../../domain/utils/discord-api-message';
import type { DiscordExportMessage } from '../../domain/utils/discord-export';
import type {
  DiscordImport,
  DiscordImportChannel,
  DiscordImportFile,
} from '../../domain/entities/discord-import.entity';

/**
 * Messages fetched per Discord round trip.
 *
 * Discord's own ceiling for `GET /channels/{id}/messages`, so this is the
 * fewest requests the walk can make. It is also the batch the importer writes,
 * which keeps it comfortably under PostgREST's 1000-row `max_rows`.
 */
export const EXPORT_PAGE_SIZE = DISCORD_MESSAGE_PAGE_LIMIT;

/**
 * Attachments streamed concurrently within one page.
 *
 * Deliberately small. This runs inside the API process next to live request
 * traffic, and each concurrent transfer is a socket plus whatever the stream
 * pipeline holds — a number chosen for throughput on a dedicated worker would
 * be taken directly out of the request path here. Four keeps a page of
 * image-heavy history moving without the import becoming the reason a member's
 * chat feels slow.
 */
export const ATTACHMENT_CONCURRENCY = 4;

export interface ExportSliceResult {
  messagesImported: number;
  finished: boolean;
  /**
   * Everything the slice accumulated, for the caller's closing write.
   *
   * Returned rather than left to the last `checkpoint`, because a slice can
   * legitimately finish having never entered a page loop — every channel
   * deleted in Discord, say, which raises a warning per channel and then
   * completes. `checkpoint` is the only writer inside the loop, so without this
   * the admin sees "Completed, 0 messages" with an empty warning list and no
   * indication anything went wrong.
   */
  totals: {
    imported: number;
    skipped: number;
    attachmentsImported: number;
    attachmentsSkipped: number;
    totalMessages: number;
    warnings: string[];
  };
}

/** Everything a slice accumulates and writes back at each checkpoint. */
interface SliceTotals {
  imported: number;
  skipped: number;
  attachmentsImported: number;
  attachmentsSkipped: number;
  totalMessages: number;
  warnings: string[];
  tally: MessageContentTally;
}

/**
 * Reads a chapter's Discord history directly, over REST, one time-boxed slice
 * per tick.
 *
 * This is the phase-3 counterpart to `DiscordImportWorkerService`'s
 * DiscordChatExporter slice, and it is deliberately only *half* an importer:
 * it fetches, it verifies, it streams attachments, and then it hands each page
 * to the phase-2 mapper and the phase-2 write path unchanged. There is exactly
 * one place in this repository that decides how a Discord message becomes a
 * `chat_messages` row, and it is not this file.
 *
 * ## Why it does not claim its own jobs
 *
 * `DiscordImportWorkerService` owns the claim, the lease and the purge for
 * every import regardless of source, and delegates here when `source` is
 * `'bot'`. Two sweepers claiming from one table would be two things racing for
 * the same lease with no reason to — the source is a property of the job, not a
 * reason for a second queue.
 *
 * ## The tenant boundary, restated
 *
 * One bot token holds read access to every connected chapter's Discord server
 * at once. That is the risk this phase introduces, and the answer is that a
 * guild id is never accepted from anywhere except `discord_connections`, read
 * by `chapter_id` — and then Discord itself is asked to confirm that every
 * channel about to be read really lives in that guild. Both checks run on
 * every slice, not once at setup: a job row can be tampered with, a chapter can
 * reconnect to a different server mid-import, and a resumed slice starts from
 * persisted state rather than from whatever proved something a slice ago.
 */
@Injectable()
export class DiscordExportWorkerService {
  private readonly logger = new Logger(DiscordExportWorkerService.name);

  constructor(
    @Inject(DISCORD_IMPORT_REPOSITORY)
    private readonly importRepo: IDiscordImportRepository,
    @Inject(DISCORD_CONNECTION_REPOSITORY)
    private readonly connectionRepo: IDiscordConnectionRepository,
    @Inject(DISCORD_BOT_GATEWAY)
    private readonly bot: IDiscordBotGateway,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: IStorageProvider,
  ) {}

  /**
   * Advance one bot-sourced import until `deadline`, then checkpoint and yield.
   *
   * `importBatch` is the phase-2 worker's own batch writer, passed in rather
   * than reimplemented: dedupe-before-insert, the two-pass reply repair and the
   * attachment-count bookkeeping are subtle, already tested, and identical for
   * both sources. Passing the function keeps that true without this service
   * reaching back into the class that calls it.
   */
  async runSlice(args: {
    job: DiscordImport;
    deadline: number;
    /** True while the job may still be advanced (not cancelled, lease held). */
    checkpoint: (patch: {
      imported: number;
      skipped: number;
      attachmentsImported: number;
      attachmentsSkipped: number;
      totalMessages: number;
      warnings: string[];
    }) => Promise<boolean>;
    resolveTargetChannel: (mapping: DiscordImportChannel) => Promise<string>;
    importBatch: (batch: {
      messages: DiscordExportMessage[];
      targetChannelId: string;
      mediaByRelativePath: Map<string, DiscordImportFile>;
    }) => Promise<{
      imported: number;
      skipped: number;
      attachmentsImported: number;
      attachmentsSkipped: number;
      warnings: string[];
    }>;
  }): Promise<ExportSliceResult> {
    const { job, deadline, checkpoint, resolveTargetChannel, importBatch } =
      args;

    // ── the tenant check, first and unconditionally ────────────────────────
    //
    // Read by chapter, never from the job row. `job.guild_id` is a convenience
    // copy taken when the import was created; treating it as the source of
    // truth would mean a job row is all it takes to point one shared bot at
    // another chapter's server.
    const connection = await this.connectionRepo.findByChapter(job.chapter_id);
    if (!connection) {
      throw new Error(
        'This chapter no longer has a Discord server connected, so the import cannot continue. Reconnect Discord and start a new import.',
      );
    }
    const guildId = connection.guild_id;

    // A job created against one server and running against another is not a
    // recoverable state — it is either tampering or a chapter that reconnected
    // mid-import, and in both cases the honest outcome is to stop rather than
    // quietly import a different server's history under the old job's consent.
    if (job.guild_id && job.guild_id !== guildId) {
      throw new Error(
        `This import was created for Discord server ${job.guild_id}, but the chapter is now connected to ${guildId}. Start a new import for the current server.`,
      );
    }

    const channels = await this.importRepo.findChannels(job.id, job.chapter_id);
    const byDiscordId = new Map(
      channels.map((channel) => [channel.discord_channel_id, channel]),
    );
    const totals: SliceTotals = {
      imported: job.imported_messages,
      skipped: job.messages_skipped,
      attachmentsImported: job.attachments_imported,
      attachmentsSkipped: job.attachments_skipped,
      totalMessages: job.total_messages,
      warnings: [...job.warnings],
      // Deliberately NOT persisted across slices. The check exists to catch a
      // misconfigured bot in the first slice, and a tally that survived
      // restarts would need a schema column to carry two integers whose only
      // job is to be thrown away once one real message is seen.
      tally: { ...EMPTY_CONTENT_TALLY },
    };

    // Media already fetched by an earlier slice. The manifest is the resume
    // record: an attachment with a row and an `uploaded_at` is not re-fetched.
    const mediaByRelativePath = new Map(
      (await this.importRepo.findFiles(job.id, job.chapter_id))
        .filter((file) => file.kind === 'media' && file.uploaded_at !== null)
        .map((file) => [file.relative_path, file]),
    );

    for (const mapping of channels) {
      if (Date.now() >= deadline) {
        return this.sliceResult(totals, false);
      }
      // `status` is the whole work queue — see the migration's note on why the
      // cursor lives on the channel rather than as an index into this list.
      if (mapping.status === 'completed' || mapping.status === 'skipped') {
        continue;
      }
      if (mapping.mapping_action === 'skip') {
        await this.importRepo.updateChannel(mapping.id, job.id, {
          status: 'skipped',
        });
        continue;
      }

      const done = await this.runChannel({
        job,
        guildId,
        mapping,
        deadline,
        totals,
        mediaByRelativePath,
        checkpoint,
        resolveTargetChannel: (channel) =>
          this.resolveDestination(channel, byDiscordId, resolveTargetChannel),
        importBatch,
      });
      if (!done) return this.sliceResult(totals, false);
    }

    // Finished means every channel reached a terminal state. Re-read rather
    // than inferred from the loop: a channel can be marked skipped inside the
    // loop, and the in-memory list is a snapshot from before that happened.
    const finalChannels = await this.importRepo.findChannels(
      job.id,
      job.chapter_id,
    );
    const finished = finalChannels.every(
      (channel) =>
        channel.status === 'completed' || channel.status === 'skipped',
    );
    return this.sliceResult(totals, finished);
  }

  /**
   * The Signet channel a discovered row imports into.
   *
   * A thread never gets its own destination — it lands in whatever its parent
   * landed in. That is not a shortcut, it is the only correct answer: the admin
   * was asked about #general and said "create a new channel called General",
   * and every thread inside #general is part of that conversation. Resolving a
   * thread independently would run `create_new` a second time and mint a
   * SECOND channel with the same name — `chat_channels` has no unique
   * `(chapter_id, name)`, so nothing downstream would catch it and the chapter
   * would end up with one identically-named channel per thread.
   *
   * Discovery pins `position` so a parent is always walked before its threads,
   * which means the parent's `target_channel_id` is already persisted by the
   * time a thread asks for it. When it is not — a parent that was skipped, or a
   * thread whose parent is gone from the mapping — the parent is resolved on
   * demand, which is still one channel rather than two.
   */
  private async resolveDestination(
    mapping: DiscordImportChannel,
    byDiscordId: ReadonlyMap<string, DiscordImportChannel>,
    resolve: (mapping: DiscordImportChannel) => Promise<string>,
  ): Promise<string> {
    if (!mapping.parent_discord_channel_id) return resolve(mapping);

    const parent = byDiscordId.get(mapping.parent_discord_channel_id);
    if (!parent) {
      // Nothing to inherit from. Falling back to the thread's own mapping is
      // safe because it mirrors what its parent's was at discovery time.
      return resolve(mapping);
    }

    // ALWAYS through `resolve`, even when the parent row already carries a
    // `target_channel_id`. Returning that column directly is the one shape that
    // reaches `insertMessages` without a chapter-scoped read behind it, and
    // `chat_messages` has no `chapter_id` of its own — its FK accepts any
    // channel in the product, so nothing downstream would catch a foreign id.
    //
    // The case that made this reachable: a parent whose channel was deleted in
    // Discord is marked skipped and RETURNS before its own resolve ever runs,
    // so a `target_channel_id` written at mapping time was never verified —
    // and its threads then inherited it unchecked. `resolveTargetChannel`
    // re-reads the channel through the chapter and throws on a foreign one, so
    // routing every inheritance through it costs one cached read and closes
    // that path. Same class as the bug #1242's review caught.
    const targetId = await resolve(parent);
    // Cache onto the in-memory parent row as well, so the next thread of the
    // same parent in this slice reads it without another round trip — and,
    // more importantly, without a second `create_new`.
    parent.target_channel_id = targetId;
    return targetId;
  }

  private sliceResult(
    totals: SliceTotals,
    finished: boolean,
  ): ExportSliceResult {
    return {
      messagesImported: totals.imported,
      finished,
      totals: {
        imported: totals.imported,
        skipped: totals.skipped,
        attachmentsImported: totals.attachmentsImported,
        attachmentsSkipped: totals.attachmentsSkipped,
        totalMessages: totals.totalMessages,
        warnings: totals.warnings,
      },
    };
  }

  /**
   * Walk one channel backwards until it runs out or the slice budget does.
   *
   * Returns false when the slice must yield (budget spent, lease lost, or the
   * admin cancelled), true when this channel is finished with.
   */
  private async runChannel(args: {
    job: DiscordImport;
    guildId: string;
    mapping: DiscordImportChannel;
    deadline: number;
    totals: SliceTotals;
    mediaByRelativePath: Map<string, DiscordImportFile>;
    checkpoint: (patch: {
      imported: number;
      skipped: number;
      attachmentsImported: number;
      attachmentsSkipped: number;
      totalMessages: number;
      warnings: string[];
    }) => Promise<boolean>;
    resolveTargetChannel: (mapping: DiscordImportChannel) => Promise<string>;
    importBatch: (batch: {
      messages: DiscordExportMessage[];
      targetChannelId: string;
      mediaByRelativePath: Map<string, DiscordImportFile>;
    }) => Promise<{
      imported: number;
      skipped: number;
      attachmentsImported: number;
      attachmentsSkipped: number;
      warnings: string[];
    }>;
  }): Promise<boolean> {
    const {
      job,
      guildId,
      mapping,
      deadline,
      totals,
      mediaByRelativePath,
      checkpoint,
      resolveTargetChannel,
      importBatch,
    } = args;

    // Re-derived from Discord's answer on every slice, never from the row.
    // Throws when the channel exists in a DIFFERENT guild — that case is not a
    // skip, it is the shared bot being aimed at another tenant, and it takes
    // the whole import down loudly.
    const verified = await this.bot.verifyChannelInGuild(
      mapping.discord_channel_id,
      guildId,
    );
    if (!verified) {
      totals.warnings.push(
        `#${mapping.discord_channel_name} is no longer readable in Discord (deleted, or the bot lost access). It was skipped.`,
      );
      await this.importRepo.updateChannel(mapping.id, job.id, {
        status: 'skipped',
        error: 'Channel not readable in Discord.',
      });
      return true;
    }

    const targetChannelId = await resolveTargetChannel(mapping);

    // A forum holds no messages of its own — every post in it is a thread, and
    // `GET /channels/{id}/messages` answers 400 on the forum itself. Its target
    // is still resolved above, because that is what its posts inherit; only the
    // message walk is skipped.
    if (verified.holdsOnlyThreads) {
      if (mapping.target_channel_id !== targetChannelId) {
        mapping.target_channel_id = targetChannelId;
      }
      await this.importRepo.updateChannel(mapping.id, job.id, {
        target_channel_id: targetChannelId,
        status: 'completed',
      });
      return true;
    }
    // Recorded immediately, before a single message is read, and both in the
    // database and on the in-memory row.
    //
    // Not an optimisation. `create_new` MINTS a channel, and the only thing
    // stopping it minting a second one is this id being found next time it is
    // asked. "Next time" is a resumed slice, a second page, or — the case that
    // caught this — a thread inheriting its parent's destination. Writing it
    // only inside the page loop meant an empty channel resolved a target and
    // never recorded it, so the next asker created another channel with the
    // same name, which `chat_channels` has no unique constraint to reject.
    if (mapping.target_channel_id !== targetChannelId) {
      mapping.target_channel_id = targetChannelId;
      await this.importRepo.updateChannel(mapping.id, job.id, {
        target_channel_id: targetChannelId,
      });
    }

    let before = mapping.cursor_before_snowflake;
    let channelImported = mapping.imported_count;

    for (;;) {
      if (Date.now() >= deadline) return false;

      const rawPage = (await this.bot.fetchMessagePage({
        channelId: mapping.discord_channel_id,
        guildId,
        before,
        limit: EXPORT_PAGE_SIZE,
      })) as DiscordApiMessage[];

      // Fail loudly on a bot that can see messages but not their contents.
      // Checked before anything is written, so an import that trips this has
      // added no empty rows to correct afterwards.
      totals.tally = tallyMessageContent(totals.tally, rawPage);
      if (isLikelyMissingMessageContentIntent(totals.tally)) {
        throw new Error(MISSING_MESSAGE_CONTENT_INTENT_ERROR);
      }

      if (rawPage.length === 0) {
        await this.finishChannel(job, mapping, channelImported);
        return true;
      }

      totals.totalMessages += rawPage.length;

      // Attachments first: `attachment_count` on the message row has to be the
      // number of attachment rows that will actually exist, and that is only
      // knowable once the bytes have landed. Same ordering, same reason, as the
      // upload path's batch.
      const fetched = await this.streamPageAttachments({
        job,
        page: rawPage,
        mediaByRelativePath,
        totals,
      });
      // `fetched.skipped` is deliberately NOT added to the running total.
      //
      // Anything this rejected — too large, a type the bucket refuses, gone
      // from the CDN — is simply absent from `mediaByRelativePath`, so
      // `importBatch` independently counts it as unresolved and reports it in
      // `outcome.attachmentsSkipped` below. Adding both double-counts every
      // skipped attachment.

      const outcome = await importBatch({
        messages: rawPage.map((message) => toExportShapeMessage(message)),
        targetChannelId,
        mediaByRelativePath,
      });

      totals.imported += outcome.imported;
      channelImported += outcome.imported;
      totals.skipped += outcome.skipped;
      totals.attachmentsImported += outcome.attachmentsImported;
      totals.attachmentsSkipped += outcome.attachmentsSkipped;
      // The batch writer emits a bare "No uploaded file for attachment: <key>"
      // for every key it cannot resolve — including the ones this slice
      // deliberately rejected a moment ago and already explained by name and
      // reason. Both lines compete for a 50-entry buffer that keeps the tail,
      // so leaving the generic duplicates in is what pushes the readable ones
      // out. Dropped here, where the set of already-explained keys is in hand.
      totals.warnings.push(
        ...outcome.warnings.filter(
          (warning) => !fetched.reported.some((key) => warning.includes(key)),
        ),
      );

      // The cursor is the OLDEST id on the page, because the walk runs
      // backwards. Discord returns newest-first, so that is the last entry —
      // and it must be written from the RAW page, not from the mapped rows: a
      // message the mapper dropped (no id, no timestamp) would otherwise be
      // re-fetched forever as the page's tail.
      const oldest = rawPage[rawPage.length - 1]?.id;
      if (typeof oldest === 'string' && oldest.length > 0) {
        before = oldest;
      }

      await this.importRepo.updateChannel(mapping.id, job.id, {
        target_channel_id: targetChannelId,
        cursor_before_snowflake: before,
        imported_count: channelImported,
        status: 'running',
      });

      const mayContinue = await checkpoint({
        imported: totals.imported,
        skipped: totals.skipped,
        attachmentsImported: totals.attachmentsImported,
        attachmentsSkipped: totals.attachmentsSkipped,
        totalMessages: totals.totalMessages,
        warnings: totals.warnings,
      });
      if (!mayContinue) return false;

      // A short page is Discord's only honest end-of-channel signal.
      if (rawPage.length < EXPORT_PAGE_SIZE) {
        await this.finishChannel(job, mapping, channelImported);
        return true;
      }
    }
  }

  private async finishChannel(
    job: DiscordImport,
    mapping: DiscordImportChannel,
    importedCount: number,
  ): Promise<void> {
    await this.importRepo.updateChannel(mapping.id, job.id, {
      status: 'completed',
      imported_count: importedCount,
    });
  }

  /**
   * Stream every not-yet-stored attachment on this page into the archive
   * bucket, and register each in the manifest.
   *
   * The manifest rows are written **before** the transfers and marked uploaded
   * **after**, which is what makes an interrupted slice resumable in the right
   * direction: a row with a null `uploaded_at` is a transfer that did not
   * finish, and the next slice re-sends it. The opposite order would record
   * success for bytes that never landed and leave a message pointing at an
   * object that is not there.
   */
  private async streamPageAttachments(args: {
    job: DiscordImport;
    page: DiscordApiMessage[];
    mediaByRelativePath: Map<string, DiscordImportFile>;
    totals: SliceTotals;
  }): Promise<{ skipped: number; reported: string[] }> {
    const { job, page, mediaByRelativePath, totals } = args;
    /** Keys this slice already warned about, by name and reason. */
    const reported: string[] = [];

    // Deduplicated within the page as well as against the manifest: one message
    // can carry the same attachment twice, and the same attachment id can
    // legitimately appear on a forwarded message later in the page.
    const pending = new Map<string, DiscordApiAttachment>();
    let skipped = 0;

    for (const message of page) {
      for (const attachment of message.attachments ?? []) {
        const key = discordAttachmentKey(attachment);
        if (!key || mediaByRelativePath.has(key) || pending.has(key)) continue;

        const size = attachment.size;
        if (typeof size === 'number' && !isWithinArchiveUploadSizeLimit(size)) {
          totals.warnings.push(
            `"${attachment.filename ?? key}" is larger than the archive accepts and was not imported. The message it belongs to was.`,
          );
          reported.push(key);
          skipped += 1;
          continue;
        }

        // The bucket's `allowed_mime_types` is the enforcement point and would
        // reject the upload; checking here turns that into a readable warning
        // and saves the transfer. Discord serves plenty a chapter's archive
        // contains and this bucket does not accept (`.exe`, `.dll`; note
        // `.zip` IS on the archive allowlist, so it is not an example).
        // Parameters stripped and lower-cased before the allowlist check.
        // `isAllowedUploadMime` is an exact `Set.has`, and Discord reports a
        // parameterised type for exactly the attachment a chapter's archive is
        // full of: a message over 2000 characters is auto-converted to
        // `message.txt` with `content_type: "text/plain; charset=utf-8"`.
        // `text/plain` is allowlisted; the parameterised spelling is not, so
        // without this every one of those is dropped with a warning that
        // contradicts itself.
        const contentType = normaliseMimeType(attachment.content_type);
        if (contentType && !isAllowedUploadMime('archive', contentType)) {
          totals.warnings.push(
            `"${attachment.filename ?? key}" is a file type the archive does not accept (${contentType}) and was not imported. The message it belongs to was.`,
          );
          reported.push(key);
          skipped += 1;
          continue;
        }

        pending.set(key, attachment);
      }
    }

    if (pending.size === 0) return { skipped, reported };

    const entries = [...pending.entries()];
    const rows = entries.map(([key, attachment]) => ({
      import_id: job.id,
      chapter_id: job.chapter_id,
      kind: 'media' as const,
      part_index: null,
      relative_path: key,
      bucket: CHAT_ARCHIVE_BUCKET,
      // Shared with the upload path, so the purge's prefix sweep finds both.
      storage_path: archiveMediaObjectPath(job.chapter_id, job.id, key),
      content_type:
        normaliseMimeType(attachment.content_type) ??
        'application/octet-stream',
      byte_size: typeof attachment.size === 'number' ? attachment.size : null,
    }));

    const created = await this.importRepo.createFiles(rows);
    const createdByPath = new Map(
      created.map((file) => [file.relative_path, file]),
    );

    const landed: string[] = [];
    await this.forEachLimited(
      entries,
      ATTACHMENT_CONCURRENCY,
      async ([key, attachment]) => {
        const file = createdByPath.get(key);
        if (!file) return;
        const url = attachment.url ?? attachment.proxy_url;
        if (!url) {
          skipped += 1;
          return;
        }

        try {
          const stream = await this.bot.openAttachment(url);
          if (!stream) {
            // A deleted or expired attachment is a warning on one message, not a
            // failed import — the message still has its text.
            totals.warnings.push(
              `Attachment "${attachment.filename ?? key}" is no longer available from Discord and was not imported.`,
            );
            skipped += 1;
            return;
          }

          // Piped, never buffered: the bytes go CDN socket → storage socket, and
          // at no point is the whole object in this process's heap.
          await this.storage.uploadFile(
            file.bucket,
            file.storage_path,
            stream.body,
            stream.contentType ??
              file.content_type ??
              'application/octet-stream',
            { contentLength: stream.contentLength },
          );
          landed.push(file.storage_path);
        } catch (error) {
          totals.warnings.push(
            `Could not import attachment "${attachment.filename ?? key}": ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          skipped += 1;
        }
      },
    );

    if (landed.length > 0) {
      await this.importRepo.markFilesUploaded(
        job.id,
        job.chapter_id,
        landed,
        new Date().toISOString(),
      );
      // Feed the in-memory resolver too, not just the database. The batch that
      // is about to run resolves attachments through THIS map, so a file that
      // landed a moment ago but is missing here produces a message row with
      // `attachment_count: 0` — a bubble that renders as if it never had one.
      for (const path of landed) {
        const file = created.find((entry) => entry.storage_path === path);
        if (file) {
          mediaByRelativePath.set(file.relative_path, {
            ...file,
            uploaded_at: new Date().toISOString(),
          });
        }
      }
    }

    return { skipped, reported };
  }

  /**
   * Run `worker` over `items` with at most `limit` in flight.
   *
   * Hand-rolled rather than pulled in, because the alternative — `Promise.all`
   * over the whole page — is 100 concurrent CDN transfers inside a process
   * that is also serving members' requests.
   */
  private async forEachLimited<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    let cursor = 0;
    const runners = Array.from(
      { length: Math.min(limit, items.length) },
      async () => {
        for (;;) {
          const index = cursor;
          cursor += 1;
          if (index >= items.length) return;
          await worker(items[index]);
        }
      },
    );
    await Promise.all(runners);
  }
}

/**
 * A Content-Type reduced to the bare type the allowlist is keyed on.
 *
 * `isAllowedUploadMime` is an exact `Set.has`, so `text/plain; charset=utf-8`
 * misses an allowlist that contains `text/plain`. The upload path never hits
 * this because it derives the type from the file extension; the bot path takes
 * Discord's own header, which routinely carries a charset.
 */
function normaliseMimeType(value: string | null | undefined): string | null {
  const bare = value?.split(';')[0]?.trim().toLowerCase();
  return bare && bare.length > 0 ? bare : null;
}
