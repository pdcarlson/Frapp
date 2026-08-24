import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  IChatMessageAttachmentRepository,
  NewChatMessageAttachment,
} from '../../../domain/repositories/chat.repository.interface';
import { ChatMessageAttachment } from '../../../domain/entities/chat.entity';

/**
 * `chat_message_attachments` reads and writes.
 *
 * Tenant scope is the `channel_id` embed, exactly as
 * `SupabaseChatMessageRepository` does it: neither this table nor
 * `chat_messages` carries a `chapter_id`, so a chapter is only ever reached
 * through `chat_channels`. The `!inner` on that embed is load-bearing — without
 * it PostgREST returns the row with a nulled embed instead of excluding it, and
 * the filter stops filtering.
 */
@Injectable()
export class SupabaseChatMessageAttachmentRepository implements IChatMessageAttachmentRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  async createMany(
    rows: NewChatMessageAttachment[],
  ): Promise<ChatMessageAttachment[]> {
    // An empty insert is a no-op, not a query. PostgREST answers `insert([])`
    // with a 200 and no rows, so this only saves a round trip — but it also
    // keeps "the caller sent no attachments" from looking like a write in the
    // repository's call log, which is what the tenant-scope harness reads.
    if (rows.length === 0) return [];

    const payload: TablesInsert<'chat_message_attachments'>[] = rows.map(
      (row) => ({
        message_id: row.message_id,
        channel_id: row.channel_id,
        bucket: row.bucket,
        storage_path: row.storage_path,
        filename: row.filename,
        content_type: row.content_type,
        byte_size: row.byte_size,
        width: row.width ?? null,
        height: row.height ?? null,
        external_url: row.external_url ?? null,
      }),
    );

    // Upsert, not insert. A send that committed its message and then failed
    // writing attachments is retried with the same `client_message_id`; the
    // dedupe path re-runs this write against the existing message, and a plain
    // insert would raise 23505 on `chat_message_attachments_object_unique` and
    // turn a recoverable retry into a permanent failure. The key is the stored
    // object, so re-claiming the same object for the same message is a no-op.
    const { data, error } = await this.supabase
      .from('chat_message_attachments')
      .upsert(payload, {
        onConflict: 'message_id,bucket,storage_path',
        ignoreDuplicates: true,
      })
      .select();
    if (error) throw error;
    return data ?? [];
  }

  async findByMessage(
    messageId: string,
    chapterId: string,
  ): Promise<ChatMessageAttachment[]> {
    const { data, error } = await this.supabase
      .from('chat_message_attachments')
      .select('*, chat_channels!inner(chapter_id)')
      .eq('message_id', messageId)
      .eq('chat_channels.chapter_id', chapterId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(stripChannelEmbed);
  }
}

/**
 * Drops the `chat_channels` embed PostgREST projects back alongside the row.
 *
 * The embed exists to carry the tenant filter, not to be returned: leaving it on
 * would put a second, differently-shaped `chapter_id` on an entity that
 * deliberately does not have one, and the first caller to read it would be
 * reading a join artefact.
 */
function stripChannelEmbed(row: ChatMessageAttachment): ChatMessageAttachment {
  const { ...rest } = row as ChatMessageAttachment & {
    chat_channels?: unknown;
  };
  delete (rest as { chat_channels?: unknown }).chat_channels;
  return rest;
}
