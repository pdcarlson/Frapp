import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as Sentry from '@sentry/nestjs';
import type {
  RealtimeChannel,
  RealtimePostgresInsertPayload,
} from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import { NotificationService } from '../../application/services/notification.service';
import { BurstBundler } from './burst-bundler';
import { ChatNotificationPreferenceRepository } from './chat-notification-preference.repository';
import { ChatPushDispatchRepository } from './chat-push-dispatch.repository';
import { decidePush } from './push-rules';
import {
  canAccessChannel,
  isAnnouncementChannel,
  isDirectChannel,
  SYSTEM_SENDER_ID,
} from '@repo/validation';
import { RbacService } from '../../application/services/rbac.service';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { ChatBlockService } from '../../application/services/chat-block.service';
import { ChannelCacheService } from './channel-cache.service';
import type { CachedChannelRow } from './channel-cache.service';
import { logThrowable } from '../../infrastructure/observability/log-throwable';

interface ChatMessageRow {
  id: string;
  channel_id: string;
  /** Null for a message with no Frapp user behind it (an imported archive row). */
  sender_id: string | null;
  content: string | null;
  kind: string;
  /**
   * `users.id[]` resolved server-side at send time (C1 of #937).
   *
   * Nullable defensively, not because the DB can produce null: the column is
   * `not null default '{}'`, so the migration backfilled every pre-existing
   * row. This shape only guards a payload arriving from somewhere that does
   * not set it.
   */
  mentions: string[] | null;
  created_at: string;
}

/** Alias kept local so the rest of this file reads in its own domain terms. */
type ChannelRow = CachedChannelRow;

/** What one message's fan-out did, for its span. */
interface FanOutOutcome {
  /** Members left after the read and block filters. */
  recipients: number;
  /** `notifyUser` calls that resolved. */
  sent: number;
}

/**
 * How long a dispatch claim is kept. It only has to outlive Realtime's delivery
 * of the same INSERT to every other instance, which is seconds; a day leaves
 * room for an instance whose socket reconnected late.
 */
export const CHAT_PUSH_CLAIM_RETENTION_MS = 24 * 60 * 60 * 1000;

/** The placeholder `ChatService.createGroupDm` names a group DM given no name. */
const UNNAMED_GROUP_DM = /^group-dm-\d+$/;

/**
 * Most presence channels one process keeps open (#2507).
 *
 * Every Realtime channel a process opens rides its one Supabase client, and
 * Supabase refuses a join past 100 channels per client. Two of them are the
 * workers' own subscriptions (`chat-push-worker:messages` here,
 * `chat-bridge-worker:audit-log`). The rest were one presence channel per chat
 * channel ever messaged, opened for the life of the process, so somewhere near
 * 98 active chat channels (roughly 8 to 12 chapters) every further join was
 * refused. `subscribe()` had no status callback, so nothing said so, and people
 * reading those channels were pushed their own conversation. 80 leaves room for
 * both worker channels and a third without re-deriving this number.
 */
export const MAX_PRESENCE_CHANNELS = 80;

/**
 * Longest gap between a message's `created_at` and this worker seeing it that
 * the fan-out span still measures from `created_at`. Beyond it (a redelivery
 * after a long reconnect, or a clock far off) the span starts on arrival
 * instead, so one stale row can't stretch ADR-09's p99.
 */
const FANOUT_START_MAX_AGE_MS = 10 * 60 * 1000;

/** Sentry reports for a refused or timed-out presence join, at most one per window. */
const PRESENCE_REPORT_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Where a fan-out span starts: the message's insert, unless that is unreadable,
 * in the future (a clock ahead of this one) or older than
 * {@link FANOUT_START_MAX_AGE_MS}, in which case it starts now.
 */
export function fanOutStartTime(createdAt: string, now: number): Date {
  const inserted = Date.parse(createdAt);
  const age = now - inserted;
  return age >= 0 && age <= FANOUT_START_MAX_AGE_MS
    ? new Date(inserted)
    : new Date(now);
}

