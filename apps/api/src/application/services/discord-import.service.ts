import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { basename } from 'node:path';
import {
  DISCORD_IMPORT_CLEARABLE_STATUSES,
  contentTypeByExtension,
  fileExtension,
  isAllowedUploadMime,
} from '@repo/validation';
import {
  MAX_ARCHIVE_CHAPTER_BYTES,
  MAX_ARCHIVE_EXPORT_PART_BYTES,
  MAX_ARCHIVE_IMPORT_BYTES,
  isWithinArchiveUploadSizeLimit,
} from '#domain/constants/discord-archive-limits';
import { formatBytes } from '@repo/formatting';
import {
  ArchiveQuotaExceededError,
  DISCORD_IMPORT_REPOSITORY,
  type IDiscordImportRepository,
} from '#domain/repositories/discord-import.repository.interface';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
} from '#domain/adapters/storage.interface';
import {
  CHAT_ARCHIVE_BUCKET,
  archiveExportPrefix,
  archiveImportPrefix,
  archiveMediaObjectPath,
  flattenArchiveRelativePath,
} from '#domain/constants/storage';
import type {
  DiscordImport,
  DiscordImportChannel,
  DiscordImportChannelProgress,
  DiscordImportFileKind,
  DiscordImportFile,
  DiscordImportSource,
  DiscordImportStatus,
} from '#domain/entities/discord-import.entity';
import { parseRoleMapping } from '#domain/utils/discord-role-gates';
import { DiscordOAuthService } from './discord-oauth.service';
import { DiscordImportRoleMappingService } from './discord-import-role-mapping.service';
import {
  assertImportMutable,
  loadImport,
  requireBoundGuild,
} from './discord-import-guards';
import { logThrowable } from '../../infrastructure/observability/log-throwable';

/** How many files one mint request may register. */
export const MAX_UPLOAD_URL_BATCH = 100;

/**
 * The admin-facing sentence for a refused batch, shared by both import paths.
 *
 * Takes the import's `source` because the remedy is not the same on both. An
 * admin on the **bot** path never ran DiscordChatExporter, has no export folder
 * and no `--media` flag — telling them to "re-export without media" names three
 * things that do not exist in their flow and leaves them with no next step. The
 * chapter-ceiling advice ("delete an old import") is the only half that is
 * path-neutral.
 *
 * Sizes go through `formatBytes` rather than a local GB helper: the ceilings are
 * meant to be tuned (the rollback playbook names constant-tuning as the fast
 * forward-fix), and a hard-pinned GB unit renders a lowered ceiling as "0 GB".
 * `formatBytes` walks the unit ladder, so a 50 MB ceiling reads "50 MB".
 */
export function archiveQuotaMessage(
  error: ArchiveQuotaExceededError,
  source: DiscordImportSource,
): string {
  const held = formatBytes(error.wouldHoldBytes);
  const cap = formatBytes(error.capBytes);

  if (error.scope === 'chapter') {
    return `Your chapter's archive would hold ${held} of files, past its ${cap} limit. Delete an old import to free space — deletion finishes in the background, so give it a moment before retrying.`;
  }

  const remedy =
    source === 'bot'
      ? 'Import fewer channels, or delete an earlier import first.'
      : 'Re-export with a smaller date range or without --media, or split the server across separate imports.';
  return `This import would hold ${held} of files, past the ${cap} limit for one import. ${remedy}`;
}

/** Signed upload URLs are short-lived by default in Supabase Storage. */
export interface UploadTicket {
  relative_path: string;
  storage_path: string;
  upload_url: string;
  /**
   * The content type the API resolved and validated, which the browser MUST
   * send on the PUT.
   *
   * Without this the two sides judge different values: the API validates a type
   * derived from the file extension, while the browser sends `file.type`, which
   * is empty for exactly the formats a Discord archive is full of (`.heic`,
   * `.mkv`, `.avif`). An empty type becomes `application/octet-stream`, the
   * bucket's allowlist rejects it, and the file's manifest row keeps
   * `uploaded_at = null` forever — which `start()` refuses to import past, with
   * no way to drop the row. The import becomes permanently unstartable.
   */
  content_type: string;
}

export interface RequestUploadInput {
  kind: DiscordImportFileKind;
  relative_path: string;
  content_type: string;
  byte_size: number;
  part_index?: number;
}

/**
 * Statuses in which a bot import's progress is shown: waiting to run, running,
 * or stopped part-way. A finished one reads 100%, and a deleted or unstarted
 * one has no progress to show, so neither pays for the counts.
 */
