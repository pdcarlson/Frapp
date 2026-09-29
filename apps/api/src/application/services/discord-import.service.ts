import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { basename } from 'node:path';
import {
  DISCORD_IMPORT_CLEARABLE_STATUSES,
  MAX_ARCHIVE_CHAPTER_BYTES,
  MAX_ARCHIVE_EXPORT_PART_BYTES,
  MAX_ARCHIVE_IMPORT_BYTES,
  contentTypeByExtension,
  fileExtension,
  isAllowedUploadMime,
  isWithinArchiveUploadSizeLimit,
  ROLE_NAME_MAX_LENGTH,
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
  DiscordImportChannelProgress,
  DiscordImportFileKind,
  DiscordImportFile,
  DiscordImportNewChannelType,
  DiscordImportSource,
  DiscordImportStatus,
  DiscordRoleMapping,
  DiscordRoleMappingAction,
} from '#domain/entities/discord-import.entity';
import type { Role } from '#domain/entities/role.entity';
import {
  DISCORD_READ_PERMISSION_PREFIX,
  parseRoleMapping,
  roleNameKey,
  sameAsDiscordGate,
  uniqueReadPermission,
} from '#domain/utils/discord-role-gates';
import {
  DISCORD_BOT_GATEWAY,
  DiscordApiError,
  DiscordNotConfiguredError,
  type IDiscordBotGateway,
} from '#domain/adapters/discord.interface';
import { DiscordOAuthService } from './discord-oauth.service';
import { RbacService } from './rbac.service';
import { toReportableError } from '../../infrastructure/observability/reportable-error';
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
 * An import as the API returns it: the row, plus a bot import's progress in
 * channel rows. Null for an upload, whose message counts are its progress, and
 * for a bot import with no progress to show (see `PROGRESS_STATUSES`).
 */
export type DiscordImportWithProgress = DiscordImport & {
  channels_total: number | null;
  channels_done: number | null;
};

export interface ChannelMappingInput {
  discord_channel_id: string;
  discord_channel_name: string;
  discord_category?: string | null;
  mapping_action: DiscordImportChannel['mapping_action'];
  target_channel_id?: string | null;
  new_channel_name?: string | null;
  new_channel_is_read_only?: boolean;
  /**
   * Who can read the channel `create_new` makes. Omitted, or null, means "not
   * chosen": allowed only on a bot channel the scan saw was public in Discord
   * (it defaults to the whole chapter); refused for one that was private
   * there, holds private threads, or whose privacy the scan could not read,
   * and for every channel of an uploaded export, which says nothing either way.
   *
   * `discord` is "Same as Discord" (#2818): the Frapp roles mapped from the
   * Discord roles that could read it. Bot path only, for a channel the scan
   * saw was private, with at least one of its reader roles mapped. The API
   * works out the permissions; any the caller sends are ignored.
   */
  new_channel_visibility?: 'chapter' | 'restricted' | 'discord' | null;
  /** Required, and non-empty, when `new_channel_visibility` is `restricted`. */
  new_channel_required_permissions?: string[] | null;
  message_count?: number;
}

/**
 * One Discord role's answer on the role step, as the caller sends it. The
 * read permission is never taken from the caller: the API assigns it.
 */
export interface RoleMappingInput {
  discord_role_id: string;
  discord_role_name: string;
  action: DiscordRoleMappingAction;
  /** `existing` only: one of this chapter's roles. */
  frapp_role_id?: string | null;
  /** `new` only: the name to create the role with. */
  new_role_name?: string | null;
}

/**
 * The chat_channels type and gate a decision's new channel will get.
 * `sameAsDiscord` is the resolved gate of a "Same as Discord" decision.
 */