/**
 * Push worker (ADR-09).
 *
 * Subscribes to Postgres Changes on `chat_messages` INSERT via service role.
 * Per message: resolves the channel (cached), loads recipients, narrows them to
 * those who may read the channel AND have not blocked the sender, asks the
 * Realtime Presence map who's currently in the channel, evaluates the push rule
 * chain per recipient, and fans out through `NotificationService.notifyUser`.
 *
 * **Both audience filters are disclosure boundaries, and they answer different
 * questions.** `filterCanReadChannel` asks "may this member read this channel";
 * `ChatBlockService.filterOutBlockers` asks "has this member blocked the
 * sender". The second is not implied by the first — a blocker and a blocked
 * member are usually in the same channels — and it is applied at the audience
 * level rather than by blanking the preview, so no push is sent and no
 * notification row is persisted.
 *
 * **One instance per message (#2846).** Realtime delivers every INSERT to every
 * API process, so each message is claimed in `chat_push_dispatches` before
 * anything is read, and only the instance whose insert wins fans it out. Two
 * instances (a scaled service, or a deploy's overlap) no longer send every
 * push, and persist every notification row, twice.
 *
 * Burst-bundling: 3+ messages from the same sender within 60s collapse
 * into a single bundled push per recipient. The bundler key is
 * `${senderId}:${channelId}:${recipientId}` so bursts in different channels
 * (and to different recipients) don't interact. The bundler is in-process, so
 * with more than one instance a burst's messages can be claimed by different
 * instances and bundle less. That costs extra pushes in a burst, never a
 * duplicate of one message.
 *
 * Sandbox note: the realtime subscription is opened on
 * `OnApplicationBootstrap`. Unit tests invoke `handleMessage` directly with
 * synthetic rows so the rule chain is exercised without Realtime.
 */