const PROGRESS_STATUSES: ReadonlySet<DiscordImportStatus> = new Set([
  'ready',
  'running',
  'failed',
  'cancelled',
]);

/**
 * An import as list and detail hand it to the controller: the whole row, plus
 * a bot import's progress in channel rows. Null for an upload, whose message
 * counts are its progress, and for a bot import with no progress to show (see
 * `PROGRESS_STATUSES`).
 *
 * Never a response body. The row carries the worker's lease, resume cursor and
 * storage layout, so every route returns it through `toDiscordImportView`
 * (`discord-import-view.ts`, #2860), and so must a new one.
 */
export type DiscordImportWithProgress = DiscordImport & {
  channels_total: number | null;
  channels_done: number | null;
};

/**
 * Admin-facing half of the Discord archive importer.
 *
 * Creates the job, mints per-file signed upload URLs, and hands the job to the
 * worker. The worker (`DiscordImportWorkerService`) owns everything after
 * `start`. The channel step lives in `DiscordImportChannelMappingService` and
 * the role step in `DiscordImportRoleMappingService` (#3271); `start` calls
 * the latter to create the mapped roles once its own checks pass.
 *
 * The upload path involves no Discord credential: the admin runs
 * DiscordChatExporter themselves and uploads the result. A bot import is bound
 * to the guild `DiscordOAuthService` resolves for the chapter, never to one
 * the caller names.
 */
@Injectable()
export class DiscordImportService {
  private readonly logger = new Logger(DiscordImportService.name);

  constructor(
    @Inject(DISCORD_IMPORT_REPOSITORY)
    private readonly importRepo: IDiscordImportRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: IStorageProvider,
    private readonly oauthService: DiscordOAuthService,
    private readonly roleMapping: DiscordImportRoleMappingService,
  ) {}

  async create(
    chapterId: string,
    userId: string,
    input: {
      consent_acknowledged: boolean;
      guild_name?: string | null;
      source?: DiscordImportSource;
    },
  ): Promise<DiscordImport> {
    // The compliance gate. Deliberately a friction point rather than a
    // technical control — but one that lives in the database, not the wizard:
    // `consent_acknowledged_at` is NOT NULL, so no import can exist anywhere in
    // the system that was not preceded by the admin confirming they posted an
    // in-channel notice to their Discord server.
    if (!input.consent_acknowledged) {
      throw new BadRequestException(
        'Confirm you have posted the archive notice in your Discord server before importing.',
      );
    }

    const source = input.source ?? 'upload';

    // A bot import is bound to the chapter's connected guild AT CREATION, and
    // the id is read through `requireGuildId` — which resolves it by
    // `chapter_id`, not from anything the caller sent. The worker re-reads the
    // connection on every slice and refuses if the two have diverged, so this
    // copy is a record of what was consented to rather than an authority.
    const guildId =
      source === 'bot'
        ? await this.oauthService.requireGuildId(chapterId)
        : null;

    const created = await this.importRepo.create({
      chapter_id: chapterId,
      created_by: userId,
      consent_acknowledged_at: new Date().toISOString(),
      guild_name: input.guild_name ?? null,
      guild_id: guildId,
      source,
    });

    // The prefix depends on the id, so it is stamped in a second write rather
    // than reconstructed by every reader.
    return this.importRepo.update(created.id, chapterId, {
      storage_prefix: archiveImportPrefix(chapterId, created.id),
    });
  }

  async list(chapterId: string): Promise<DiscordImportWithProgress[]> {
    const imports = await this.importRepo.findByChapter(chapterId);
    return Promise.all(imports.map((job) => this.withProgress(job)));
  }

  async get(id: string, chapterId: string): Promise<DiscordImportWithProgress> {
    return this.withProgress(await loadImport(this.importRepo, id, chapterId));
  }

