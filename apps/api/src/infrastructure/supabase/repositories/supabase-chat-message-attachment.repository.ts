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
    // Stripped on this exit too, not only on the read. The comment on
    // `external_url` promises it cannot reach a client "whatever a future writer
    // puts in it", and a promise that holds on one of two return paths is not
    // one — the next change that surfaces created attachments on the send
    // response would ship the column with no compile error and no failing test.
    return (data ?? []).map(stripAttachmentRow);
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
    return (data ?? []).map(stripAttachmentRow);
  }
}

/**
 * Drops two things PostgREST hands back that must not leave this repository.
 * Applied on EVERY exit from this repository, not only the read.
 *
 * **The `chat_channels` embed** carries the tenant filter and is not part of the
 * entity: leaving it on would put a second, differently-shaped `chapter_id` on a
 * row that deliberately does not have one, and the first caller to read it would
 * be reading a join artefact.
 *
 * **`external_url`** is a disclosure boundary. `ChatService.listMessageAttachments`
 * spreads whatever this returns straight into an API response, and that column
 * holds a source-system URL. A Discord CDN link is signed and time-limited
 * (`?ex=&is=&hm=`), so shipping one would hand every chapter member a working
 * read of the source object that routes around the private-bucket,
 * signed-URL-only posture entirely — then rot into a dead link nobody can tell
 * from a bug.
 *
 * Dropped HERE rather than by narrowing the `select()`, which is where it
 * belongs and where it does not fit: `database.types.ts` declares
 * `Relationships` as a bare stub, so `@supabase/postgrest-js` cannot resolve the
 * `chat_channels` embed against an explicit column list and collapses the row
 * type to a `SelectQueryError`. `*` is the only projection that keeps the embed
 * typed. Narrowing the query is the better enforcement point and stays a
 * follow-up; until the relation is declared, this is the boundary, and the spec
 * asserts on the returned row rather than on the query string so it pins the
 * property that actually matters.
 */
function stripAttachmentRow(row: ChatMessageAttachment): ChatMessageAttachment {
  const { ...rest } = row as ChatMessageAttachment & {
    chat_channels?: unknown;
  };
  delete (rest as { chat_channels?: unknown }).chat_channels;
  delete (rest as { external_url?: unknown }).external_url;
  return rest;
}
