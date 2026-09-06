import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { basename } from 'node:path';
import {
  MAX_ARCHIVE_CHAPTER_BYTES,
  MAX_ARCHIVE_EXPORT_PART_BYTES,
  MAX_ARCHIVE_IMPORT_BYTES,
  contentTypeByExtension,
  fileExtension,
  isAllowedUploadMime,
  isWithinArchiveUploadSizeLimit,
} from '@repo/validation';
import { formatBytes } from '@repo/formatting';
import {
  ArchiveQuotaExceededError,
  DISCORD_IMPORT_REPOSITORY,
  type IDiscordImportRepository,
} from '#domain/repositories/discord-import.repository.interface';
import {
  CHAT_CHANNEL_REPOSITORY,
  type IChatChannelRepository,
} from '#domain/repositories/chat.repository.interface';
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
  DiscordImportFileKind,
  DiscordImportFile,
  DiscordImportSource,
  DiscordRoleMapping,
} from '#domain/entities/discord-import.entity';
import {
  DISCORD_BOT_GATEWAY,
  DiscordApiError,
  DiscordNotConfiguredError,
  type IDiscordBotGateway,
} from '#domain/adapters/discord.interface';
import { DiscordOAuthService } from './discord-oauth.service';

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

/**
 * Discovery warnings kept on the job row.
 *
 * Matches the worker's own `MAX_WARNINGS`. A guild with hundreds of channels
 * the bot cannot read would otherwise grow this row without limit, and the
 * admin reads the first few and acts on them either way.
 */
