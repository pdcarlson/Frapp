import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type {
  RealtimeChannel,
  RealtimePostgresInsertPayload,
} from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { NotificationService } from '../../application/services/notification.service';
import { BurstBundler } from './burst-bundler';
import { ChatNotificationPreferenceRepository } from './chat-notification-preference.repository';
import { decidePush } from './push-rules';
import { canAccessChannel } from '@repo/validation';
import { RbacService } from '../../application/services/rbac.service';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';

/** How long a cached channel row may inform an authorization decision. */
const CHANNEL_CACHE_TTL_MS = 30_000;

interface ChatMessageRow {
  id: string;
  channel_id: string;
  sender_id: string;
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

interface ChannelRow {
  id: string;
  chapter_id: string;
  name: string;
  is_read_only: boolean | null;
  /** Needed to decide who may read this channel — see `handleMessage`. */
  type: string;
  member_ids: string[] | null;
  required_permissions: string[] | null;
}

/**
 * Push worker (ADR-09).
 *
 * Subscribes to Postgres Changes on `chat_messages` INSERT via service role.
 * Per message: resolves the channel (cached), loads recipients, asks the
 * Realtime Presence map who's currently in the channel, evaluates the push
 * rule chain per recipient, and fans out through `NotificationService.notifyUser`.
 *
 * Burst-bundling: 3+ messages from the same sender within 60s collapse
 * into a single bundled push per recipient. The bundler key is
 * `${senderId}:${channelId}:${recipientId}` so bursts in different channels
 * (and to different recipients) don't interact.
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
  private readonly presenceChannels = new Map<string, RealtimeChannel>();
  private readonly bundler = new BurstBundler();
  /**
   * Channel rows, cached to keep a hot channel from re-querying per message.
   *
   * Entries expire, and the TTL is load-bearing rather than tidiness: this row
   * now carries `member_ids` and `required_permissions`, which are the inputs
   * to the push audience decision. `required_permissions` is mutable at runtime
   * (`PATCH /v1/channels/:id`), and the read path re-reads the channel on every
   * request — so an unbounded cache would let an admin tighten a ROLE_GATED
   * channel, lock people out of reading it, and have the worker keep pushing
   * them its content until the process restarted. A short TTL bounds that
   * divergence to the window below instead of "forever".
   */
  private readonly channelCache = new Map<
    string,
    { row: ChannelRow; expiresAt: number }
  >();

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    private readonly notificationService: NotificationService,
    private readonly prefRepo: ChatNotificationPreferenceRepository,
    private readonly rbac: RbacService,
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
      this.logger.error(
        'chat-push failed to start; chat pushes will not fire',
        err as Error,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.messagesChannel) {
      try {
        await this.supabase.removeChannel(this.messagesChannel);
      } catch (err) {
        this.logger.warn('chat-push: error removing messages channel', err);
      }
      this.messagesChannel = null;
    }
    for (const ch of this.presenceChannels.values()) {
      try {
        await this.supabase.removeChannel(ch);
      } catch (err) {
        this.logger.warn('chat-push: error removing presence channel', err);
      }
    }
    this.presenceChannels.clear();
  }

  /**
   * Process a single inserted message. Exposed for unit tests.
   */
  async handleMessage(row: ChatMessageRow): Promise<void> {
    if (!row?.id || !row.channel_id) return;
    try {
      const channel = await this.resolveChannel(row.channel_id);
      if (!channel) return;

      const members = await this.memberRepo.findByChapter(channel.chapter_id);
      const candidateIds = members
        .map((m) => m.user_id)
        .filter((uid): uid is string => !!uid && uid !== row.sender_id);
      if (candidateIds.length === 0) return;

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
      const recipientIds = await this.filterCanReadChannel(
        channel,
        candidateIds,
      );
      if (recipientIds.length === 0) return;

      const presenceMap = this.readPresence(channel.id);
      const senderPreview = row.content?.slice(0, 200) ?? '';
      // `chat_messages.mentions` is a `users.id[]` resolved by the API at send
      // time. Until C1 this read went through a structural cast over a column
      // that had never existed and was typed as a map, so it resolved to `{}`
      // on every message and the mentions tier had never fired for anyone.
      // A missing array still means "no mentions". The column is NOT NULL with
      // a default, so this guards a malformed payload, not a historical row.
      const mentions = row.mentions ?? [];

      for (const recipientId of recipientIds) {
        const prefs = await this.prefRepo.findForUser(
          recipientId,
          channel.chapter_id,
        );
        const decision = decidePush(
          {
            channelName: channel.name,
            messageKind: row.kind,
            recipientIsPresent: presenceMap.has(recipientId),
            hasMention: mentions.includes(recipientId),
            preferences: prefs,
          },
          channel.id,
        );
        if (decision !== 'send') continue;

        const bundleKey = `${row.sender_id}:${channel.id}:${recipientId}`;
        const burst = this.bundler.record(bundleKey);
        if (burst.action === 'skip') continue;

        const payload = this.buildPayload(channel, row, senderPreview, burst);
        try {
          await this.notificationService.notifyUser(
            recipientId,
            channel.chapter_id,
            payload,
          );
        } catch (err) {
          this.logger.warn(
            `chat-push: notify failed for recipient ${recipientId}`,
            err,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `chat-push: unexpected error for message ${row.id}`,
        err,
      );
    }
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
            this.logger.warn(
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
    if (cached && cached.expiresAt > Date.now()) return cached.row;
    const { data, error } = await this.supabase
      .from('chat_channels')
      .select(
        'id, chapter_id, name, is_read_only, type, member_ids, required_permissions',
      )
      .eq('id', channelId)
      .maybeSingle();
    if (error || !data) {
      if (error) this.logger.warn('chat-push: channel lookup failed', error);
      return null;
    }
    const row: ChannelRow = data;
    this.channelCache.set(channelId, {
      row,
      expiresAt: Date.now() + CHANNEL_CACHE_TTL_MS,
    });
    // Open a presence subscription on the same `chat:channel:<id>` topic the
    // web client uses (ADR-10) so we can read who's currently in the channel.
    this.ensurePresenceChannel(row.id);
    return row;
  }

  private ensurePresenceChannel(channelId: string): void {
    if (this.presenceChannels.has(channelId)) return;
    try {
      const ch = this.supabase.channel(`chat:channel:${channelId}`, {
        config: { broadcast: { self: false }, presence: { key: '' } },
      });
      ch.subscribe();
      this.presenceChannels.set(channelId, ch);
    } catch (err) {
      this.logger.warn(
        `chat-push: failed to open presence channel for ${channelId}`,
        err,
      );
    }
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

  private buildPayload(
    channel: ChannelRow,
    row: ChatMessageRow,
    preview: string,
    burst: ReturnType<BurstBundler['record']>,
  ) {
    if (burst.action === 'bundle') {
      return {
        title: `New messages in #${channel.name}`,
        body: `${burst.count} new messages`,
        category: 'chat',
        priority: 'NORMAL' as const,
        data: {
          target: { screen: 'chat', channelId: channel.id },
          bundled: true,
          count: burst.count,
        },
      };
    }
    const title = this.titleFor(channel.name, row.kind);
    const priority =
      channel.name === 'announcements' || row.kind === 'announcement'
        ? ('URGENT' as const)
        : ('NORMAL' as const);
    return {
      title,
      body: preview,
      category: row.kind === 'announcement' ? 'announcements' : 'chat',
      priority,
      data: { target: { screen: 'chat', channelId: channel.id } },
    };
  }

  private titleFor(channelName: string, kind: string): string {
    if (kind === 'announcement' || channelName === 'announcements') {
      return 'New Announcement';
    }
    return `New message in #${channelName}`;
  }

  // ── Internal test helpers ─────────────────────────────────────────────
  /** Cache a channel row in tests so `handleMessage` skips the DB lookup. */
  __setChannelForTest(channel: ChannelRow): void {
    this.channelCache.set(channel.id, {
      row: channel,
      expiresAt: Date.now() + CHANNEL_CACHE_TTL_MS,
    });
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
