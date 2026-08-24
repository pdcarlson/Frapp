import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { REST } from '@discordjs/rest';
import { ChannelType, Routes } from 'discord-api-types/v10';
import {
  DISCORD_MESSAGE_PAGE_LIMIT,
  DiscordApiError,
  DiscordNotConfiguredError,
  type DiscordAttachmentStream,
  type DiscordChannelDiscovery,
  type DiscordChannelRef,
  type DiscordRoleRef,
  type IDiscordBotGateway,
} from '../../domain/adapters/discord.interface';

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
  ChannelType.GuildForum,
]);

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

/** Attachment fetches that hang must not hold a slice's whole budget. */
const ATTACHMENT_FETCH_TIMEOUT_MS = 30_000;

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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

  constructor(config: ConfigService) {
    const token = config.get<string>('DISCORD_BOT_TOKEN')?.trim();
    // Optional at boot, like the analytics and check-in secrets: local dev, CI
    // and any environment that has not registered a Discord application must
    // still start. Callers ask `isConfigured()` and answer 503; nothing here
    // throws on construction.
    this.rest = token ? new REST({ version: '10' }).setToken(token) : null;
    if (!token) {
      this.logger.log(
        'DISCORD_BOT_TOKEN is unset; the Discord bot import path is disabled.',
      );
    }
  }

  isConfigured(): boolean {
    return this.rest !== null;
  }

  private client(): REST {
    if (!this.rest) {
      throw new DiscordNotConfiguredError(
        'The Discord bot is not configured in this environment.',
      );
    }
    return this.rest;
  }

  // ── discovery ─────────────────────────────────────────────────────────────

  async discoverChannels(guildId: string): Promise<DiscordChannelDiscovery> {
    const rest = this.client();
    const warnings: string[] = [];

    const raw = (await rest.get(Routes.guildChannels(guildId))) as unknown[];

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
    const parents: { id: string; name: string }[] = [];

    for (const entry of raw) {
      const channel = asRecord(entry);
      if (!channel) continue;
      if (!READABLE_CHANNEL_TYPES.has(channel.type as number)) continue;

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
      channels.push({
        id,
        name,
        guildId,
        categoryName: parentId ? (categoryNames.get(parentId) ?? null) : null,
        parentChannelId: null,
        isThread: false,
      });
      parents.push({ id, name });
    }

    // Active threads come from ONE guild-wide call rather than one per channel.
    await this.collectActiveThreads(guildId, parents, channels, warnings);

    // Archived threads have no guild-wide endpoint, so this is per parent. It
    // is the expensive half of discovery and the half most worth doing: an
    // archived thread is usually where a chapter's actual decisions ended up.
    for (const parent of parents) {
      await this.collectArchivedThreads(
        guildId,
        parent,
        'public',
        channels,
        warnings,
      );
      await this.collectArchivedThreads(
        guildId,
        parent,
        'private',
        channels,
        warnings,
      );
    }

    return { channels, warnings };
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
        `Could not list active threads: ${this.describe(error)}. Their messages were not imported.`,
      );
    }
  }

  private async collectArchivedThreads(
    guildId: string,
    parent: { id: string; name: string },
    visibility: 'public' | 'private',
    out: DiscordChannelRef[],
    warnings: string[],
  ): Promise<void> {
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
        const status = statusOf(error);
        // 403 on the private endpoint is EXPECTED and is not a failure: Discord
        // gates it on Manage Threads, which this bot deliberately does not ask
        // for (see DISCORD_BOT_PERMISSIONS). Say exactly what was skipped and
        // why — a silent omission here is the difference between "we archived
        // your server" and "we archived most of it".
        if (status === 403 && visibility === 'private') {
          warnings.push(
            `Private archived threads in #${parent.name} could not be read: the Signet bot is installed read-only and Discord requires the "Manage Threads" permission to list them. Everything else in #${parent.name}, including public archived threads, was imported.`,
          );
          return;
        }
        warnings.push(
          `Could not list ${visibility} archived threads in #${parent.name}: ${this.describe(error)}. Their messages were not imported.`,
        );
        return;
      }

      const threads = Array.isArray(response?.threads) ? response.threads : [];
      for (const entry of threads) {
        const ref = this.toThreadRef(entry, guildId, parentNames);
        if (ref) out.push(ref);
      }

      // `has_more` is Discord's own answer; an empty page is the backstop for a
      // response that omitted it.
      if (response?.has_more !== true || threads.length === 0) return;

      // The archived-thread cursor is a TIMESTAMP, not a snowflake — the list
      // is ordered by `archive_timestamp` descending, and paging it with an id
      // silently returns the same page forever.
      const last = asRecord(threads[threads.length - 1]);
      const metadata = asRecord(last?.thread_metadata);
      before = asString(metadata?.archive_timestamp);
      if (!before) return;

      if (page === MAX_ARCHIVED_THREAD_PAGES - 1) {
        warnings.push(
          `#${parent.name} has more archived ${visibility} threads than Signet enumerates in one import (${MAX_ARCHIVED_THREAD_PAGES * 100}); the oldest were not imported.`,
        );
      }
    }
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
    };
  }

  async listRoles(guildId: string): Promise<DiscordRoleRef[]> {
    const raw = (await this.client().get(
      Routes.guildRoles(guildId),
    )) as unknown[];
    const roles: DiscordRoleRef[] = [];
    for (const entry of raw) {
      const role = asRecord(entry);
      const id = asString(role?.id);
      if (!id) continue;
      roles.push({ id, name: asString(role?.name) ?? id });
    }
    return roles;
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
      throw new DiscordApiError(
        `Channel ${channelId} belongs to Discord server ${rowGuildId ?? 'unknown'}, not to the server this chapter connected (${guildId}). Refusing to read it.`,
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

  // ── attachments ───────────────────────────────────────────────────────────

  /**
   * Open a CDN object for streaming.
   *
   * Plain `fetch`, not `@discordjs/rest`: the CDN is a different host, takes no
   * bot token, and is not rate-limited on the API's buckets — routing it
   * through the REST client would queue every attachment behind the message
   * reads it is supposed to run alongside.
   *
   * The body is handed back unread. Nothing in this process ever holds a whole
   * attachment: the caller pipes it straight into storage.
   */
  async openAttachment(url: string): Promise<DiscordAttachmentStream | null> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    // The URL comes out of a Discord API response, but it reaches `fetch` as a
    // string and this process can reach internal hosts. Pinning the scheme and
    // the host family is what keeps a malformed or hostile payload from turning
    // an attachment fetch into an SSRF against our own network.
    if (parsed.protocol !== 'https:') return null;
    if (!isDiscordCdnHost(parsed.hostname)) {
      this.logger.warn(
        `Refusing to fetch an attachment from a non-Discord host: ${parsed.hostname}`,
      );
      return null;
    }

    const response = await fetch(parsed, {
      redirect: 'error',
      signal: AbortSignal.timeout(ATTACHMENT_FETCH_TIMEOUT_MS),
    });

    if (!response.ok || !response.body) {
      // A deleted or expired attachment is a warning on one message, not a
      // failed import — the message itself still has its text.
      response.body?.cancel().catch(() => undefined);
      return null;
    }

    const contentLength = Number(response.headers.get('content-length'));
    return {
      body: response.body,
      contentType: response.headers.get('content-type'),
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
    };
  }

  private describe(error: unknown): string {
    const status = statusOf(error);
    const message = error instanceof Error ? error.message : String(error);
    return status ? `${status} ${message}` : message;
  }
}

/**
 * Hosts Discord serves attachments from.
 *
 * An allowlist rather than a `.discordapp.net` suffix test, because a suffix
 * test matches `cdn.discordapp.net.evil.com`. Subdomains of `discordapp.net`
 * are permitted explicitly (media proxies live there) via a dot-anchored
 * check, which `evil.com` cannot satisfy.
 */
function isDiscordCdnHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  const exact = [
    'cdn.discordapp.com',
    'media.discordapp.net',
    'images-ext-1.discordapp.net',
    'images-ext-2.discordapp.net',
  ];
  if (exact.includes(host)) return true;
  return host.endsWith('.discordapp.net') || host.endsWith('.discordapp.com');
}
