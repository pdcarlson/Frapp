import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { basename } from 'node:path';
import {
  MAX_ARCHIVE_EXPORT_PART_BYTES,
  contentTypeByExtension,
  fileExtension,
  isAllowedUploadMime,
  isWithinArchiveUploadSizeLimit,
} from '@repo/validation';
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
  archiveExportPrefix,
  archiveImportPrefix,
  archiveMediaPrefix,
  flattenArchiveRelativePath,
} from '../../domain/constants/storage';
import type {
  DiscordImport,
  DiscordImportChannel,
  DiscordImportFile,
  DiscordImportFileKind,
  DiscordRoleMapping,
} from '../../domain/entities/discord-import.entity';

/** How many files one mint request may register. */
export const MAX_UPLOAD_URL_BATCH = 100;

/** Signed upload URLs are short-lived by default in Supabase Storage. */
export interface UploadTicket {
  relative_path: string;
  storage_path: string;
  upload_url: string;
}

export interface RequestUploadInput {
  kind: DiscordImportFileKind;
  relative_path: string;
  content_type: string;
  byte_size: number;
  part_index?: number;
}

export interface ChannelMappingInput {
  discord_channel_id: string;
  discord_channel_name: string;
  discord_category?: string | null;
  mapping_action: DiscordImportChannel['mapping_action'];
  target_channel_id?: string | null;
  new_channel_name?: string | null;
  new_channel_is_read_only?: boolean;
  message_count?: number;
}

/**
 * Admin-facing half of the Discord archive importer.
 *
 * Creates the job, mints per-file signed upload URLs, records the admin's
 * channel and role mapping, and hands the job to the worker. The worker
 * (`DiscordImportWorkerService`) owns everything after `start`.
 *
 * No Discord credential is involved anywhere in this file, by design: the admin
 * runs DiscordChatExporter themselves and uploads the result. See the migration
 * header for why storing a bot token was rejected.
 */
@Injectable()
export class DiscordImportService {
  private readonly logger = new Logger(DiscordImportService.name);

  constructor(
    @Inject(DISCORD_IMPORT_REPOSITORY)
    private readonly importRepo: IDiscordImportRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storage: IStorageProvider,
  ) {}

  async create(
    chapterId: string,
    userId: string,
    input: { consent_acknowledged: boolean; guild_name?: string | null },
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

    const created = await this.importRepo.create({
      chapter_id: chapterId,
      created_by: userId,
      consent_acknowledged_at: new Date().toISOString(),
      guild_name: input.guild_name ?? null,
    });

    // The prefix depends on the id, so it is stamped in a second write rather
    // than reconstructed by every reader.
    return this.importRepo.update(created.id, chapterId, {
      storage_prefix: archiveImportPrefix(chapterId, created.id),
    });
  }

  list(chapterId: string): Promise<DiscordImport[]> {
    return this.importRepo.findByChapter(chapterId);
  }

  async get(id: string, chapterId: string): Promise<DiscordImport> {
    const found = await this.importRepo.findById(id, chapterId);
    if (!found) throw new NotFoundException('Import not found');
    return found;
  }