function newChannelShape(
  decision: ChannelMappingInput | undefined,
  sameAsDiscord?: string[],
): {
  new_channel_type: DiscordImportNewChannelType;
  new_channel_required_permissions: string[] | null;
  new_channel_same_as_discord: boolean;
} {
  if (decision?.mapping_action === 'create_new') {
    if (
      decision.new_channel_visibility === 'discord' &&
      sameAsDiscord &&
      sameAsDiscord.length > 0
    ) {
      return {
        new_channel_type: 'ROLE_GATED',
        new_channel_required_permissions: sameAsDiscord,
        new_channel_same_as_discord: true,
      };
    }
    if (decision.new_channel_visibility === 'restricted') {
      return {
        new_channel_type: 'ROLE_GATED',
        new_channel_required_permissions: normalisedPermissions(decision),
        new_channel_same_as_discord: false,
      };
    }
  }
  return {
    new_channel_type: 'PUBLIC',
    new_channel_required_permissions: null,
    new_channel_same_as_discord: false,
  };
}

/** Whether two gates hold the same permissions, in any order. */
function sameGate(a: readonly string[], b: readonly string[] | null): boolean {
  const right = new Set(b ?? []);
  return a.length === right.size && a.every((entry) => right.has(entry));
}

/**
 * Why a discovered channel may not take the whole-chapter default, or null
 * when the scan saw it was public and holds no private thread.
 */
function needsVisibilityChoice(
  scanned: DiscordImportChannel,
  holdsPrivateThreads: boolean,
): string | null {
  const name = `#${scanned.discord_channel_name}`;
  if (scanned.private_in_discord === true) {
    return `${name} is private in Discord.`;
  }
  if (holdsPrivateThreads) return `${name} holds private threads in Discord.`;
  if (scanned.private_in_discord === null) {
    return `Frapp could not tell whether ${name} is private in Discord.`;
  }
  return null;
}