const MAX_WARNINGS_ON_DISCOVERY = 50;

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
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(DISCORD_BOT_GATEWAY)
    private readonly bot: IDiscordBotGateway,
    private readonly oauthService: DiscordOAuthService,
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

  /**
   * Ask Discord what this chapter's server contains, and record it.
   *
   * The bot path's answer to the upload path's client-side export scan. It has
   * to run server-side — only the bot can enumerate the guild — which also
   * makes it the point where the tenant boundary is established for the whole
   * import: the guild comes from `requireGuildId(chapterId)`, every channel
   * comes back from Discord carrying that guild, and the rows written here are
   * the only channels the worker will ever read.
   *
   * Threads are recorded as their own rows with `parent_discord_channel_id`
   * set. They are not separate mapping questions — see
   * `applyDiscoveredChannelMapping` — but they need their own row because they
   * have their own message endpoint and their own resume cursor.
   *
   * Re-runnable: it replaces the channel set wholesale, which is right while
   * the import is still mutable (nothing has been read yet, so there is no
   * cursor to lose) and is refused afterwards by `assertMutable`.
   */
  async discoverBotChannels(
    id: string,
    chapterId: string,
  ): Promise<{
    channels: DiscordImportChannel[];
    roles: { discord_role_id: string; discord_role_name: string }[];
    warnings: string[];
  }> {
    const job = await this.get(id, chapterId);
    this.assertMutable(job);
    if (job.source !== 'bot') {
      throw new BadRequestException(
        'This import reads an uploaded export, so there is nothing to discover from Discord.',
      );
    }

    const guildId = await this.oauthService.requireGuildId(chapterId);
    if (job.guild_id && job.guild_id !== guildId) {
      throw new ConflictException(
        'This chapter is now connected to a different Discord server. Start a new import.',
      );
    }

    // Discord's failures here are operational, not bugs: the token can be
    // rotated out from under a live connection, and a chapter can remove the
    // bot from its server between connecting and scanning. Unmapped, both leave
    // `AllExceptionsFilter` to answer 500 and page Sentry for something no
    // engineer can fix. Translated to what they actually are.
    let discovery: Awaited<ReturnType<IDiscordBotGateway['discoverChannels']>>;
    try {
      discovery = await this.bot.discoverChannels(guildId);
    } catch (error) {
      if (error instanceof DiscordNotConfiguredError) {
        throw new ServiceUnavailableException(
          'Reading Discord is not configured in this environment. The DiscordChatExporter upload flow still works.',
        );
      }
      if (error instanceof DiscordApiError) {
        throw new BadRequestException(error.message);
      }
      const status = (error as { status?: unknown })?.status;
      if (status === 403 || status === 401) {
        throw new BadRequestException(
          'Signet could not read that Discord server. Check the bot is still in the server, then reconnect Discord.',
        );
      }
      if (status === 404) {
        throw new BadRequestException(
          'That Discord server no longer exists, or the Signet bot was removed from it. Reconnect Discord.',
        );
      }
      throw error;
    }

    // Ordered parents-first, each followed by its own threads. `position` is
    // then pinned from this order, which is what lets the worker walk a parent
    // before the threads that inherit its destination — and what keeps a
    // resumed import walking the same sequence a later sort change would
    // otherwise alter.
    const parents = discovery.channels.filter((channel) => !channel.isThread);
    const threadsByParent = new Map<string, typeof discovery.channels>();
    for (const channel of discovery.channels) {
      if (!channel.isThread || !channel.parentChannelId) continue;
      const siblings = threadsByParent.get(channel.parentChannelId) ?? [];
      siblings.push(channel);
      threadsByParent.set(channel.parentChannelId, siblings);
    }

    const ordered = parents.flatMap((parent) => [
      parent,
      ...(threadsByParent.get(parent.id) ?? []),
    ]);

    const rows = ordered.map((channel, index) => ({
      discord_channel_id: channel.id,
      discord_channel_name: channel.name,
      discord_category: channel.categoryName,
      // Everything starts skipped. "Ask, never infer" is the rule the upload
      // path already follows, and it matters more here: the bot can see the
      // whole server, so a default of anything other than "do nothing" would
      // mean a chapter that clicked through the wizard imported channels it was
      // never asked about.
      mapping_action: 'skip' as const,
      target_channel_id: null,
      new_channel_name: null,
      new_channel_is_read_only: true,
      message_count: 0,
      imported_count: 0,
      status: 'skipped' as const,
      error: null,
      cursor_before_snowflake: null,
      parent_discord_channel_id: channel.parentChannelId,
      position: index,
    }));

    const channels = await this.importRepo.replaceChannels(id, chapterId, rows);

    // Roles come from the guild, not from message authors: the API names roles
    // on the guild and puts only ids on a message, so this is the only place
    // the worksheet can get readable names from.
    const roles = await this.bot.listRoles(guildId);

    await this.importRepo.update(id, chapterId, {
      guild_id: guildId,
      warnings: discovery.warnings.slice(-MAX_WARNINGS_ON_DISCOVERY),
    });

    return {
      channels,
      roles: roles.map((role) => ({
        discord_role_id: role.id,
        discord_role_name: role.name,
      })),
      warnings: discovery.warnings,
    };
  }

  /**
   * Record the admin's per-channel decisions on a discovered (bot) import.
   *
   * Separate from `setChannelMapping` — which the upload path uses to CREATE
   * the channel set from what the browser parsed — because here the set already
   * exists and is authoritative. A caller cannot add a channel: a decision for
   * a `discord_channel_id` that discovery did not return is rejected rather
   * than inserted, which is what stops a client naming a channel the bot was
   * never shown.
   *
   * Threads inherit their parent's decision and are not addressable. The admin
   * answered for #general; every thread inside #general goes wherever #general
   * went. Letting a caller aim a thread somewhere else would create a second
   * destination nobody was asked about — and, for `create_new`, would mint a
   * second identically-named channel, which `chat_channels` has no unique
   * constraint to catch.
   */
  async applyDiscoveredChannelMapping(
    id: string,
    chapterId: string,
    decisions: ChannelMappingInput[],
  ): Promise<DiscordImportChannel[]> {
    const job = await this.get(id, chapterId);
    this.assertMutable(job);
    if (job.source !== 'bot') {
      throw new BadRequestException(
        'This import reads an uploaded export; map its channels with the upload flow.',
      );
    }

    const existing = await this.importRepo.findChannels(id, chapterId);
    if (existing.length === 0) {
      throw new BadRequestException(
        'Scan the Discord server before mapping its channels.',
      );
    }
    const known = new Set(
      existing
        .filter((channel) => !channel.parent_discord_channel_id)
        .map((channel) => channel.discord_channel_id),
    );

    const byId = new Map<string, ChannelMappingInput>();
    for (const decision of decisions) {
      if (!known.has(decision.discord_channel_id)) {
        throw new BadRequestException(
          `#${decision.discord_channel_name} is not one of the channels found in this Discord server.`,
        );
      }
      await this.assertDecisionResolvable(decision, chapterId);
      byId.set(decision.discord_channel_id, decision);
    }

    // Return type annotated rather than cast inline: `status` and
    // `mapping_action` are string unions, and an object literal in a `.map`
    // widens both to `string` without it.
    const rows = existing.map(
      (channel): Omit<DiscordImportChannel, 'id' | 'import_id'> => {
        // A thread reads its parent's answer; a top-level channel reads its own.
        const key =
          channel.parent_discord_channel_id ?? channel.discord_channel_id;
        const decision = byId.get(key);
        const action = decision?.mapping_action ?? 'skip';
        return {
          discord_channel_id: channel.discord_channel_id,
          discord_channel_name: channel.discord_channel_name,
          discord_category: channel.discord_category,
          mapping_action: action,
          // Only `use_existing` names a target, and only `use_existing` is
          // validated — `assertDecisionResolvable` checks nothing when the
          // action is `create_new` or `skip`. Persisting a caller's UUID under
          // an unvalidated action writes an unchecked `chat_channels` id onto
          // this row AND onto every thread row that inherits it, and
          // `chat_messages` has no `chapter_id`, so its FK would accept a
          // channel from any chapter in the product. Dropped, not trusted.
          target_channel_id:
            action === 'use_existing'
              ? (decision?.target_channel_id ?? null)
              : null,
          new_channel_name: decision?.new_channel_name?.trim() || null,
          new_channel_is_read_only: decision?.new_channel_is_read_only ?? true,
          message_count: channel.message_count,
          imported_count: 0,
          status: action === 'skip' ? 'skipped' : 'pending',
          error: null,
          cursor_before_snowflake: null,
          parent_discord_channel_id: channel.parent_discord_channel_id,
          position: channel.position,
        };
      },
    );

    return this.importRepo.replaceChannels(id, chapterId, rows);
  }

  /**
   * The same validation `setChannelMapping` applies, factored out so both
   * paths cannot drift.
   *
   * The `use_existing` check is the important one and is the exact bug #1242's
   * review caught: `target_channel_id` is a client-supplied UUID, `chat_messages`
   * has no `chapter_id` of its own, and its FK to `chat_channels` accepts ANY
   * channel in the product. Nothing in the database would catch a channel from
   * another chapter — and it would be unrecoverable, because the purge scopes
   * its delete by the import's own chapter.
   */
  private async assertDecisionResolvable(
    channel: ChannelMappingInput,
    chapterId: string,
  ): Promise<void> {
    if (channel.mapping_action === 'use_existing') {
      if (!channel.target_channel_id) {
        throw new BadRequestException(
          `Pick a Signet channel for #${channel.discord_channel_name}, or choose to create a new one.`,
        );
      }
      const target = await this.channelRepo.findById(
        channel.target_channel_id,
        chapterId,
      );
      if (!target) {
        throw new BadRequestException(
          `The channel chosen for #${channel.discord_channel_name} is not one of this chapter's channels.`,
        );
      }
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

  async setChannelMapping(
    id: string,
    chapterId: string,
    channels: ChannelMappingInput[],
  ): Promise<DiscordImportChannel[]> {
    const job = await this.get(id, chapterId);
    this.assertMutable(job);
    // A bot import's channel set is established by discovery, and
    // `applyDiscoveredChannelMapping` enforces that it is the ONLY set the
    // worker reads by refusing any `discord_channel_id` the scan did not
    // return. THIS route builds the set from whatever the caller sends, so
    // without this guard it is the way around that invariant: a caller could
    // point a bot import at arbitrary Discord snowflakes and read the worker's
    // guild-mismatch error back off the job row — an oracle for which Discord
    // servers other chapters have connected.
    if (job.source === 'bot') {
      throw new BadRequestException(
        'This import reads Discord directly. Map its channels with the scanned-channel route.',
      );
    }

    // Mirrors the DB CHECK, so the admin gets a sentence instead of a
    // constraint name — and so the worker never meets an action it cannot
    // resolve thousands of rows into an import. Shared with the bot path's
    // `applyDiscoveredChannelMapping`: the `use_existing` cross-chapter check
    // is the one that must never differ between the two.
    for (const channel of channels) {
      await this.assertDecisionResolvable(channel, chapterId);
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
        // Bot-path columns, inert here. An uploaded export resumes on the job's
        // part cursor, has no threads to parent, and keeps the default position
        // so `findChannels` returns it in the same name order it always did.
        cursor_before_snowflake: null,
        parent_discord_channel_id: null,
        position: 0,
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

    // A bot import has nothing uploaded — it fetches. What it needs instead is
    // a live connection, re-resolved here rather than trusted from the job row,
    // so an import cannot be started against a server the chapter has since
    // disconnected or replaced.
    let partsTotal = 0;
    if (job.source === 'bot') {
      const guildId = await this.oauthService.requireGuildId(chapterId);
      if (job.guild_id && job.guild_id !== guildId) {
        throw new ConflictException(
          'This chapter is now connected to a different Discord server. Start a new import.',
        );
      }
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
    // as "Signet lost my history". The upload path cannot hit this (its rows
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

    return this.importRepo.update(id, chapterId, {
      status: 'ready',
      parts_total: partsTotal,
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
    if (
      job.status !== 'draft' &&
      job.status !== 'failed' &&
      job.status !== 'ready'
    ) {
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
