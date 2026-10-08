import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DISCORD_IMPORT_REPOSITORY,
  type IDiscordImportRepository,
} from '#domain/repositories/discord-import.repository.interface';
import {
  CHAT_CHANNEL_REPOSITORY,
  type IChatChannelRepository,
} from '#domain/repositories/chat.repository.interface';
import type {
  DiscordImportChannel,
  DiscordImportNewChannelType,
  DiscordRoleMapping,
} from '#domain/entities/discord-import.entity';
import {
  parseRoleMapping,
  sameAsDiscordGate,
} from '#domain/utils/discord-role-gates';
import {
  DISCORD_BOT_GATEWAY,
  DiscordApiError,
  DiscordNotConfiguredError,
  type IDiscordBotGateway,
} from '#domain/adapters/discord.interface';
import { DiscordOAuthService } from './discord-oauth.service';
import { assertImportMutable, loadImport } from './discord-import-guards';
import { toReportableError } from '../../infrastructure/observability/reportable-error';

/**
 * Discovery warnings kept on the job row.
 *
 * Matches the worker's own `MAX_WARNINGS`. A guild with hundreds of channels
 * the bot cannot read would otherwise grow this row without limit, and the
 * admin reads the first few and acts on them either way.
 */
const MAX_WARNINGS_ON_DISCOVERY = 50;

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
 * The channel step of the Discord archive importer (#3271): which Discord
 * channels an import reads, and where each one lands in Frapp.
 *
 * Two paths build the channel set. The bot path scans the chapter's connected
 * server (`discoverBotChannels`) and then records the admin's answers against
 * what the scan found (`applyDiscoveredChannelMapping`); the upload path builds
 * the set from what the browser parsed out of the export (`setChannelMapping`).
 * Both share `assertDecisionResolvable`, whose cross-chapter `use_existing`
 * check must never differ between them.
 *
 * Split out of `DiscordImportService`, which still owns the job's lifecycle.
 */
@Injectable()
export class DiscordImportChannelMappingService {
  constructor(
    @Inject(DISCORD_IMPORT_REPOSITORY)
    private readonly importRepo: IDiscordImportRepository,
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(DISCORD_BOT_GATEWAY)
    private readonly bot: IDiscordBotGateway,
    private readonly oauthService: DiscordOAuthService,
  ) {}

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
    const job = await loadImport(this.importRepo, id, chapterId);
    assertImportMutable(job);
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
    const job = await loadImport(this.importRepo, id, chapterId);
    assertImportMutable(job);
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
      // A DM or group DM is a private conversation between its members, and
      // chapter history never goes into one (#2856). The web leaves them out
      // of the picker; this is the rule.
      if (target.type === 'DM' || target.type === 'GROUP_DM') {
        throw new BadRequestException(
          `#${channel.discord_channel_name} can't be imported into a direct message. Pick a channel.`,
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
    const job = await loadImport(this.importRepo, id, chapterId);
    assertImportMutable(job);
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
}
