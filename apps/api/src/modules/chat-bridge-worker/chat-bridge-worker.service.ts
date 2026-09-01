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
import type {
  FrappSupabaseClient,
  TablesInsert,
} from '../../infrastructure/supabase/database.types';
import { SYSTEM_SENDER_ID } from '../../domain/constants/chat';

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
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
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
      this.logger.error(
        'chat-bridge failed to start; audit messages will not mirror',
        err as Error,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.channel) {
      try {
        await this.supabase.removeChannel(this.channel);
      } catch (err) {
        this.logger.warn(
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
      const { data: channel, error: channelError } = await this.supabase
        .from('chat_channels')
        .select('id')
        .eq('chapter_id', row.chapter_id)
        .eq('name', 'chapter-audit')
        .maybeSingle();
      if (channelError) {
        this.logger.warn(
          `chat-bridge: chapter-audit channel lookup failed for chapter ${row.chapter_id}`,
          channelError,
        );
        return;
      }
      if (!channel) {
        // Older chapters may pre-date the chapter-audit channel — log and
        // move on; the audit row itself is the source of truth.
        this.logger.debug(
          `chat-bridge: no #chapter-audit channel for chapter ${row.chapter_id}`,
        );
        return;
      }

      const message: TablesInsert<'chat_messages'> = {
        channel_id: channel.id,
        sender_id: SYSTEM_SENDER_ID,
        content: this.summarize(row),
        kind: 'system_audit',
        payload: {
          action: row.action,
          actor_user_id: row.actor_user_id,
          diff: row.diff ?? {},
        },
      };
      const { error: insertError } = await this.supabase
        .from('chat_messages')
        .insert(message);
      if (insertError) {
        this.logger.warn(
          `chat-bridge: system_audit insert failed for audit ${row.id}`,
          insertError,
        );
      }
    } catch (err) {
      this.logger.warn(
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