@Injectable()
export class ChatPushWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ChatPushWorkerService.name);
  private messagesChannel: RealtimeChannel | null = null;
  /**
   * Open presence channels by chat channel id, least recently used first:
   * `ensurePresenceChannel` re-inserts on every use, so eviction takes the
   * front.
   */
  private readonly presenceChannels = new Map<string, RealtimeChannel>();
  /**
   * Chat channel ids whose presence topic is still being freed. Until the
   * teardown lands, `supabase.channel()` would hand back the leaving instance
   * (`realtime-resilience` rule 1), so the topic isn't reopened meanwhile.
   */
  private readonly releasingPresence = new Set<string>();
  private lastPresenceReportAt = Number.NEGATIVE_INFINITY;
  private readonly bundler = new BurstBundler();

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    private readonly notificationService: NotificationService,
    private readonly prefRepo: ChatNotificationPreferenceRepository,
    private readonly dispatches: ChatPushDispatchRepository,
    private readonly rbac: RbacService,
    /**
     * Channel rows, cached to keep a hot channel from re-querying per message.
     * Shared with `ChatService` (see `ChannelCacheModule`), which evicts an
     * entry when its `updateChannel` write can change `member_ids` or
     * `required_permissions` — both are push-audience authorization inputs, not
     * display data, so a stale entry lets the worker decide from a permission
     * set or membership list that no longer applies. `ChannelCacheService`'s
     * TTL is a backstop for entries nothing invalidates, not the primary
     * correctness mechanism.
     */
    private readonly channelCache: ChannelCacheService,
    /**
     * Per-chapter blocks (#2257). The audience is narrowed by this as well as
     * by `filterCanReadChannel`: "can read the channel" and "has not blocked
     * the sender" are different questions, and only the first one was being
     * asked.
     */
    private readonly chatBlocks: ChatBlockService,
    /** The sender's display name, which every chat push now carries (#2771). */
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
  ) {}

  onApplicationBootstrap(): void {
    try {
      this.messagesChannel = this.supabase
        .channel('chat-push-worker:messages')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chat_messages',
          },
          (payload: RealtimePostgresInsertPayload<ChatMessageRow>) => {
            void this.handleMessage(payload.new);
          },
        )
        .subscribe((status) => {
          const s = status as string;
          if (s === 'SUBSCRIBED') {
            this.logger.log('chat-push subscribed to chat_messages');
          } else if (s === 'CHANNEL_ERROR' || s === 'CLOSED') {
            this.logger.warn(`chat-push channel state: ${s}`);
          }
        });
    } catch (err) {
      logThrowable(
        this.logger,
        'error',
        'chat-push failed to start; chat pushes will not fire',
        err,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.messagesChannel) {
      try {
        await this.supabase.removeChannel(this.messagesChannel);
      } catch (err) {
        logThrowable(
          this.logger,
          'warn',
          'chat-push: error removing messages channel',
          err,
        );
      }
      this.messagesChannel = null;
    }
    // Let go of every presence channel before removing any, so each leave's
    // `CLOSED` echo reads as this worker's own (see `onPresenceStatus`), not a
    // server close to log and release a second time.
    const presence = [...this.presenceChannels.values()];
    this.presenceChannels.clear();
    for (const ch of presence) {
      try {
        await this.supabase.removeChannel(ch);
      } catch (err) {
        logThrowable(
          this.logger,
          'warn',
          'chat-push: error removing presence channel',
          err,
        );
      }
    }
  }

  /**
   * Drop dispatch claims older than {@link CHAT_PUSH_CLAIM_RETENTION_MS}.
   *
   * Hourly, on every instance: a delete is idempotent, so the instance that
   * runs second finds nothing. Caught here because an unhandled rejection out
   * of a `@Cron` takes the process down; a failed purge costs one tick.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleDispatchClaimPurge(): Promise<void> {
    await this.purgeDispatchClaims(new Date());
  }

  /** The purge with an injectable clock. Exposed for unit tests. */
  async purgeDispatchClaims(now: Date): Promise<void> {
    try {
      const purged = await this.dispatches.purgeBefore(
        new Date(now.getTime() - CHAT_PUSH_CLAIM_RETENTION_MS),
      );
      if (purged > 0) {
        this.logger.log(`chat-push: purged ${purged} expired dispatch claims`);
      }
    } catch (err) {
      logThrowable(
        this.logger,
        'error',
        'chat-push: dispatch claim purge failed; retrying next hour',
        err,
      );
    }
  }

  /**
   * Process a single inserted message. Exposed for unit tests.
   */
  async handleMessage(row: ChatMessageRow): Promise<void> {
    if (!row?.id || !row.channel_id) return;

    // An imported archive message never notifies anyone. Importing a chapter's
    // #announcements history must not page the whole roster once per historical
    // message.
    //
    // This exit is deliberately EARLIER than the `system_audit` one, which lives
    // downstream in `decidePush` (push-rules.ts). The difference is volume:
    // `system_audit` is one row per admin action, so paying for a channel
    // resolve, a full chapter roster load and a per-recipient preference lookup
    // before deciding costs nothing. An import is thousands of rows arriving as
    // fast as Postgres can write them, through a Realtime handler with no
    // backpressure — deciding downstream would mean thousands of roster loads.
    //
    // `decidePush` still refuses this kind too (belt and braces, and it is what
    // a reader auditing the rules will find), but nothing should ever reach it.
    if (row.kind === 'imported') return;

    try {
      // Join the channel's presence before the claim, on every instance.
      // Presence is what suppresses a push to someone already reading the
      // channel, and a subscription only knows the roster once it has synced.
      // Opened only by the instance that wins, each instance's first win in a
      // channel would read an empty roster and push people who are looking at
      // it; opened here, every instance is warm from the channel's first
      // message, as it was when every instance sent everything.
      this.ensurePresenceChannel(row.channel_id);

      // Claimed before any read, so the instance that loses spends one insert
      // on the message rather than a roster load. Only `claimed` sends:
      // `taken` is another instance's, `gone` was deleted before its push, and
      // `failed` is logged in the repository and skipped rather than risked.
      const claim = await this.dispatches.claim(row.id);
      if (claim !== 'claimed') return;

      await this.traceFanOut(row, () => this.fanOut(row));
    } catch (err) {
      logThrowable(
        this.logger,
        'warn',
        `chat-push: unexpected error for message ${row.id}`,
        err,
      );
    }
  }

  /**
   * One claimed message's fan-out as its own Sentry transaction (#2507).
   *
   * ADR-09's scaling watermark is p99 fan-out above one second, and nothing
   * measured it. The span runs from the row's `created_at`, the insert, to the
   * last `notifyUser`, so it includes Realtime's delivery lag and the claim as
   * well as the work here. `startNewTrace` gives each message its own trace:
   * this runs in the Realtime socket's callback, outside any request, and would
   * otherwise inherit whichever trace was current when the socket was opened.
   *
   * The attributes are counts only, and each is on the scrubber's span
   * allowlist (`@repo/observability`), which drops any key it doesn't name.
   * `chat.push.presence_channels` is the open presence-channel gauge, sampled
   * with every traced fan-out rather than sent through `Sentry.metrics`, whose
   * pipeline no allowlist scrubber here covers.
   */
  private traceFanOut(
    row: ChatMessageRow,
    fanOut: () => Promise<FanOutOutcome>,
  ): Promise<void> {
    return Sentry.startNewTrace(() =>
      Sentry.startSpan(
        {
          name: 'chat.push.fanout',
          op: 'chat.push',
          forceTransaction: true,
          startTime: fanOutStartTime(row.created_at, Date.now()),
          attributes: {
            'chat.push.presence_channels': this.presenceChannels.size,
          },
        },
        async (span) => {
          const outcome = await fanOut();
          span.setAttributes({
            'chat.push.recipients': outcome.recipients,
            'chat.push.sent': outcome.sent,
          });
        },
      ),
    );
  }

  /**
   * Everything after the claim: resolve the audience, decide per recipient,
   * send. Returns how many were in the audience and how many were pushed.
   */
  private async fanOut(row: ChatMessageRow): Promise<FanOutOutcome> {
    const outcome = { recipients: 0, sent: 0 };
    const channel = await this.resolveChannel(row.channel_id);
    if (!channel) return outcome;

    const members = await this.memberRepo.findByChapter(channel.chapter_id);
    const candidateIds = members
      .map((m) => m.user_id)
      .filter((uid): uid is string => !!uid && uid !== row.sender_id);
    if (candidateIds.length === 0) return outcome;

    // Narrow the chapter roster to people who may actually READ this channel.
    //
    // This is a disclosure boundary, not an optimisation. The push payload
    // carries a 200-character preview of the body and `notifyUser` also
    // persists a notification row, so notifying a non-member hands them the
    // content of a channel they cannot open. It matters most for a mention:
    // `decidePush` returns 'send' on `hasMention` *before* the level check
    // (`push-rules.ts`), so a mention overrides even an explicit `off`.
    //
    // Until C1 this was inert rather than safe — `hasMention` was always
    // false because the worker read a `mentions` field that did not exist —
    // so resolving mentions for real is exactly what would have turned a
    // latent chapter-wide fan-out into a real one.
    const readerIds = await this.filterCanReadChannel(channel, candidateIds);
    if (readerIds.length === 0) return outcome;

    // Then drop anyone who has blocked the sender (#2257,
    // `spec/behavior/chat/README.md` § Report and block).
    //
    // **At the audience level, not by blanking the preview.** A push is the
    // one delivery that reaches past every client-side list: it lands on a
    // lock screen and `notifyUser` persists a notification row, so masking
    // the body would still buzz the blocker's phone every time the member
    // they blocked posts, and still leave a row in their notification list.
    // Removing them here means neither exists.
    //
    // It has to be here and not inside the loop below, because a mention is
    // the sharpest case: `decidePush` returns 'send' on `hasMention` BEFORE
    // the level check, so a blocked member can force a push through a channel
    // the blocker deliberately muted. The block has to win over that, and the
    // only way it can is by the recipient not being in the audience at all.
    //
    // **Fails closed by throwing.** This sits inside `handleMessage`'s
    // try/catch, so an unreadable block list costs this message its
    // notifications for everybody — the conservative side. Degrading to the
    // unfiltered audience would deliver a blocked member's content to the
    // blocker for as long as the table was unreachable, silently.
    const recipientIds = await this.chatBlocks.filterOutBlockers(
      channel.chapter_id,
      row.sender_id,
      readerIds,
    );
    outcome.recipients = recipientIds.length;
    if (recipientIds.length === 0) return outcome;

    const presenceMap = this.readPresence(channel.id);
    const senderPreview = row.content?.slice(0, 200) ?? '';
    // `chat_messages.mentions` is a `users.id[]` resolved by the API at send
    // time. Until C1 this read went through a structural cast over a column
    // that had never existed and was typed as a map, so it resolved to `{}`
    // on every message and the mentions tier had never fired for anyone.
    // A missing array still means "no mentions". The column is NOT NULL with
    // a default, so this guards a malformed payload, not a historical row.
    const mentions = row.mentions ?? [];

    // One batched read for the whole audience, not one per recipient. This
    // loop used to `await` a preference lookup per member, so a 150-member
    // channel issued ~150 queries per message on a path with no
    // backpressure. A user with no stored preferences is simply absent from
    // the map, which is what the per-user read's empty array meant.
    const prefsByUser = await this.prefRepo.findForUsers(
      recipientIds,
      channel.chapter_id,
    );

    // Read once, and only once a recipient is actually getting a push: most
    // messages in a `mentions` channel push nobody.
    let senderName: Promise<string | null> | null = null;

    for (const recipientId of recipientIds) {
      const prefs = prefsByUser.get(recipientId) ?? [];
      const decision = decidePush({
        channel,
        messageKind: row.kind,
        recipientIsPresent: presenceMap.has(recipientId),
        hasMention: mentions.includes(recipientId),
        preferences: prefs,
      });
      if (decision !== 'send') continue;

      // `sender_id` may be null; `String()` keeps the key well-formed rather than
      // interpolating `undefined`. Imported rows never get this far (see the
      // early exit in `handleMessage`), so the null arm is only reachable for a
      // future null-sender kind.
      const bundleKey = `${row.sender_id ?? 'none'}:${channel.id}:${recipientId}`;
      const burst = this.bundler.record(bundleKey);
      if (burst.action === 'skip') continue;

      senderName ??= this.resolveSenderName(row.sender_id);
      const payload = this.buildPayload(
        channel,
        senderPreview,
        burst,
        await senderName,
      );
      try {
        await this.notificationService.notifyUser(
          recipientId,
          channel.chapter_id,
          payload,
        );
        outcome.sent += 1;
      } catch (err) {
        logThrowable(
          this.logger,
          'warn',
          `chat-push: notify failed for recipient ${recipientId}`,
          err,
        );
      }
    }
    return outcome;
  }

  /**
   * Reduce candidates to those allowed to `read` the channel, via the shared
   * `canAccessChannel` predicate — the same one the chat and poll surfaces
   * authorize through, so the push audience cannot drift from the read
   * audience.
   *
   * Permissions are fetched only for a ROLE_GATED channel, and only then per
   * candidate; PUBLIC short-circuits and DM/GROUP_DM/PRIVATE are decided by
   * `member_ids` alone.
   */
  private async filterCanReadChannel(
    channel: ChannelRow,
    candidateIds: string[],
  ): Promise<string[]> {
    const shape = {
      id: channel.id,
      type: channel.type,
      member_ids: channel.member_ids,
      required_permissions: channel.required_permissions,
    };

    if (shape.type === 'PUBLIC') return candidateIds;

    // Only ROLE_GATED needs permissions, and then one lookup per candidate.
    // Resolved concurrently: awaiting inside the loop made a single message
    // into a role-gated channel cost one sequential round trip per member,
    // on a realtime handler with no backpressure.
    const permissionsByUser = new Map<string, string[] | null>();
    if (shape.type === 'ROLE_GATED') {
      const resolved = await Promise.all(
        candidateIds.map(async (userId) => {
          try {
            return [
              userId,
              await this.rbac.getEffectivePermissions(
                channel.chapter_id,
                userId,
              ),
            ] as const;
          } catch (err) {
            // Fail closed: an unresolved permission set must not become a push.
            logThrowable(
              this.logger,
              'warn',
              `chat-push: permission lookup failed for ${userId}; skipping`,
              err,
            );
            return [userId, null] as const;
          }
        }),
      );
      for (const [userId, permissions] of resolved) {
        permissionsByUser.set(userId, permissions);
      }
    }

    const allowed: string[] = [];
    for (const userId of candidateIds) {
      const permissions =
        shape.type === 'ROLE_GATED' ? permissionsByUser.get(userId) : [];
      if (permissions == null) continue;
      if (
        canAccessChannel({
          channel: shape,
          userId,
          isChapterMember: true,
          permissions,
          operation: 'read',
        })
      ) {
        allowed.push(userId);
      }
    }
    return allowed;
  }

  private async resolveChannel(channelId: string): Promise<ChannelRow | null> {
    const cached = this.channelCache.get(channelId);
    if (cached) return cached;
    // Captured before the read starts, not after it resolves: an `UPDATE`
    // (and its `invalidate()`) can land on this channel while the `SELECT`
    // below is in flight. Passing this epoch to `set` below lets it detect
    // that case and discard the now-stale result instead of re-caching it.
    const epoch = this.channelCache.getEpoch(channelId);
    const { data, error } = await this.supabase
      .from('chat_channels')
      .select(
        'id, chapter_id, name, is_read_only, type, member_ids, required_permissions, default_notification_level',
      )
      .eq('id', channelId)
      .maybeSingle();
    if (error || !data) {
      if (error) {
        logThrowable(
          this.logger,
          'warn',
          'chat-push: channel lookup failed',
          error,
        );
      }
      return null;
    }
    const row: ChannelRow = data;
    this.channelCache.set(channelId, row, epoch);
    return row;
  }

  /**
   * Open a presence subscription on the same `chat:channel:<id>` topic the web
   * client uses (ADR-10), so `readPresence` can tell who is in the channel.
   * Once per channel per instance while it stays open; `handleMessage` calls it
   * for every message, won or not (#2846).
   *
   * At most {@link MAX_PRESENCE_CHANNELS} stay open. Opening one more closes
   * the channel whose last message is oldest. A message in a channel that was
   * closed that way reopens it, and that one message reads an empty roster
   * (its first message always did), so the cost of an eviction is at most one
   * extra push per person reading, never a missed one.
   */
  private ensurePresenceChannel(channelId: string): void {
    const open = this.presenceChannels.get(channelId);
    if (open) {
      this.presenceChannels.delete(channelId);
      this.presenceChannels.set(channelId, open);
      return;
    }
    // Still being freed after an eviction or a close: reopening now would get
    // the leaving instance back. This message goes without a roster, like a
    // first message; the next one opens a fresh channel.
    if (this.releasingPresence.has(channelId)) return;

    while (this.presenceChannels.size >= MAX_PRESENCE_CHANNELS) {
      const [oldestId, oldest] = this.presenceChannels.entries().next()
        .value as [string, RealtimeChannel];
      this.dropPresenceChannel(oldestId, oldest);
    }

    let ch: RealtimeChannel | undefined;
    try {
      // chat-core's realtime-manager config, `private: true` included
      // (#1552): the service-role client bypasses realtime.messages RLS so the
      // join always succeeds, but private and public are separate rooms — a
      // worker on the public room sees an empty roster while every client is
      // private, and suppresses nothing.
      //
      // Plus `presence.enabled`, which only this side needs (#2974).
      // realtime-js asks the server for the roster only when the channel has
      // a presence listener or sets `enabled: true`. The clients have neither
      // and don't need to: `track()` publishes their own presence regardless.
      // The worker is the one reader, and without the flag it joined with
      // presence off, `presenceState()` stayed `{}`, and nobody reading a
      // channel was spared a push. Checked against local Realtime on
      // 2026-09-30 (realtime-js 2.117): `{}` without the flag, the tracked
      // member with it.
      const opened = this.supabase.channel(`chat:channel:${channelId}`, {
        config: {
          private: true,
          broadcast: { self: false },
          presence: { key: '', enabled: true },
        },
      });
      ch = opened;
      // Registered before `subscribe()`, so a status that arrives at once
      // finds it.
      this.presenceChannels.set(channelId, opened);
      opened.subscribe((status: string, err?: Error) =>
        this.onPresenceStatus(channelId, opened, status, err),
      );
    } catch (err) {
      logThrowable(
        this.logger,
        'warn',
        `chat-push: failed to open presence channel for ${channelId}`,
        err,
      );
      if (ch) this.dropPresenceChannel(channelId, ch);
    }
  }

  /**
   * A presence channel's subscribe status (#2507).
   *
   * `CHANNEL_ERROR` and `TIMED_OUT` are the join being refused or never
   * answered: a channel over Supabase's per-client limit is refused that way,
   * and so is every channel while the socket is down. Both are logged and
   * reported, and the channel is kept: `realtime-js` retries the join itself
   * and the roster reads empty until it lands, which costs extra pushes, never
   * a missed one. `CLOSED` on a channel this worker still holds is the server
   * ending it, which nothing retries, so it is dropped and the channel's next
   * message reopens it.
   *
   * A status from a channel this worker already let go of (evicted, dropped,
   * shut down) is its own teardown echoing back, and is ignored.
   */
  private onPresenceStatus(
    channelId: string,
    ch: RealtimeChannel,
    status: string,
    err?: Error,
  ): void {
    if (status === 'SUBSCRIBED') return;
    if (this.presenceChannels.get(channelId) !== ch) return;
    if (status === 'CLOSED') {
      this.logger.warn(
        `chat-push: presence channel for ${channelId} was closed; its next message reopens it`,
      );
      this.dropPresenceChannel(channelId, ch);
      return;
    }
    this.logger.warn(
      `chat-push: presence join ${status} for ${channelId} (${this.presenceChannels.size} open); pushes there ignore who is reading until it joins${err ? `: ${err.message}` : ''}`,
    );
    this.reportPresenceRefusal(status);
  }

  /**
   * Sentry hears about a refused or timed-out join at most once per
   * {@link PRESENCE_REPORT_INTERVAL_MS}: a dropped socket fails every open
   * channel at once, and one event says as much as eighty.
   */
  private reportPresenceRefusal(status: string): void {
    const now = Date.now();
    if (now - this.lastPresenceReportAt < PRESENCE_REPORT_INTERVAL_MS) return;
    this.lastPresenceReportAt = now;
    try {
      Sentry.captureMessage('chat-push presence join failed', {
        level: 'warning',
        tags: {
          realtime_status: status,
          presence_channels: String(this.presenceChannels.size),
        },
        fingerprint: ['chat-push-presence-join', status],
      });
    } catch (error) {
      // The warning above already carries it.
      logThrowable(
        this.logger,
        'warn',
        'chat-push: Sentry report failed for a presence join',
        error,
      );
    }
  }

  /**
   * Forget a presence channel and free its topic.
   *
   * `unsubscribe()` and then an unconditional `teardown()`: `removeChannel()`
   * only tears down when the leave is acknowledged `ok`, and a channel left
   * registered hands itself back to the next `supabase.channel()` on its topic
   * (`realtime-resilience` rule 1). That is chat-core's `releaseTopic`, which
   * this process can't import: chat-core ships TypeScript source for the
   * bundler-built clients, and the API's compiled output can't load it.
   */
  private dropPresenceChannel(channelId: string, ch: RealtimeChannel): void {
    if (this.presenceChannels.get(channelId) === ch) {
      this.presenceChannels.delete(channelId);
    }
    this.releasingPresence.add(channelId);
    void (async () => {
      try {
        await ch.unsubscribe();
      } catch {
        // Already gone, or the socket is down; the teardown is what counts.
      }
      try {
        ch.teardown();
      } catch {
        // Already torn down.
      }
    })().finally(() => this.releasingPresence.delete(channelId));
  }

  /**
   * Read the Realtime Presence state for a channel. Returns a set of user
   * ids currently tracked on the topic (see ADR-10). On any failure (no
   * subscription yet, malformed payload) returns an empty set — false
   * negatives are acceptable; the worst case is one extra push.
   */
  private readPresence(channelId: string): Set<string> {
    const ch = this.presenceChannels.get(channelId);
    if (!ch) return new Set();
    try {
      const state = ch.presenceState() as Record<
        string,
        Array<{ userId?: unknown }>
      >;
      const out = new Set<string>();
      for (const entries of Object.values(state)) {
        for (const entry of entries) {
          if (typeof entry?.userId === 'string') out.add(entry.userId);
        }
      }
      return out;
    } catch (err) {
      this.logger.debug(
        `chat-push: presenceState read failed for ${channelId}`,
        err,
      );
      return new Set();
    }
  }

  /**
   * The sender's display name, or `null` when there is nothing worth showing:
   * no sender, a blank name, or a lookup that failed. A failed lookup costs the
   * name, never the push, so it is logged and swallowed.
   */
  private async resolveSenderName(
    senderId: string | null,
  ): Promise<string | null> {
    // The system actor ("Frapp System") posts the audit bridge, poll-expiry
    // notices and invite-accept DMs. #2771 kept their handling as it was, so
    // they keep the titles they had rather than naming a sender nobody is.
    if (!senderId || senderId === SYSTEM_SENDER_ID) return null;
    try {
      const [identity] = await this.userRepo.findDisplayIdentitiesByIds([
        senderId,
      ]);
      const name = identity?.display_name?.trim();
      return name ? name : null;
    } catch (err) {
      logThrowable(
        this.logger,
        'warn',
        `chat-push: sender name lookup failed for ${senderId}; pushing without it`,
        err,
      );
      return null;
    }
  }

  private buildPayload(
    channel: ChannelRow,
    preview: string,
    burst: ReturnType<BurstBundler['record']>,
    senderName: string | null,
  ) {
    // One predicate for the title, the priority and the category, bundled or
    // not. A burst of announcements is still announcements: it used to go out
    // as a NORMAL `chat` push, under the member's Chat switch rather than its
    // own, which only went unnoticed while `ChatService` pushed every
    // announcement a second time.
    const isAnnouncement = this.isAnnouncementPush(channel);
    const shared = {
      title: this.titleFor(channel, isAnnouncement, senderName),
      category: isAnnouncement ? 'announcements' : 'chat',
      priority: isAnnouncement ? ('URGENT' as const) : ('NORMAL' as const),
    };
    if (burst.action === 'bundle') {
      return {
        ...shared,
        body: `${burst.count} new messages`,
        data: {
          target: { screen: 'chat', channelId: channel.id },
          bundled: true,
          count: burst.count,
        },
      };
    }
    return {
      ...shared,
      body: preview,
      data: { target: { screen: 'chat', channelId: channel.id } },
    };
  }

  /**
   * Whether this push is an announcement, for the title, the priority *and*
   * the category alike, from one predicate so the three cannot disagree (a
   * mismatch once let URGENT pushes escape the member's Chat switch, #1041).
   *
   * **The channel decides, never the message's `kind`.** `kind` comes from the
   * client (`SendMessageDto.kind`), and `ChatService.sendMessage` accepts
   * `announcement` from any member in any channel it may post in, so trusting
   * it let a member without `announcements:post` send an URGENT push that skips
   * quiet hours to everyone at `all` in #general, or in any DM (#2771 review).
   * Only an announcements channel (`isAnnouncementChannel`: PUBLIC, read-only,
   * so only `announcements:post` holders write there) makes one.
   *
   * The channel's name is still load-bearing here; narrowing it is #1323.
   */
  private isAnnouncementPush(channel: ChannelRow): boolean {
    return isAnnouncementChannel(channel);
  }

  /**
   * Every title names the sender when there is a name to give (#2771), bundled
   * or not, the way a messenger's lock-screen push does. Without one, each
   * falls back to the wording a single push had before. A bundle takes the
   * same title as a single push either way; its body carries the count.
   *
   * A DM's `name` is `dm-<uuid>-<uuid>` and an unnamed group DM's is
   * `group-dm-<timestamp>`, both internal, so neither ever reaches a title.
   */
  private titleFor(
    channel: ChannelRow,
    isAnnouncement: boolean,
    senderName: string | null,
  ): string {
    if (isAnnouncement) {
      return senderName
        ? `Announcement from ${senderName}`
        : 'New Announcement';
    }
    if (isDirectChannel(channel)) {
      const groupName =
        channel.type === 'GROUP_DM' && !UNNAMED_GROUP_DM.test(channel.name)
          ? channel.name
          : null;
      if (senderName) {
        return groupName ? `${senderName} in ${groupName}` : senderName;
      }
      return groupName ?? 'New Message';
    }
    return senderName
      ? `${senderName} in #${channel.name}`
      : `New message in #${channel.name}`;
  }

  // ── Internal test helpers ─────────────────────────────────────────────
  /** Cache a channel row in tests so `handleMessage` skips the DB lookup. */
  __setChannelForTest(channel: ChannelRow): void {
    this.channelCache.set(
      channel.id,
      channel,
      this.channelCache.getEpoch(channel.id),
    );
  }
  /** Seed a presence map for tests. */
  __setPresenceForTest(channelId: string, userIds: string[]): void {
    const fake = {
      presenceState: () => ({
        anon: userIds.map((id) => ({ userId: id })),
      }),
    };
    this.presenceChannels.set(channelId, fake as unknown as RealtimeChannel);
  }
}
