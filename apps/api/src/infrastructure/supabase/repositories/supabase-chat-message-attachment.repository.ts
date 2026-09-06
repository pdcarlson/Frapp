import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient, TablesInsert } from '../database.types';
import type {
  IChatMessageAttachmentRepository,
  NewChatMessageAttachment,
} from '#domain/repositories/chat.repository.interface';
import { ChatMessageAttachment } from '#domain/entities/chat.entity';

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

  async findSharedObjects(
    candidates: readonly { bucket: string; storage_path: string }[],
    excludingMessageId: string,
  ): Promise<{ bucket: string; storage_path: string }[]> {
    if (candidates.length === 0) return [];

    // One exact-match probe per candidate, not a single `.in(paths)`. Both
    // reasons are failures that would have deleted a live object, which is the
    // one direction this read must never fail in:
    //
    // 1. **`.in()` does not escape `"`.** postgrest-js wraps a value containing
    //    `,`, `(` or `)` in double quotes but leaves an embedded `"` as-is, so
    //    `a",b.png` serializes to `in.("a",b.png")` and PostgREST reads it as
    //    two *different* values. The real path is never queried, the object
    //    looks unreferenced, and it is deleted. Paths are attacker-influenced:
    //    `requestChatUploadUrl` interpolates `path.basename(filename)`, and
    //    neither the channel-prefix check nor `assertSafeStoragePath` rejects
    //    quotes, commas or parens. `.eq()` sends the value whole, so there is
    //    no list syntax to break.
    // 2. **A list read is capped by PostgREST `max_rows` (1000).** An over-cap
    //    read returns a plain 200 with a truncated body, so a widely reused
    //    imported object could have every one of its rows dropped from the
    //    answer and be read as unreferenced. `.limit(1)` per path cannot be
    //    truncated into a wrong answer.
    //
    // The cost is real and accepted, not waved away: there is no index on
    // `(bucket, storage_path)` — the unique index leads with `message_id` — so
    // each probe is a scan, and this trades one scan for up to
    // `MAX_ATTACHMENTS_PER_MESSAGE` (10) of them. Message deletion is rare and
    // a wrong answer here destroys a live file, so correctness wins; add the
    // index if delete latency ever shows up.
    const seen = new Set<string>();
    const shared: { bucket: string; storage_path: string }[] = [];

    for (const candidate of candidates) {
      const key = `${candidate.bucket} ${candidate.storage_path}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // `chat_messages!inner(is_deleted)` + `is_deleted = false` is what keeps
      // the guard from becoming a leak of its own. Soft delete leaves the
      // attachment rows in place, so filtering on `message_id` alone would let
      // an *already deleted* message hold an object alive forever: delete both
      // messages sharing one and each is spared by the other's surviving row,
      // and nothing ever purges it.
      const { data, error } = await this.supabase
        .from('chat_message_attachments')
        .select('id, chat_messages!inner(is_deleted)')
        .eq('bucket', candidate.bucket)
        .eq('storage_path', candidate.storage_path)
        .eq('chat_messages.is_deleted', false)
        .neq('message_id', excludingMessageId)
        .limit(1);
      if (error) throw error;

      if ((data ?? []).length > 0) shared.push(candidate);
    }

    return shared;
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
