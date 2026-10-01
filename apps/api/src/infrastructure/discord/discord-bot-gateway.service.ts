import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REST, RESTEvents } from '@discordjs/rest';
import { ApplicationFlags, ChannelType, Routes } from 'discord-api-types/v10';
import {
  DISCORD_MESSAGE_PAGE_LIMIT,
  DiscordApiError,
  DiscordNotConfiguredError,
  type DiscordApplicationInfo,
  type DiscordChannelDiscovery,
  type DiscordChannelRef,
  type DiscordRoleRef,
  type IDiscordBotGateway,
} from '#domain/adapters/discord.interface';
import { asRecord, asString } from '#domain/utils/json-guards';
import {
  basePermissions,
  canReadHistory,
  channelPermissions,
  parseOverwrites,
  openToEveryone,
  readerRoleIds,
  type DiscordPermissionSubject,
  type DiscordRolePermissions,
} from '#domain/utils/discord-permissions';
import { toReportableError } from '../observability/reportable-error';

/**
 * Channel types that hold messages a chapter would want archived.
 *
 * Voice, stage and category rows come back from `GET /guilds/{id}/channels`
 * too; a category is a folder and has no messages, and voice text is not a
 * thing a chapter's history lives in. Announcement channels are included
 * because plenty of chapters run `#announcements` as their record of record.
 */
const READABLE_CHANNEL_TYPES = new Set<number>([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
]);

/**
 * Channel types that hold no messages themselves but PARENT threads that do.
 *
 * A forum is the case: every post in it is a thread, and the forum channel
 * itself has no message list — `GET /channels/{id}/messages` answers 400
 * (`50024`, "Cannot execute action on this channel type"). Offering one as a
 * mappable destination therefore fails the whole import the moment the worker
 * reaches it, after it has already minted a Frapp channel for it.
 *
 * So a forum is enumerated as a thread PARENT and never as an importable
 * channel: its posts import, each inheriting the mapping the admin gave — and
 * a forum with no mapping is simply a forum nobody chose, exactly like a text
 * channel nobody chose.
 */
const THREAD_PARENT_ONLY_TYPES = new Set<number>([ChannelType.GuildForum]);

/**
 * Widened to `number` deliberately.
 *
 * Discord's `type` arrives as an untyped JSON number, so the comparison is
 * number-to-number — spelling it against the enum member directly trips
 * `no-unsafe-enum-comparison`, which is right to complain: the value has not
 * been proven to be a `ChannelType` at all. Same reason the sets above are
 * `Set<number>`.
 */
const TEXT_CHANNEL_TYPE: number = ChannelType.GuildText;