function normalisedPermissions(decision: ChannelMappingInput): string[] {
  return [
    ...new Set(
      (decision.new_channel_required_permissions ?? [])
        .map((permission) => permission.trim())
        .filter((permission) => permission.length > 0),
    ),
  ];
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
    private readonly rbac: RbacService,
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
    return this.withProgress(await this.load(id, chapterId));
  }

  /**
   * The row alone, for the service's own reads. The progress counts are for
   * the admin's list; a stop or a delete must not wait on them, or fail when
   * they do.
   */
  private async load(id: string, chapterId: string): Promise<DiscordImport> {
    const found = await this.importRepo.findById(id, chapterId);
    if (!found) throw new NotFoundException('Import not found');
    return found;
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
    await this.load(id, chapterId);
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
    const job = await this.load(id, chapterId);
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
    const job = await this.load(id, chapterId);
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
    const job = await this.load(id, chapterId);
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
          { cause: toReportableError(error) },
        );
      }
      if (error instanceof DiscordApiError) {
        throw new BadRequestException(error.message);
      }
      const status = (error as { status?: unknown })?.status;
      if (status === 403 || status === 401) {
        throw new BadRequestException(
          'Frapp could not read that Discord server. Check the bot is still in the server, then reconnect Discord.',
        );
      }
      if (status === 404) {
        throw new BadRequestException(
          'That Discord server no longer exists, or the Frapp bot was removed from it. Reconnect Discord.',
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
      readable: channel.readable,
      private_in_discord: channel.privateInDiscord,
      new_channel_type: 'PUBLIC' as const,
      new_channel_required_permissions: null,
      discord_reader_role_ids: channel.readerRoleIds,
      new_channel_same_as_discord: false,
    }));

    const channels = await this.importRepo.replaceChannels(id, chapterId, rows);

    // Roles come from the guild, not from message authors: the API names roles
    // on the guild and puts only ids on a message, so this is the only place
    // the role step can get readable names from. They are the same read the
    // scan computed access from, so a roles failure reaches the admin as the
    // scan's warning rather than failing the request after the rows were
    // replaced.
    const roles = discovery.roles;

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
    const job = await this.load(id, chapterId);
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
    const known = new Map(
      existing
        .filter((channel) => !channel.parent_discord_channel_id)
        .map((channel) => [channel.discord_channel_id, channel]),
    );
    // A thread's messages land wherever its parent goes, so a channel holding
    // a private thread is as private as that thread.
    const holdsPrivateThreads = new Set(
      existing.flatMap((channel) =>
        channel.parent_discord_channel_id && channel.private_in_discord === true
          ? [channel.parent_discord_channel_id]
          : [],
      ),
    );

    // The role step runs first, so the mapping a "Same as Discord" channel is
    // gated through is already saved.
    const roleMapping = parseRoleMapping(job.role_mapping);
    const gates = new Map<string, string[]>();

    const byId = new Map<string, ChannelMappingInput>();
    for (const decision of decisions) {
      const scanned = known.get(decision.discord_channel_id);
      if (!scanned) {
        throw new BadRequestException(
          `#${decision.discord_channel_name} is not one of the channels found in this Discord server.`,
        );
      }
      // What the scan saw, not what the caller says: the row is the record of
      // Discord's own permissions at scan time.
      if (scanned.readable === false && decision.mapping_action !== 'skip') {
        throw new BadRequestException(
          `Frapp cannot read #${scanned.discord_channel_name} in Discord. Allow the Frapp role on the channel itself (or give the Frapp bot a role that can see it) and scan again, or skip it.`,
        );
      }
      // Nothing private in Discord becomes readable by the whole chapter by
      // default. A client that sends no visibility (omitted or null) has not
      // chosen one, and the default would publish the channel. Only a scan
      // that SAW the channel was public lets the default stand: unknown is
      // treated as private, because the roles read that answers it can fail.
      if (
        decision.mapping_action === 'create_new' &&
        decision.new_channel_visibility == null
      ) {
        const reason = needsVisibilityChoice(
          scanned,
          holdsPrivateThreads.has(scanned.discord_channel_id),
        );
        if (reason) {
          throw new BadRequestException(
            `${reason} Choose who can read it in Frapp before importing it.`,
          );
        }
      }
      if (
        decision.mapping_action === 'create_new' &&
        decision.new_channel_visibility === 'discord'
      ) {
        gates.set(
          scanned.discord_channel_id,
          this.sameAsDiscordGateFor(scanned, roleMapping),
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
          // Scan facts are carried across a re-map, never taken from the caller.
          readable: channel.readable,
          private_in_discord: channel.private_in_discord,
          discord_reader_role_ids: channel.discord_reader_role_ids,
          ...newChannelShape(decision, gates.get(key)),
        };
      },
    );

    return this.importRepo.replaceChannels(id, chapterId, rows);
  }

  /**
   * The gate of a channel mapped "Same as Discord", or a sentence saying why
   * it cannot be. What the scan recorded decides, never the caller: only a
   * channel it saw was private has a Discord audience to copy.
   */
  private sameAsDiscordGateFor(
    scanned: DiscordImportChannel,
    roleMapping: readonly DiscordRoleMapping[],
  ): string[] {
    const name = `#${scanned.discord_channel_name}`;
    // Empty is a channel hidden only by a deny: every role reads it by
    // inheriting from @everyone, and Frapp has no deny to copy.
    if (
      scanned.private_in_discord !== true ||
      !scanned.discord_reader_role_ids?.length
    ) {
      throw new BadRequestException(
        `Frapp has no Discord roles to copy for ${name}, so it cannot be "Same as Discord". Choose who can read it in Frapp.`,
      );
    }
    const gate = sameAsDiscordGate(
      scanned.discord_reader_role_ids,
      roleMapping,
    );
    if (gate.length === 0) {
      throw new BadRequestException(
        `None of the Discord roles that could read ${name} is mapped to a Frapp role. Map one on the roles step, or choose who can read it in Frapp.`,
      );
    }
    return gate;
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
          `Pick a Frapp channel for #${channel.discord_channel_name}, or choose to create a new one.`,
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
    // Mirrors the DB CHECK and chat's own rule (FRA-321): a ROLE_GATED channel
    // that gates on nothing is readable by no one but a President.
    if (
      channel.mapping_action === 'create_new' &&
      channel.new_channel_visibility === 'restricted' &&
      normalisedPermissions(channel).length === 0
    ) {
      throw new BadRequestException(
        `Choose at least one permission that can read the new channel for #${channel.discord_channel_name}.`,
      );
    }
  }

  async setChannelMapping(
    id: string,
    chapterId: string,
    channels: ChannelMappingInput[],
  ): Promise<DiscordImportChannel[]> {
    const job = await this.load(id, chapterId);
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
      // An export carries no permissions, so nothing says a channel was
      // public in Discord: the whole-chapter default is refused here exactly
      // as it is for a bot channel whose privacy could not be read.
      if (
        channel.mapping_action === 'create_new' &&
        channel.new_channel_visibility == null
      ) {
        throw new BadRequestException(
          `An export does not say whether #${channel.discord_channel_name} was private in Discord. Choose who can read it in Frapp before importing it.`,
        );
      }
      if (
        channel.mapping_action === 'create_new' &&
        channel.new_channel_visibility === 'discord'
      ) {
        throw new BadRequestException(
          `An export does not say which Discord roles could read #${channel.discord_channel_name}, so it cannot be "Same as Discord". Choose who can read it in Frapp.`,
        );
      }
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
        // Only `use_existing` names a target, and only it is validated above.
        // A `create_new` row's target is the channel THIS import creates,
        // which the worker writes back and like-named rows reuse (#2856), so
        // a client-sent id there is dropped, as the bot path drops it.
        target_channel_id:
          channel.mapping_action === 'use_existing'
            ? (channel.target_channel_id ?? null)
            : null,
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
        // An export carries no Discord permissions, so no fact is known.
        readable: null,
        private_in_discord: null,
        discord_reader_role_ids: null,
        ...newChannelShape(channel),
      })),
    );
  }

  /**
   * Record which Frapp role each Discord role becomes (#2818).
   *
   * The mapping gates channels and creates roles, but never assigns anyone:
   * the importer does not touch a `members` row, since every imported author
   * is a name on a message, not an account. Nothing is created or granted
   * here. Starting the import does that (`provisionRoles`), for the channels
   * that end up gated on it.
   *
   * Saving it assigns each mapped Frapp role its read permission, so the
   * channel step can resolve a "Same as Discord" gate before any new role
   * exists. Mapping anything needs `roles:manage` as well as the import's own
   * `channels:manage`, because starting the import creates roles and grants
   * permissions that Settings → Roles would otherwise require it for. An
   * all-Ignore mapping needs nothing more.
   */
  async setRoleMapping(
    id: string,
    chapterId: string,
    entries: RoleMappingInput[],
    canManageRoles: boolean,
  ): Promise<DiscordImport> {
    const job = await this.load(id, chapterId);
    this.assertMutable(job);

    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.discord_role_id)) {
        throw new BadRequestException(
          `The Discord role ${entry.discord_role_name} is mapped twice.`,
        );
      }
      seen.add(entry.discord_role_id);
    }

    const mapsSomething = entries.some((entry) => entry.action !== 'ignore');
    if (mapsSomething && !canManageRoles) {
      throw new ForbiddenException(
        'Mapping Discord roles to Frapp roles creates roles and lets them read the imported channels, which needs permission to manage roles. Set every role to Ignore, or ask someone who can manage roles to map them.',
      );
    }

    let roles: Role[] = [];
    const reserved = new Set<string>();
    if (mapsSomething) {
      // A string no role holds may still be spoken for: a channel gated on
      // it (its role deleted since), or another import's saved mapping that
      // has not started yet. Either would open that channel, or that
      // import's channels, to the role this mapping names (#2818).
      const [chapterRoles, gates, imports] = await Promise.all([
        this.rbac.findByChapter(chapterId),
        this.channelRepo.findRoleGates(chapterId),
        this.importRepo.findByChapter(chapterId),
      ]);
      roles = chapterRoles;
      for (const gate of gates) {
        for (const permission of gate.required_permissions) {
          reserved.add(permission);
        }
      }
      for (const other of imports) {
        if (other.id === id) continue;
        for (const entry of parseRoleMapping(other.role_mapping)) {
          if (entry.read_permission) reserved.add(entry.read_permission);
        }
      }
    }
    const mapping = this.resolveRoleMapping(
      entries,
      roles,
      parseRoleMapping(job.role_mapping),
      reserved,
    );
    return this.importRepo.update(id, chapterId, { role_mapping: mapping });
  }

  /**
   * Validate the role step's answers against the chapter's roles, and give
   * each mapped Frapp role its read permission.
   *
   * A read permission is held by one role alone, or it would gate a channel
   * to a second role nobody chose. So an existing role reuses a
   * `channels:read:` permission only it already holds (from an earlier import),
   * and otherwise gets a new string that no role holds and nothing in
   * `reserved` (a channel gate, another import's mapping) names. Every entry
   * mapping to the same role shares one, including two Discord roles mapped
   * to the same new role name. `provisionRoles` checks it all again at start.
   */
  private resolveRoleMapping(
    entries: readonly RoleMappingInput[],
    roles: readonly Role[],
    previous: readonly DiscordRoleMapping[],
    reserved: ReadonlySet<string>,
  ): DiscordRoleMapping[] {
    const byId = new Map(roles.map((role) => [role.id, role]));
    const byName = new Map(roles.map((role) => [roleNameKey(role.name), role]));
    const previousById = new Map(
      previous.map((entry) => [entry.discord_role_id, entry]),
    );

    const holders = new Map<string, number>();
    for (const role of roles) {
      for (const permission of role.permissions) {
        holders.set(permission, (holders.get(permission) ?? 0) + 1);
      }
    }
    const taken = new Set([...holders.keys(), ...reserved]);
    const assigned = new Map<string, string>();
    const permissionFor = (target: string, name: string, role?: Role) => {
      const known = assigned.get(target);
      if (known) return known;
      const permission =
        role?.permissions.find(
          (held) =>
            held.startsWith(DISCORD_READ_PERMISSION_PREFIX) &&
            holders.get(held) === 1,
        ) ?? uniqueReadPermission(name, taken);
      taken.add(permission);
      assigned.set(target, permission);
      return permission;
    };

    return entries.map((entry): DiscordRoleMapping => {
      const base = {
        discord_role_id: entry.discord_role_id,
        discord_role_name: entry.discord_role_name,
      };
      if (entry.action === 'existing') {
        const role = entry.frapp_role_id
          ? byId.get(entry.frapp_role_id)
          : undefined;
        if (!role) {
          throw new BadRequestException(
            `The role chosen for ${entry.discord_role_name} is not one of this chapter's roles.`,
          );
        }
        return {
          ...base,
          action: 'existing',
          frapp_role_id: role.id,
          new_role_name: null,
          read_permission: permissionFor(`role:${role.id}`, role.name, role),
        };
      }
      if (entry.action === 'new') {
        const name = entry.new_role_name?.trim() ?? '';
        if (!name) {
          throw new BadRequestException(
            `Name the new role for ${entry.discord_role_name}.`,
          );
        }
        if (name.length > ROLE_NAME_MAX_LENGTH) {
          throw new BadRequestException(
            `The new role for ${entry.discord_role_name} needs a name of at most ${ROLE_NAME_MAX_LENGTH} characters.`,
          );
        }
        const clash = byName.get(roleNameKey(name));
        if (clash) {
          // The role an earlier start of THIS import created is not a clash:
          // re-saving the mapping of a failed import keeps pointing at it.
          const before = previousById.get(entry.discord_role_id);
          if (before?.action === 'new' && before.frapp_role_id === clash.id) {
            return {
              ...base,
              action: 'new',
              frapp_role_id: clash.id,
              new_role_name: clash.name,
              read_permission: permissionFor(
                `role:${clash.id}`,
                clash.name,
                clash,
              ),
            };
          }
          throw new BadRequestException(
            `A role named "${clash.name}" already exists. Map ${entry.discord_role_name} to it instead of creating a new one.`,
          );
        }
        return {
          ...base,
          action: 'new',
          frapp_role_id: null,
          new_role_name: name,
          read_permission: permissionFor(`new:${roleNameKey(name)}`, name),
        };
      }
      return {
        ...base,
        action: 'ignore',
        frapp_role_id: null,
        new_role_name: null,
        read_permission: null,
      };
    });
  }

  async start(
    id: string,
    chapterId: string,
    canManageRoles: boolean,
  ): Promise<DiscordImport> {
    const job = await this.load(id, chapterId);
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

    const roleMapping = await this.provisionRoles(
      id,
      chapterId,
      channels,
      parseRoleMapping(job.role_mapping),
      canManageRoles,
    );

    return this.importRepo.update(id, chapterId, {
      status: 'ready',
      parts_total: partsTotal,
      error: null,
      role_mapping: roleMapping,
    });
  }

  /**
   * Create the mapping's new roles and grant each role the read permission
   * of the channels about to be created on it (#2818). Never assigns anyone.
   *
   * Only a channel still to be created counts: one whose Frapp channel exists
   * already has its gate. Each such "Same as Discord" channel is checked
   * against the mapping as it stands now, because the role step can be saved
   * again after the channels were mapped, and a gate that no longer matches
   * would be created on permissions nobody is granted.
   *
   * Everything is checked before anything is written:
   *
   *  - a read permission stays with the roles the mapping gives it to. One
   *    held by any other role, or newly granted while it already gates a
   *    channel this import did not create, would open that channel to roles
   *    nobody chose, so the start is refused and the roles are saved again,
   *    which picks a fresh string;
   *  - creating a role or granting a permission needs `roles:manage` from
   *    whoever starts the import, not only from whoever saved the mapping,
   *    as Settings → Roles would require.
   *
   * A new role is created with only the read permissions that gate an
   * imported channel, and nothing else (owner's decision on #2818). Its id is
   * recorded on the import as soon as it exists, so a start that fails part
   * way leaves a mapping that points at it, and re-running skips it. A role
   * someone else added under a new role's name since is refused, not
   * adopted, and a permission a role already holds is not added twice.
   */
  private async provisionRoles(
    importId: string,
    chapterId: string,
    channels: readonly DiscordImportChannel[],
    mapping: DiscordRoleMapping[],
    canManageRoles: boolean,
  ): Promise<DiscordRoleMapping[]> {
    const needed = new Set<string>();
    for (const channel of channels) {
      if (
        channel.parent_discord_channel_id ||
        channel.mapping_action !== 'create_new' ||
        channel.target_channel_id !== null ||
        channel.status === 'completed' ||
        !channel.new_channel_same_as_discord
      ) {
        continue;
      }
      const gate = sameAsDiscordGate(
        channel.discord_reader_role_ids ?? [],
        mapping,
      );
      if (
        gate.length === 0 ||
        !sameGate(gate, channel.new_channel_required_permissions)
      ) {
        throw new BadRequestException(
          `The role mapping changed after #${channel.discord_channel_name} was mapped. Save the channel mapping again, then start the import.`,
        );
      }
      for (const permission of gate) needed.add(permission);
    }

    const creating = mapping.filter(
      (entry) => entry.action === 'new' && entry.frapp_role_id === null,
    );
    const granting = mapping.some(
      (entry) => entry.read_permission && needed.has(entry.read_permission),
    );
    if (creating.length === 0 && !granting) return mapping;

    const roles = await this.rbac.findByChapter(chapterId);
    const byId = new Map(roles.map((role) => [role.id, role]));
    const byName = new Map(roles.map((role) => [roleNameKey(role.name), role]));

    // A role named like a new one, and not recorded as this import's, was
    // made by someone else since the mapping was saved. It is not adopted:
    // saving would have refused the clash, and adopting it here would give
    // its members the imported channels without anyone choosing that.
    const provisioned = mapping.map((entry) => ({ ...entry }));
    for (const entry of provisioned) {
      if (entry.action !== 'new' || entry.frapp_role_id !== null) continue;
      const name = entry.new_role_name ?? entry.discord_role_name;
      const existing = byName.get(roleNameKey(name));
      if (existing) {
        throw new BadRequestException(
          `A role named "${existing.name}" was added since the roles were mapped. Map ${entry.discord_role_name} to it, or give the new role another name, then start the import.`,
        );
      }
    }

    // The plan: roles to create, grants to add, and who may hold each
    // permission once it is done.
    const toCreate = new Map<string, { name: string; permissions: string[] }>();
    const grants: { roleId: string; permission: string }[] = [];
    const holdersAllowed = new Map<string, Set<string>>();
    for (const entry of provisioned) {
      const permission = entry.read_permission;
      if (!permission || entry.action === 'ignore') continue;
      if (entry.frapp_role_id === null) {
        const name = entry.new_role_name ?? entry.discord_role_name;
        toCreate.set(roleNameKey(name), {
          name,
          permissions: needed.has(permission) ? [permission] : [],
        });
        continue;
      }
      const allowed = holdersAllowed.get(permission) ?? new Set<string>();
      allowed.add(entry.frapp_role_id);
      holdersAllowed.set(permission, allowed);
      if (!needed.has(permission)) continue;
      const role = byId.get(entry.frapp_role_id);
      if (!role) {
        throw new BadRequestException(
          `The Frapp role ${entry.discord_role_name} maps to no longer exists. Map the roles again, then start the import.`,
        );
      }
      if (
        !role.permissions.includes(permission) &&
        !grants.some(
          (grant) =>
            grant.roleId === role.id && grant.permission === permission,
        )
      ) {
        grants.push({ roleId: role.id, permission });
      }
    }

    const newlyGranted = new Set([
      ...grants.map((grant) => grant.permission),
      ...[...toCreate.values()].flatMap((plan) => plan.permissions),
    ]);
    const refuse = (permission: string) =>
      new BadRequestException(
        `The read permission ${permission} is already in use elsewhere in this chapter. Save the roles and the channels again so Frapp can pick a new one, then start the import.`,
      );
    for (const role of roles) {
      for (const permission of role.permissions) {
        if (
          needed.has(permission) &&
          !holdersAllowed.get(permission)?.has(role.id)
        ) {
          throw refuse(permission);
        }
      }
    }
    if (newlyGranted.size > 0) {
      // Only channels this import created, never a merge target: a
      // `use_existing` channel was there before and keeps its own gate.
      const own = new Set(
        channels.flatMap((channel) =>
          channel.mapping_action === 'create_new' && channel.target_channel_id
            ? [channel.target_channel_id]
            : [],
        ),
      );
      for (const gate of await this.channelRepo.findRoleGates(chapterId)) {
        if (own.has(gate.id)) continue;
        const clash = gate.required_permissions.find((permission) =>
          newlyGranted.has(permission),
        );
        if (clash) throw refuse(clash);
      }
    }

    if ((toCreate.size > 0 || grants.length > 0) && !canManageRoles) {
      throw new ForbiddenException(
        'Starting this import creates roles or lets roles read the imported channels, which needs permission to manage roles. Ask someone who can manage roles to start it, or set every role to Ignore.',
      );
    }

    let order = Math.max(0, ...roles.map((role) => role.display_order));
    for (const [key, plan] of toCreate) {
      order += 1;
      const role = await this.rbac.create(chapterId, {
        name: plan.name,
        permissions: plan.permissions,
        display_order: order,
        color: null,
      });
      for (const entry of provisioned) {
        if (
          entry.action === 'new' &&
          entry.frapp_role_id === null &&
          roleNameKey(entry.new_role_name ?? entry.discord_role_name) === key
        ) {
          entry.frapp_role_id = role.id;
        }
      }
      await this.importRepo.update(importId, chapterId, {
        role_mapping: provisioned,
      });
    }

    for (const grant of grants) {
      const role = byId.get(grant.roleId);
      if (!role || role.permissions.includes(grant.permission)) continue;
      byId.set(
        role.id,
        await this.rbac.update(role.id, chapterId, {
          permissions: [...role.permissions, grant.permission],
        }),
      );
    }
    return provisioned;
  }

  async cancel(id: string, chapterId: string): Promise<DiscordImport> {
    const job = await this.load(id, chapterId);
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
    const job = await this.load(id, chapterId);
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