  /**
   * A bot import's progress, counted in channels and threads.
   *
   * Its message total cannot be known up front, because Discord is read as
   * the import goes: the worker adds to `total_messages` as it reads, so
   * `imported_messages / total_messages` is always 1 and read as 100% from the
   * first slice (#2816). Rows are known from the scan, so they are the honest
   * measure. An upload's messages stay its measure.
   *
   * A count that fails leaves the progress unknown rather than failing the
   * read: the list is where the admin stops or deletes an import, so it has
   * to load even when a count doesn't.
   */
  private async withProgress(
    job: DiscordImport,
  ): Promise<DiscordImportWithProgress> {
    const unknown = { ...job, channels_total: null, channels_done: null };
    if (job.source !== 'bot' || !PROGRESS_STATUSES.has(job.status)) {
      return unknown;
    }
    try {
      const { total, done } = await this.importRepo.countChannels(
        job.id,
        job.chapter_id,
      );
      return { ...job, channels_total: total, channels_done: done };
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        `Could not count channel progress for import ${job.id}; listing it without`,
        error,
      );
      return unknown;
    }
  }

  /**
   * Take a deleted import's record off the chapter's list (#2817). Refused for
   * any other: the list is the only place that offers Delete, so an import
   * that still holds what it brought in stays listed until it is deleted.
   */
  async clear(id: string, chapterId: string): Promise<DiscordImport> {
    await loadImport(this.importRepo, id, chapterId);
    const cleared = await this.importRepo.markCleared(
      id,
      chapterId,
      [...DISCORD_IMPORT_CLEARABLE_STATUSES],
      new Date().toISOString(),
    );
    if (!cleared) {
      throw new ConflictException(
        'Only a deleted import can be cleared. Delete it first.',
      );
    }
    return cleared;
  }

  getChannels(id: string, chapterId: string): Promise<DiscordImportChannel[]> {
    return this.importRepo.findChannels(id, chapterId);
  }

  /**
   * The Watch view's progress, channel by channel (#2857): counts, what is
   * running, what finished last, what failed. Chapter-scoped by the
   * repository, like `getChannels`, whose full list it keeps off the poll.
   */
  getProgress(
    id: string,
    chapterId: string,
  ): Promise<DiscordImportChannelProgress> {
    return this.importRepo.findChannelProgress(id, chapterId);
  }

  getFiles(id: string, chapterId: string): Promise<DiscordImportFile[]> {
    return this.importRepo.findFiles(id, chapterId);
  }

  /**
   * Register a batch of files and hand back a signed upload URL for each.
   *
   * The browser PUTs straight to storage, so no export byte passes through this
   * process — which is what makes a multi-gigabyte archive tractable on an API
   * instance sized in hundreds of megabytes.
   */
  async requestUploadUrls(
    id: string,
    chapterId: string,
    files: RequestUploadInput[],
  ): Promise<UploadTicket[]> {
    const job = await loadImport(this.importRepo, id, chapterId);
    assertImportMutable(job);

    if (files.length === 0) return [];
    if (files.length > MAX_UPLOAD_URL_BATCH) {
      throw new BadRequestException(
        `Request at most ${MAX_UPLOAD_URL_BATCH} upload URLs at a time.`,
      );
    }

    const rows = files.map((file) => this.toManifestRow(job, chapterId, file));

    // Registration enforces the archive ceilings itself, in the same
    // transaction — see the repository interface for why this is not a check
    // followed by a write. A refused batch registers nothing, so no signed URL
    // below is ever minted for a file that was not admitted.
    let created;
    try {
      created = await this.importRepo.registerFiles(chapterId, id, rows, {
        importBytes: MAX_ARCHIVE_IMPORT_BYTES,
        chapterBytes: MAX_ARCHIVE_CHAPTER_BYTES,
      });
    } catch (error) {
      if (error instanceof ArchiveQuotaExceededError) {
        throw new BadRequestException(archiveQuotaMessage(error, job.source));
      }
      throw error;
    }

    // Signed with `upsert`, because re-requesting a URL for a file the admin
    // already registered is the normal resume path after an interrupted
    // upload — and without it storage answers 409 Duplicate and strands them
    // partway through an archive.
    return Promise.all(
      created.map(async (row) => ({
        relative_path: row.relative_path,
        storage_path: row.storage_path,
        content_type: row.content_type ?? 'application/octet-stream',
        upload_url: await this.storage.getSignedUploadUrl(
          row.bucket,
          row.storage_path,
          row.content_type ?? 'application/octet-stream',
          { upsert: true },
        ),
      })),
    );
  }

  async confirmUploads(
    id: string,
    chapterId: string,
    storagePaths: string[],
  ): Promise<{ confirmed: number }> {
    const job = await loadImport(this.importRepo, id, chapterId);
    assertImportMutable(job);
    const confirmed = await this.importRepo.markFilesUploaded(
      id,
      chapterId,
      storagePaths,
      new Date().toISOString(),
    );
    return { confirmed };
  }

  async start(
    id: string,
    chapterId: string,
    userId: string,
    canManageRoles: boolean,
    options: { messagesAfter?: string | null } = {},
  ): Promise<DiscordImport> {
    const job = await loadImport(this.importRepo, id, chapterId);
    assertImportMutable(job);
    // Checked before anything below creates a role.
    const cutoff = this.resolveCutoff(job, options.messagesAfter);

    // A bot import has nothing uploaded — it fetches. What it needs instead is
    // a live connection, re-resolved here rather than trusted from the job row,
    // so an import cannot be started against a server the chapter has since
    // disconnected or replaced.
    let partsTotal = 0;
    if (job.source === 'bot') {
      await requireBoundGuild(this.oauthService, job, chapterId);
    } else {
      const files = await this.importRepo.findFiles(id, chapterId);
      const parts = files.filter((file) => file.kind === 'export');
      if (parts.length === 0) {
        throw new BadRequestException(
          'Upload the exported JSON before starting the import.',
        );
      }
      const pending = files.filter((file) => file.uploaded_at === null);
      if (pending.length > 0) {
        throw new BadRequestException(
          `${pending.length} file(s) have not finished uploading yet.`,
        );
      }
      partsTotal = parts.length;
    }

    const channels = await this.importRepo.findChannels(id, chapterId);
    if (channels.length === 0) {
      throw new BadRequestException(
        'Map the exported channels before starting the import.',
      );
    }
    // Every channel skipped is a no-op import that reports success, which reads
    // as "Frapp lost my history". The upload path cannot hit this (its rows
    // only exist once the admin answered), but the bot path discovers every
    // channel as skipped by default, so clicking straight through is reachable.
    if (
      job.source === 'bot' &&
      channels.every((channel) => channel.mapping_action === 'skip')
    ) {
      throw new BadRequestException(
        'Choose at least one Discord channel to import.',
      );
    }
    // A merge whose channel was deleted after it was mapped: the row's
    // `target_channel_id` is `on delete set null`, and the database no longer
    // refuses that (#2922). The mapping routes never save a merge without a
    // target, so this is the one way one reaches here, and the worker would
    // only stop on it. Only a row the worker will still walk counts: a bot
    // import never walks a completed or skipped row again. An upload's row
    // reads completed after any of its parts, with more to come, and which
    // parts hold a channel is known only by parsing them, so each counts.
    const lostMerge = channels.find(
      (channel) =>
        channel.mapping_action === 'use_existing' &&
        channel.target_channel_id === null &&
        !(
          job.source === 'bot' &&
          (channel.status === 'completed' || channel.status === 'skipped')
        ),
    );
    if (lostMerge) {
      // A thread repeats its parent's decision, so it is named by the channel
      // the admin mapped.
      const parentId = lostMerge.parent_discord_channel_id;
      const name = `#${
        (
          (parentId &&
            channels.find(
              (channel) => channel.discord_channel_id === parentId,
            )) ||
          lostMerge
        ).discord_channel_name
      }`;
      // Picking another channel is the answer only before the import has
      // started. Once it has, a remap forgets the channels the import
      // created, so the restart makes each again, and an upload resumes past
      // the parts it already did (#2947). The worker's stop says the same.
      throw new BadRequestException(
        job.status === 'draft'
          ? `The Frapp channel chosen for ${name} was deleted. Pick another channel for it, or choose to create a new one.`
          : `The Frapp channel chosen for ${name} was deleted, so this import can't carry on. To bring ${name} in, delete this import and import again.`,
      );
    }

    const roleMapping = await this.roleMapping.provisionRoles(
      id,
      chapterId,
      userId,
      channels,
      parseRoleMapping(job.role_mapping),
      canManageRoles,
    );

    return this.importRepo.update(id, chapterId, {
      status: 'ready',
      parts_total: partsTotal,
      error: null,
      role_mapping: roleMapping,
      // Written only when it changes, so a start that leaves it alone works
      // against a database that does not have the column yet.
      ...(cutoff.changed ? { messages_after: cutoff.value } : {}),
    });
  }

  /**
   * The date cutoff a start asks for (#2858), checked.
   *
   * Left out, it keeps what the import has. It is set on the first start and
   * fixed from then on: a restart resumes channels already cut at the old
   * date, and a different date for the rest would leave one import following
   * two rules. Bot imports only: an upload already holds every message and
   * its media, so its range is set when exporting (DiscordChatExporter's
   * `--after`), where it saves the upload too.
   */
  private resolveCutoff(
    job: DiscordImport,
    requested: string | null | undefined,
  ): { changed: boolean; value: string | null } {
    // Undefined, not null, on a row read before the column's migration ran:
    // a start that asks for no cutoff must not write the column then.
    const current = job.messages_after ?? null;
    if (requested === undefined) {
      return { changed: false, value: current };
    }
    // `IsISO8601` also passes shapes `Date` cannot read, such as week dates
    // ("2025-W01"); those are the caller's mistake, not a 500.
    const parsed = requested === null ? null : new Date(requested).getTime();
    if (parsed !== null && !Number.isFinite(parsed)) {
      throw new BadRequestException(
        'Send the date cutoff as a date and time, such as 2024-06-01T00:00:00Z.',
      );
    }
    const value = parsed === null ? null : new Date(parsed).toISOString();
    const instant = (at: string | null) =>
      at === null ? null : new Date(at).getTime();
    if (instant(value) === instant(current)) {
      return { changed: false, value: current };
    }
    if (job.source !== 'bot') {
      throw new BadRequestException(
        "An upload's date range is set when exporting: add --after <date> to the DiscordChatExporter command.",
      );
    }
    if (job.status !== 'draft') {
      throw new ConflictException(
        'This import has already been started, so its date cutoff is fixed. Start a new import to use a different one.',
      );
    }
    if (parsed !== null && parsed > Date.now()) {
      throw new BadRequestException(
        'Choose a date in the past, or leave the date empty to import all history.',
      );
    }
    return { changed: true, value };
  }

  async cancel(id: string, chapterId: string): Promise<DiscordImport> {
    const job = await loadImport(this.importRepo, id, chapterId);
    if (job.status === 'purged' || job.status === 'purging') {
      throw new ConflictException('This import is being deleted.');
    }
    return this.importRepo.update(id, chapterId, { status: 'cancelled' });
  }

  /**
   * Queue the import for deletion.
   *
   * The rows and the uploaded objects go; the job row survives as the record
   * that it happened. Refuses while the worker is mid-import rather than racing
   * it — the admin cancels first, which the worker observes at its next
   * checkpoint.
   */
  async requestPurge(id: string, chapterId: string): Promise<DiscordImport> {
    const job = await loadImport(this.importRepo, id, chapterId);
    if (job.status === 'running') {
      throw new ConflictException(
        'Cancel the running import before deleting it.',
      );
    }
    if (job.status === 'purged') return job;
    return this.importRepo.update(id, chapterId, { status: 'purging' });
  }

  private toManifestRow(
    job: DiscordImport,
    chapterId: string,
    file: RequestUploadInput,
  ): Omit<DiscordImportFile, 'id' | 'created_at' | 'uploaded_at'> {
    const relativePath = file.relative_path.trim();
    if (relativePath.length === 0) {
      throw new BadRequestException('Every uploaded file needs a path.');
    }

    if (!isWithinArchiveUploadSizeLimit(file.byte_size)) {
      throw new BadRequestException(
        `"${basename(relativePath)}" is too large for the archive bucket.`,
      );
    }

    // An export partition is held in memory whole while it is parsed, so its
    // ceiling is far below the bucket's. The message names `--partition`
    // because that is the flag the admin actually turns.
    if (
      file.kind === 'export' &&
      file.byte_size > MAX_ARCHIVE_EXPORT_PART_BYTES
    ) {
      throw new BadRequestException(
        `"${basename(relativePath)}" is too large to import. Re-export with a smaller --partition (for example --partition 8mb).`,
      );
    }

    // The declared type is re-derived from the extension rather than trusted:
    // a signed upload URL cannot pin a content type (the uploader sets its own
    // on the PUT), so this is a pre-check that produces a readable error, and
    // the bucket's `allowed_mime_types` remains the enforcement point — it does
    // reject a disallowed declared type. See the header of
    // `@repo/validation`'s `upload-allowlists.ts` for the measured response and
    // for what that column does not gate.
    const contentType =
      contentTypeByExtension('archive')[fileExtension(relativePath)] ??
      file.content_type;
    if (file.kind === 'media' && !isAllowedUploadMime('archive', contentType)) {
      throw new BadRequestException(
        `"${basename(relativePath)}" is a file type the archive does not accept.`,
      );
    }

    const storagePath =
      file.kind === 'export'
        ? `${archiveExportPrefix(chapterId, job.id)}/${String(
            file.part_index ?? 0,
          ).padStart(4, '0')}-${flattenArchiveRelativePath(relativePath)}`
        : // Shared with the bot import path — see `archiveMediaObjectPath` for
          // why one derivation matters more than it looks (the purge sweeps by
          // prefix and treats empty as success).
          archiveMediaObjectPath(chapterId, job.id, relativePath);

    return {
      import_id: job.id,
      chapter_id: chapterId,
      kind: file.kind,
      part_index: file.kind === 'export' ? (file.part_index ?? 0) : null,
      relative_path: relativePath,
      bucket: CHAT_ARCHIVE_BUCKET,
      storage_path: storagePath,
      content_type: contentType,
      byte_size: file.byte_size,
    };
  }
}