  getChannels(id: string, chapterId: string): Promise<DiscordImportChannel[]> {
    return this.importRepo.findChannels(id, chapterId);
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
    const job = await this.get(id, chapterId);
    this.assertMutable(job);

    if (files.length === 0) return [];
    if (files.length > MAX_UPLOAD_URL_BATCH) {
      throw new BadRequestException(
        `Request at most ${MAX_UPLOAD_URL_BATCH} upload URLs at a time.`,
      );
    }

    const rows = files.map((file) =>
      this.toManifestRow(job, chapterId, file),
    );
    const created = await this.importRepo.createFiles(rows);

    // Signed with `upsert`, because re-requesting a URL for a file the admin
    // already registered is the normal resume path after an interrupted
    // upload — and without it storage answers 409 Duplicate and strands them
    // partway through an archive.
    return Promise.all(
      created.map(async (row) => ({
        relative_path: row.relative_path,
        storage_path: row.storage_path,
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
    const job = await this.get(id, chapterId);
    this.assertMutable(job);
    const confirmed = await this.importRepo.markFilesUploaded(
      id,
      chapterId,
      storagePaths,
      new Date().toISOString(),
    );
    return { confirmed };
  }

  async setChannelMapping(
    id: string,
    chapterId: string,
    channels: ChannelMappingInput[],
  ): Promise<DiscordImportChannel[]> {
    const job = await this.get(id, chapterId);
    this.assertMutable(job);

    for (const channel of channels) {
      // Mirrors the DB CHECK, so the admin gets a sentence instead of a
      // constraint name — and so the worker never meets an action it cannot
      // resolve thousands of rows into an import.
      if (
        channel.mapping_action === 'use_existing' &&
        !channel.target_channel_id
      ) {
        throw new BadRequestException(
          `Pick a Signet channel for #${channel.discord_channel_name}, or choose to create a new one.`,
        );
      }
      if (
        channel.mapping_action === 'create_new' &&
        !channel.new_channel_name?.trim()
      ) {
        throw new BadRequestException(
          `Name the new channel for #${channel.discord_channel_name}.`,
        );
      }
    }

    return this.importRepo.replaceChannels(
      id,
      chapterId,
      channels.map((channel) => ({
        discord_channel_id: channel.discord_channel_id,
        discord_channel_name: channel.discord_channel_name,
        discord_category: channel.discord_category ?? null,
        mapping_action: channel.mapping_action,
        target_channel_id: channel.target_channel_id ?? null,
        new_channel_name: channel.new_channel_name ?? null,
        new_channel_is_read_only: channel.new_channel_is_read_only ?? true,
        message_count: channel.message_count ?? 0,
        imported_count: 0,
        status: channel.mapping_action === 'skip' ? 'skipped' : 'pending',
        error: null,
      })),
    );
  }

  /**
   * Record which Signet role each Discord role corresponds to.
   *
   * Stored and shown back to the admin; **never read to grant anything**. The
   * importer does not touch a `members` row and does not assign a role — every
   * imported author is a name on a message, not an account. This is a worksheet
   * for promoting people by hand later, which is the model Signet's onboarding
   * already uses.
   */
  async setRoleMapping(
    id: string,
    chapterId: string,
    roleMapping: DiscordRoleMapping[],
  ): Promise<DiscordImport> {
    const job = await this.get(id, chapterId);
    this.assertMutable(job);
    return this.importRepo.update(id, chapterId, { role_mapping: roleMapping });
  }

  async start(id: string, chapterId: string): Promise<DiscordImport> {
    const job = await this.get(id, chapterId);
    this.assertMutable(job);

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

    const channels = await this.importRepo.findChannels(id, chapterId);
    if (channels.length === 0) {
      throw new BadRequestException(
        'Map the exported channels before starting the import.',
      );
    }

    return this.importRepo.update(id, chapterId, {
      status: 'ready',
      parts_total: parts.length,
      error: null,
    });
  }

  async cancel(id: string, chapterId: string): Promise<DiscordImport> {
    const job = await this.get(id, chapterId);
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
    const job = await this.get(id, chapterId);
    if (job.status === 'running') {
      throw new ConflictException(
        'Cancel the running import before deleting it.',
      );
    }
    if (job.status === 'purged') return job;
    return this.importRepo.update(id, chapterId, { status: 'purging' });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** Statuses in which the admin may still change the import's inputs. */
  private assertMutable(job: DiscordImport): void {
    if (job.status !== 'draft' && job.status !== 'failed' && job.status !== 'ready') {
      throw new ConflictException(
        `This import is ${job.status} and can no longer be changed.`,
      );
    }
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
    // the bucket's `allowed_mime_types` remains the enforcement point — it
    // answers 415 for a disallowed type, verified against the local stack.
    const contentType =
      contentTypeByExtension('archive')[fileExtension(relativePath)] ??
      file.content_type;
    if (file.kind === 'media' && !isAllowedUploadMime('archive', contentType)) {
      throw new BadRequestException(
        `"${basename(relativePath)}" is a file type the archive does not accept.`,
      );
    }

    const flattened = flattenArchiveRelativePath(relativePath);
    const storagePath =
      file.kind === 'export'
        ? `${archiveExportPrefix(chapterId, job.id)}/${String(
            file.part_index ?? 0,
          ).padStart(4, '0')}-${flattened}`
        : // The file row's own uniqueness is (import_id, relative_path); two
          // different relative paths can flatten to the same segment, so the
          // flattened name alone is not a key. Prefixing with the part index or
          // a hash of the original keeps distinct sources distinct.
          `${archiveMediaPrefix(chapterId, job.id)}/${hashSegment(
            relativePath,
          )}-${flattened}`;

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

/**
 * Short, stable, filename-safe digest of the original relative path.
 *
 * Disambiguates two source paths that flatten to the same segment
 * (`a/b.png` and `a_b.png`). Not a security control — the path is already
 * server-owned by the time it is used — so a cheap non-cryptographic hash is
 * the right tool.
 */
function hashSegment(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}
