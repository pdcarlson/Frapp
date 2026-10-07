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
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { SYSTEM_SENDER_ID } from '#domain/constants/chat';
import type { ChatMessage } from '#domain/entities/chat.entity';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '#domain/repositories/chat.repository.interface';
import type {
  IChatChannelRepository,
  IChatMessageRepository,
} from '#domain/repositories/chat.repository.interface';
import { logThrowable } from '../../infrastructure/observability/log-throwable';

/**
 * The idempotency key a mirror is posted under. Prefixed so it can never equal
 * a member's client-generated id (a bare UUID), which is the only other thing
 * `client_message_id` holds.
 */
export function auditMirrorClientId(auditId: string): string {
  return `audit:${auditId}`;
}

interface AuditLogRow {
  id: string;
  chapter_id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  scope: string;
  diff: Record<string, unknown> | null;
  member_visible: boolean;
  created_at: string;
}

/**
 * Audit→chat bridge (ADR-08).
 *
 * Subscribes to Postgres Changes on `chapter_audit_log` INSERT via the
 * service-role Supabase client. Every member-visible audit row is mirrored
 * into the chapter's `#chapter-audit` channel as a `kind="system_audit"`
 * message. The bridge replaces the inline `postAuditMessage` pattern that
 * used to live in `chapter-config.service.ts` so each new audit-writing
 * service doesn't have to repeat (and risk drifting from) the bridge code.
 *
 * **One mirror per audit row, however many instances hear it (#2846).**
 * Realtime delivers every INSERT to every API process, so each mirror is posted
 * with `client_message_id = auditMirrorClientId(row.id)`. The existing unique
 * index `idx_chat_messages_dedupe (channel_id, sender_id, client_message_id)`
 * then refuses every insert after the first, and the loser's `23505` means
 * "already mirrored". No claim table is needed: the message row is its own
 * claim.
 *
 * Failure modes are non-fatal: the bridge logs and continues. A missing
 * `#chapter-audit` channel for a chapter is a configuration bug, not a
 * runtime failure — the audit row itself is the source of truth.
 *
 * Sandbox note: the realtime subscription is opened on
 * `OnApplicationBootstrap`, so unit tests can exercise the row→message
 * mapping in isolation via `handleAuditRow`.
 */
@Injectable()
export class ChatBridgeWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ChatBridgeWorkerService.name);
  private channel: RealtimeChannel | null = null;

  constructor(
    // The client carries only the Realtime subscription; every query goes
    // through a repository.
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channels: IChatChannelRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messages: IChatMessageRepository,
  ) {}

  onApplicationBootstrap(): void {
    try {
      this.channel = this.supabase
        .channel('chat-bridge-worker:audit-log')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'chapter_audit_log',
          },
          (payload: RealtimePostgresInsertPayload<AuditLogRow>) => {
            void this.handleAuditRow(payload.new);
          },
        )
        .subscribe((status) => {
          const s = status as string;
          if (s === 'SUBSCRIBED') {
            this.logger.log('chat-bridge subscribed to chapter_audit_log');
          } else if (s === 'CHANNEL_ERROR' || s === 'CLOSED') {
            this.logger.warn(`chat-bridge channel state: ${s}`);
          }
        });
    } catch (err) {
      logThrowable(
        this.logger,
        'error',
        'chat-bridge failed to start; audit messages will not mirror',
        err,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.channel) {
      try {
        await this.supabase.removeChannel(this.channel);
      } catch (err) {
        logThrowable(
          this.logger,
          'warn',
          'chat-bridge: error removing channel on shutdown',
          err,
        );
      }
      this.channel = null;
    }
  }

  /**
   * Single-row handler. Exposed (not private) so unit tests can invoke it
   * directly without spinning up a real Realtime subscription.
   */
  async handleAuditRow(row: AuditLogRow): Promise<void> {
    if (!row || !row.chapter_id) return;
    // Member-invisible rows (e.g. internal scope) stay out of the channel —
    // the chat-audit feed is a member-trust surface.
    if (row.member_visible === false) return;

    try {
      let channelId: string | null;
      try {
        channelId =
          (await this.channels.findByName(row.chapter_id, 'chapter-audit'))
            ?.id ?? null;
      } catch (channelError) {
        logThrowable(
          this.logger,
          'warn',
          `chat-bridge: chapter-audit channel lookup failed for chapter ${row.chapter_id}`,
          channelError,
        );
        return;
      }
      if (!channelId) {
        // Older chapters may pre-date the chapter-audit channel — log and
        // move on; the audit row itself is the source of truth.
        this.logger.debug(
          `chat-bridge: no #chapter-audit channel for chapter ${row.chapter_id}`,
        );
        return;
      }

      const message: Partial<ChatMessage> = {
        channel_id: channelId,
        sender_id: SYSTEM_SENDER_ID,
        content: this.summarize(row),
        kind: 'system_audit',
        client_message_id: auditMirrorClientId(row.id),
        payload: {
          action: row.action,
          actor_user_id: row.actor_user_id,
          diff: row.diff ?? {},
        },
      };
      let outcome: 'inserted' | 'duplicate';
      try {
        outcome = await this.messages.insertIdempotent(message);
      } catch (insertError) {
        logThrowable(
          this.logger,
          'warn',
          `chat-bridge: system_audit insert failed for audit ${row.id}`,
          insertError,
        );
        return;
      }
      if (outcome === 'duplicate') {
        // Another instance mirrored this audit row first.
        this.logger.debug(`chat-bridge: audit ${row.id} already mirrored`);
      }
    } catch (err) {
      logThrowable(
        this.logger,
        'warn',
        `chat-bridge: unexpected error mirroring audit ${row.id}`,
        err,
      );
    }
  }

  private summarize(row: AuditLogRow): string {
    const keys = row.diff ? Object.keys(row.diff) : [];
    if (keys.length === 0) return row.action;
    return `${row.action}: ${keys.join(', ')}`;
  }
}