const THREAD_TYPES = new Set<number>([
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

/**
 * Pages of archived threads to walk per parent channel.
 *
 * Each page is up to 100 threads and costs a request against a shared rate
 * limit that every connected chapter draws on. A channel with more than 5,000
 * archived threads is not a chapter's Discord server, it is a bot's, and the
 * cap turns that into a recorded warning instead of an import that never
 * finishes discovering.
 */
const MAX_ARCHIVED_THREAD_PAGES = 50;

/** The setup check answers a wizard request; it gives up well before that does. */
const APPLICATION_FETCH_TIMEOUT_MS = 5_000;

/** Either flag means the Message Content Intent is on for this application. */
const MESSAGE_CONTENT_INTENT_FLAGS =
  ApplicationFlags.GatewayMessageContent |
  ApplicationFlags.GatewayMessageContentLimited;

/**
 * The Message Content Intent, from the application object's `flags` bitfield.
 * Null when Discord sent no numeric `flags`: an answer that omits the field
 * says nothing about the toggle, and reading it as "off" would fail imports
 * on a working setup.
 */
function messageContentIntentOf(
  flags: unknown,
): DiscordApplicationInfo['messageContentIntent'] {
  if (typeof flags !== 'number' || !Number.isInteger(flags)) return null;
  return (flags & MESSAGE_CONTENT_INTENT_FLAGS) !== 0 ? 'enabled' : 'disabled';
}

/** The HTTP status behind a `@discordjs/rest` rejection, when it carried one. */
function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : null;
}

/**
 * The bot's read-only view of Discord, over REST only.
 *
 * **No gateway connection.** A gateway session is a persistent websocket per
 * shard with its own heartbeat, reconnect and identify budget, and this process
 * also serves live API traffic — none of which buys anything here, because
 * every read the export needs is a plain REST call. It also means the bot holds
 * no session at rest: between imports it costs nothing.
 *
 * Rate limiting is `@discordjs/rest`'s, not ours. It reads Discord's
 * `X-RateLimit-*` headers, queues per route bucket, respects the global limit,
 * and handles 429s with the server's own `retry_after`. Hand-rolled retry on
 * top of that is how you turn one rate limit into two — and this token is
 * shared by every connected chapter, so a retry storm from one import is an
 * outage for all of them.
 */
@Injectable()
export class DiscordBotGatewayService implements IDiscordBotGateway {
  private readonly logger = new Logger(DiscordBotGatewayService.name);
  private readonly rest: REST | null;

  /**
   * Whether Discord has answered 401 to any bot request in this process.
   *
   * Recorded here because the client erases the evidence: on an authenticated
   * 401, `@discordjs/rest` clears its own token, and every later request then
   * fails with a plain "Expected token to be set" error carrying no status. A
   * setup check that only looked at its own response would report a reset
   * token once, then read the same dead token as "Discord unreachable" a minute
   * later and offer the flow again. Sticky for the life of the process, like
   * the client's own state: only a restart with a new token recovers either.
   */
  private tokenRejected = false;

  private cachedBotUserId: string | null = null;

  constructor(config: ConfigService) {
    const token = config.get<string>('DISCORD_BOT_TOKEN')?.trim();
    // Optional at boot, like the analytics and check-in secrets: local dev, CI
    // and any environment that has not registered a Discord application must
    // still start. Callers ask `isConfigured()` and answer 503; nothing here
    // throws on construction.
    this.rest = token ? new REST({ version: '10' }).setToken(token) : null;
    if (this.rest) {
      // Emitted for every response before the client handles errors, so this
      // sees the 401 whichever call hit it first: an import slice as readily
      // as the setup check.
      this.rest.on(RESTEvents.Response, (request, response) => {
        if (response.status === 401 && request.data.auth) {
          this.tokenRejected = true;
        }
      });
    }
    if (!token) {
      this.logger.log(
        'DISCORD_BOT_TOKEN is unset; the Discord bot import path is disabled.',
      );
    }
  }

  isConfigured(): boolean {
    return this.rest !== null;
  }

  hasRejectedToken(): boolean {
    return this.tokenRejected;
  }

  private client(): REST {
    if (!this.rest) {
      throw new DiscordNotConfiguredError(
        'The Discord bot is not configured in this environment.',
      );
    }
    return this.rest;
  }

  // ── setup check ───────────────────────────────────────────────────────────

  async fetchApplication(): Promise<DiscordApplicationInfo> {
    const rest = this.client();
    if (this.tokenRejected) {
      throw new DiscordApiError(
        'Discord refused DISCORD_BOT_TOKEN (401) earlier in this process, and the client has discarded it.',
        401,
      );
    }

    let raw: unknown;
    let timer: NodeJS.Timeout | undefined;
    // A race, not just the signal: the client honours `signal` in its queue
    // and in the fetch, but not in its rate-limit sleeps or its 429
    // retry-after waits. The queue is shared with every running import, so
    // without a deadline of our own the wizard's request could sit behind
    // someone else's rate limit for as long as Discord says.
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new DiscordApiError(
              `GET /applications/@me did not answer within ${APPLICATION_FETCH_TIMEOUT_MS} ms`,
            ),
          ),
        APPLICATION_FETCH_TIMEOUT_MS,
      );
    });
    try {
      raw = await Promise.race([
        rest.get(Routes.currentApplication(), {
          signal: AbortSignal.timeout(APPLICATION_FETCH_TIMEOUT_MS),
        }),
        deadline,
      ]);
    } catch (error) {
      if (error instanceof DiscordApiError) throw error;
      throw new DiscordApiError(
        `Discord refused GET /applications/@me: ${this.describe(error)}`,
        // The 401 that cleared the token may have landed during this very
        // call, in which case what reached here is the status-less
        // "Expected token to be set" error.
        this.tokenRejected ? 401 : statusOf(error),
      );
    } finally {
      clearTimeout(timer);
    }

    const body = asRecord(raw);
    const id = asString(body?.id);
    if (!id) {
      throw new DiscordApiError('Discord returned no application id.');
    }
    const redirectUris = body?.redirect_uris;
    return {
      id,
      redirectUris: Array.isArray(redirectUris)
        ? redirectUris.filter((uri): uri is string => typeof uri === 'string')
        : null,
      messageContentIntent: messageContentIntentOf(body?.flags),
    };
  }

  // ── discovery ─────────────────────────────────────────────────────────────

  async discoverChannels(guildId: string): Promise<DiscordChannelDiscovery> {
    const rest = this.client();
    const warnings: string[] = [];

    const raw = (await rest.get(Routes.guildChannels(guildId))) as unknown[];
    const access = await this.loadAccessContext(guildId, warnings);

    // Category names are resolved from the same response rather than fetched:
    // a category IS a channel row, so the mapping is already in hand.
    const categoryNames = new Map<string, string>();
    for (const entry of raw) {
      const channel = asRecord(entry);
      if (!channel) continue;
      if (channel.type === ChannelType.GuildCategory) {
        const id = asString(channel.id);
        const name = asString(channel.name);
        if (id && name) categoryNames.set(id, name);
      }
    }

    const channels: DiscordChannelRef[] = [];
    const unreadable: string[] = [];
    const parents: {
      id: string;
      name: string;
      canHavePrivateThreads: boolean;
      ref: DiscordChannelRef;
    }[] = [];

    for (const entry of raw) {
      const channel = asRecord(entry);
      if (!channel) continue;
      const type = channel.type as number;
      const importable = READABLE_CHANNEL_TYPES.has(type);
      const threadParentOnly = THREAD_PARENT_ONLY_TYPES.has(type);
      if (!importable && !threadParentOnly) continue;

      const id = asString(channel.id);
      if (!id) continue;

      // Guild identity is taken from Discord's own response on every row. The
      // caller passed a guild id, but the whole point of this check is that a
      // caller could be wrong — one token reads every connected chapter, so a
      // row that does not name this guild is dropped rather than trusted.
      const rowGuildId = asString(channel.guild_id);
      if (rowGuildId !== null && rowGuildId !== guildId) {
        warnings.push(
          `Discord returned a channel belonging to another server (${rowGuildId}); it was ignored.`,
        );
        continue;
      }

      const name = asString(channel.name) ?? id;
      const parentId = asString(channel.parent_id);
      const overwrites = parseOverwrites(channel.permission_overwrites);
      const readable = access.subject
        ? canReadHistory(
            channelPermissions(
              access.base,
              guildId,
              overwrites,
              access.subject,
            ),
          )
        : null;
      const privateInDiscord = access.roles
        ? !openToEveryone(guildId, access.roles, overwrites)
        : null;
      // Worked from the overwrites, not from what the bot can read: the roles
      // gating a channel the bot cannot see are still named on it.
      const readers =
        access.roles && privateInDiscord === true
          ? readerRoleIds(
              guildId,
              access.roles,
              overwrites,
              access.named.map((role) => role.id),
            )
          : null;
      // A forum IS offered as a destination — `#questions` is what an admin
      // recognises, and its posts inherit whatever they choose for it. What it
      // is not is message-fetchable, so it carries `holdsOnlyThreads` and the
      // export skips its own message walk. Dropping it from this list instead
      // would orphan every post inside it: a forum post's only route to a
      // destination is inheriting its parent's.
      const ref: DiscordChannelRef = {
        id,
        name,
        guildId,
        categoryName: parentId ? (categoryNames.get(parentId) ?? null) : null,
        parentChannelId: null,
        isThread: false,
        holdsOnlyThreads: threadParentOnly,
        readable,
        privateInDiscord,
        readerRoleIds: readers,
      };
      channels.push(ref);
      // Discord lists every channel to a bot, readable or not. Asking one it
      // cannot read for its threads only earns a 403, and each 403 is spent
      // from the invalid-request budget every connected chapter shares. So an
      // unreadable channel is listed, reported once below, and never probed.
      if (readable === false) {
        unreadable.push(name);
        continue;
      }
      parents.push({
        id,
        name,
        // Only a text channel can hold a private thread. Announcement and forum
        // channels cannot, so the private endpoint is pointless for them even
        // when the bot does hold Manage Threads.
        canHavePrivateThreads: type === TEXT_CHANNEL_TYPE,
        ref,
      });
    }

    // Active threads come from ONE guild-wide call rather than one per channel.
    await this.collectActiveThreads(guildId, parents, channels, warnings);

    // Archived threads have no guild-wide endpoint, so this is per parent. It
    // is the expensive half of discovery and the half most worth doing: an
    // archived thread is usually where a chapter's actual decisions ended up.
    //
    // The private pass is behind a per-guild BREAKER, and that is not a
    // micro-optimisation. Discord gates the private endpoint on Manage
    // Threads, which this bot deliberately does not request, so on a read-only
    // install every one of those calls 403s — and `@discordjs/rest` counts a
    // 403 as an *invalid request*, against Discord's 10,000-per-10-minutes
    // Cloudflare ban budget. That budget belongs to the ONE token every
    // connected chapter shares, and a 200-channel guild scanned a few times
    // would spend it on calls we already know will fail. One probe answers the
    // question for the whole guild.
    const privateDenied: string[] = [];
    let privateRefused = false;

    for (const parent of parents) {
      const listed = await this.collectArchivedThreads(
        guildId,
        parent,
        'public',
        channels,
        warnings,
      );
      // Reading public archived threads needs exactly what reading history
      // does, so Discord's answer settles a channel whose access could not be
      // computed (the fallback when the roles or the bot's membership could
      // not be read), and overrides the arithmetic if the two ever disagree.
      // A refusal joins the one "cannot read" line below instead of adding a
      // warning per channel.
      if (listed === 'refused') {
        parent.ref.readable = false;
        unreadable.push(parent.name);
        continue;
      }
      if (listed === 'listed' && parent.ref.readable === null) {
        parent.ref.readable = true;
      }

      // Only text channels can hold private threads at all — announcement and
      // forum channels cannot, so asking is wasted even WITH the permission.
      if (!parent.canHavePrivateThreads) continue;

      if (privateRefused) {
        privateDenied.push(parent.name);
        continue;
      }
      const refused =
        (await this.collectArchivedThreads(
          guildId,
          parent,
          'private',
          channels,
          warnings,
        )) === 'refused';
      if (refused) {
        privateRefused = true;
        privateDenied.push(parent.name);
      }
    }

    // ONE warning naming every affected channel, rather than one per channel.
    // The per-channel version flooded a bounded warning list — a guild with
    // more than fifty channels kept nothing but this boilerplate and evicted
    // everything an admin actually needed to read.
    if (unreadable.length > 0) {
      warnings.push(
        `Frapp cannot read ${unreadable.length} channel(s) (${nameList(unreadable)}): Discord hides them from the bot. Allow the Frapp role on each of them (read-only; a category allow reaches only channels still synced to it), or give the Frapp bot a role that can see them, then scan again. Until then they can only be skipped.`,
      );
    }
    if (privateDenied.length > 0) {
      warnings.push(
        `Private archived threads cannot be read in ${privateDenied.length} channel(s) (${nameList(privateDenied)}): the Frapp bot is installed read-only, and Discord requires the "Manage Threads" permission to list them. Everything else in those channels, public archived threads included, will be imported.`,
      );
    }

    // A thread carries its parent's answers, because Discord computes a
    // public thread's access from its parent channel and the mapping step asks
    // only about parents. The exception is a PRIVATE thread, which Discord
    // shows only to its members whatever the parent allows: it stays private,
    // and the mapping treats the channel it lands in as private too.
    const byId = new Map(
      channels
        .filter((channel) => !channel.isThread)
        .map((channel) => [channel.id, channel]),
    );
    for (const channel of channels) {
      if (!channel.isThread || !channel.parentChannelId) continue;
      const parent = byId.get(channel.parentChannelId);
      channel.readable = parent?.readable ?? null;
      if (channel.privateInDiscord !== true) {
        channel.privateInDiscord = parent?.privateInDiscord ?? null;
      }
    }

    return { channels, warnings, roles: access.named };
  }

  /**
   * What discovery needs to compute access itself: the guild's roles, and the
   * bot's own roles in it.
   *
   * Each half degrades on its own. Without the roles nothing can be computed;
   * without the bot's membership, readability cannot, but "private in
   * Discord" (an `@everyone` question) still can. Neither failure stops the
   * scan: readability falls back to probing each channel. Unknown privacy is
   * told to the admin, because it means every new channel needs an explicit
   * choice of who can read it.
   */
  private async loadAccessContext(
    guildId: string,
    warnings: string[],
  ): Promise<{
    roles: DiscordRolePermissions[] | null;
    /**
     * The roles a chapter could map, highest first; empty on failure. Leaves
     * out `@everyone` (the whole server, which is what "public" means) and
     * managed roles: Discord makes one per bot and one for boosters, and none
     * of them is a position in the chapter. The Frapp bot's own role is one,
     * and it is allowed on every channel the bot was let into, so counting it
     * would name the bot as a reader of every private channel.
     */
    named: DiscordRoleRef[];
    subject: DiscordPermissionSubject | null;
    base: bigint;
  }> {
    const rest = this.client();
    let roles: DiscordRolePermissions[] | null = null;
    const named: DiscordRoleRef[] = [];
    try {
      const raw = (await rest.get(Routes.guildRoles(guildId))) as unknown[];
      roles = [];
      const ranked: { ref: DiscordRoleRef; position: number }[] = [];
      for (const entry of raw) {
        const role = asRecord(entry);
        const id = asString(role?.id);
        if (!id) continue;
        roles.push({ id, permissions: asString(role?.permissions) ?? '0' });
        if (id === guildId || role?.managed === true) continue;
        ranked.push({
          ref: { id, name: asString(role?.name) ?? id },
          position: typeof role?.position === 'number' ? role.position : 0,
        });
      }
      ranked.sort((a, b) => b.position - a.position);
      named.push(...ranked.map((entry) => entry.ref));
    } catch (error) {
      this.logger.warn(
        `Could not read roles for guild ${guildId}: ${this.describe(error)}. Channel access will be probed instead.`,
      );
      warnings.push(
        `Frapp could not read this server's roles (${this.describe(error)}), so it cannot tell which channels are private in Discord, and no roles are listed to map. Choose who can read each new channel, or scan again.`,
      );
      return { roles: null, named, subject: null, base: 0n };
    }

    try {
      const botUserId = await this.botUserId();
      const member = asRecord(
        await rest.get(Routes.guildMember(guildId, botUserId)),
      );
      const roleIds = Array.isArray(member?.roles)
        ? member.roles.filter((id): id is string => typeof id === 'string')
        : [];
      const subject = { userId: botUserId, roleIds };
      return {
        roles,
        named,
        subject,
        base: basePermissions(guildId, roles, subject),
      };
    } catch (error) {
      this.logger.warn(
        `Could not read the bot's membership in guild ${guildId}: ${this.describe(error)}. Channel readability will be probed instead.`,
      );
      return { roles, named, subject: null, base: 0n };
    }
  }

  /** The bot's own user id, read once per process. */
  private async botUserId(): Promise<string> {
    if (this.cachedBotUserId) return this.cachedBotUserId;
    const me = asRecord(await this.client().get(Routes.user()));
    const id = asString(me?.id);
    if (!id) throw new DiscordApiError('Discord returned no bot user id.');
    this.cachedBotUserId = id;
    return id;
  }

  private async collectActiveThreads(
    guildId: string,
    parents: { id: string; name: string }[],
    out: DiscordChannelRef[],
    warnings: string[],
  ): Promise<void> {
    const parentNames = new Map(parents.map((p) => [p.id, p.name]));
    try {
      const response = asRecord(
        await this.client().get(Routes.guildActiveThreads(guildId)),
      );
      const threads = Array.isArray(response?.threads) ? response.threads : [];
      for (const entry of threads) {
        const ref = this.toThreadRef(entry, guildId, parentNames);
        if (ref) out.push(ref);
      }
    } catch (error) {
      warnings.push(
        `Could not list active threads: ${this.describe(error)}. Their messages will not be imported.`,
      );
    }
  }

  /**
   * Walk one parent's archived threads.
   *
   * Returns `refused` when Discord answered 403, with no warning: for the
   * private listing that is the missing Manage Threads permission (the caller
   * trips a per-guild breaker rather than asking again for every remaining
   * channel), and for the public one a channel the bot cannot read. The
   * caller reports either once, for every channel it applies to. `failed` is
   * any other error, already warned about.
   */
  private async collectArchivedThreads(
    guildId: string,
    parent: { id: string; name: string },
    visibility: 'public' | 'private',
    out: DiscordChannelRef[],
    warnings: string[],
  ): Promise<'listed' | 'refused' | 'failed'> {
    const parentNames = new Map([[parent.id, parent.name]]);
    let before: string | null = null;

    for (let page = 0; page < MAX_ARCHIVED_THREAD_PAGES; page += 1) {
      let response: Record<string, unknown> | null;
      try {
        response = asRecord(
          await this.client().get(
            Routes.channelThreads(parent.id, visibility),
            { query: before ? new URLSearchParams({ before }) : undefined },
          ),
        );
      } catch (error) {
        // 403 is EXPECTED and is not a failure. On the private endpoint Discord
        // gates it on Manage Threads, which this bot deliberately does not ask
        // for (see DISCORD_BOT_PERMISSIONS); on the public one it means the
        // bot cannot read the channel. Either way the caller says exactly
        // what was skipped and why, once — a silent omission here is the
        // difference between "we archived your server" and "we archived most
        // of it".
        if (statusOf(error) === 403) return 'refused';
        warnings.push(
          `Could not list ${visibility} archived threads in #${parent.name}: ${this.describe(error)}. Their messages will not be imported.`,
        );
        return 'failed';
      }

      const threads = Array.isArray(response?.threads) ? response.threads : [];
      for (const entry of threads) {
        const ref = this.toThreadRef(entry, guildId, parentNames);
        if (ref) out.push(ref);
      }

      // `has_more` is Discord's own answer; an empty page is the backstop for a
      // response that omitted it.
      if (response?.has_more !== true || threads.length === 0) return 'listed';

      // The archived-thread cursor is a TIMESTAMP, not a snowflake — the list
      // is ordered by `archive_timestamp` descending, and paging it with an id
      // silently returns the same page forever.
      const last = asRecord(threads[threads.length - 1]);
      const metadata = asRecord(last?.thread_metadata);
      before = asString(metadata?.archive_timestamp);
      if (!before) return 'listed';

      if (page === MAX_ARCHIVED_THREAD_PAGES - 1) {
        warnings.push(
          `#${parent.name} has more archived ${visibility} threads than Frapp enumerates in one import (${MAX_ARCHIVED_THREAD_PAGES * 100}); the oldest will not be imported.`,
        );
      }
    }
    return 'listed';
  }

  private toThreadRef(
    entry: unknown,
    guildId: string,
    parentNames: ReadonlyMap<string, string>,
  ): DiscordChannelRef | null {
    const thread = asRecord(entry);
    if (!thread) return null;
    if (!THREAD_TYPES.has(thread.type as number)) return null;

    const id = asString(thread.id);
    if (!id) return null;

    const rowGuildId = asString(thread.guild_id);
    if (rowGuildId !== null && rowGuildId !== guildId) return null;

    const parentId = asString(thread.parent_id);
    // A thread with no parent cannot inherit a mapping decision, and this
    // product never gives a thread its own destination — so importing it would
    // mean guessing where it goes. Drop it rather than invent a target.
    if (!parentId) return null;

    const parentName = parentNames.get(parentId);
    if (!parentName) return null;

    const name = asString(thread.name) ?? id;
    return {
      id,
      name: `${parentName} › ${name}`,
      guildId,
      categoryName: parentName,
      parentChannelId: parentId,
      isThread: true,
      holdsOnlyThreads: false,
      // Filled from the parent once discovery has every parent in hand,
      // except that a private thread is private whatever its parent is.
      readable: null,
      privateInDiscord: thread.type === ChannelType.PrivateThread ? true : null,
      // A thread is mapped through its parent, whose readers are what count.
      readerRoleIds: null,
    };
  }

  // ── reading ───────────────────────────────────────────────────────────────

  async verifyChannelInGuild(
    channelId: string,
    guildId: string,
  ): Promise<DiscordChannelRef | null> {
    let raw: Record<string, unknown> | null;
    try {
      raw = asRecord(await this.client().get(Routes.channel(channelId)));
    } catch (error) {
      const status = statusOf(error);
      // Gone, or the bot lost access to it. Both are ordinary: a chapter can
      // delete a channel between mapping and import.
      if (status === 404 || status === 403) return null;
      throw error;
    }
    if (!raw) return null;

    const rowGuildId = asString(raw.guild_id);
    if (rowGuildId !== guildId) {
      // NOT a skip. A channel that exists but sits in another guild means the
      // one shared bot is about to read a tenant it was not authorized for.
      // The only safe outcome is to stop the whole import loudly.
      //
      // The message deliberately names NEITHER guild. It is persisted verbatim
      // to `discord_imports.error` and read back through `GET
      // /discord-imports/:id`, so an id in it turns this check into an oracle:
      // feed the route arbitrary snowflakes and the errors map channel → guild
      // and reveal which Discord servers other chapters have connected. The
      // operator detail goes to the log, which is not chapter-readable.
      this.logger.warn(
        `Refusing channel ${channelId}: Discord reports it in guild ${rowGuildId ?? 'unknown'}, not the authorized guild ${guildId}.`,
      );
      throw new DiscordApiError(
        'A channel in this import does not belong to the Discord server this chapter connected, so the import was stopped. Re-scan the server and try again.',
      );
    }

    const id = asString(raw.id);
    if (!id) return null;
    const parentId = asString(raw.parent_id);
    const isThread = THREAD_TYPES.has(raw.type as number);
    return {
      id,
      name: asString(raw.name) ?? id,
      guildId: rowGuildId,
      categoryName: null,
      parentChannelId: isThread ? parentId : null,
      isThread,
      // Re-derived here rather than stored on the row: the export asks this
      // before every message walk, and a channel's type is Discord's fact, not
      // ours to cache across a migration.
      holdsOnlyThreads: THREAD_PARENT_ONLY_TYPES.has(raw.type as number),
      // It was just read, so the bot can see it; whether @everyone can is not
      // asked here and does not matter to the export.
      readable: true,
      privateInDiscord: null,
      readerRoleIds: null,
    };
  }

  async fetchMessagePage(args: {
    channelId: string;
    guildId: string;
    before: string | null;
    limit?: number;
  }): Promise<unknown[]> {
    const limit = Math.min(
      args.limit ?? DISCORD_MESSAGE_PAGE_LIMIT,
      DISCORD_MESSAGE_PAGE_LIMIT,
    );
    const query = new URLSearchParams({ limit: String(limit) });
    if (args.before) query.set('before', args.before);

    const raw = (await this.client().get(
      Routes.channelMessages(args.channelId),
      { query },
    )) as unknown[];
    if (!Array.isArray(raw)) return [];

    // Every message must name the channel we asked for. Discord has no reason
    // to answer otherwise, which is exactly why a message that does is worth
    // refusing rather than importing: it is the shape a proxy or a
    // request-smuggling bug would take, and the blast radius is one chapter's
    // history landing in another's channel.
    for (const entry of raw) {
      const message = asRecord(entry);
      const channelId = asString(message?.channel_id);
      if (channelId !== null && channelId !== args.channelId) {
        throw new DiscordApiError(
          `Discord returned a message from channel ${channelId} while reading ${args.channelId}. Refusing to import it.`,
        );
      }
    }
    return raw;
  }

  private describe(error: unknown): string {
    const status = statusOf(error);
    const message = toReportableError(error).message;
    return status ? `${status} ${message}` : message;
  }
}

/** `#a, #b, #c, #d, #e and N more`, for a one-line warning. */
function nameList(names: readonly string[]): string {
  const shown = names
    .slice(0, 5)
    .map((name) => `#${name}`)
    .join(', ');
  return names.length > 5 ? `${shown} and ${names.length - 5} more` : shown;
}
