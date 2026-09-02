import { SupabaseChatMessageAttachmentRepository } from './supabase-chat-message-attachment.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chat_message_attachments`.
 *
 * Like `chat_messages`, this table has no `chapter_id` — a chapter is only
 * reachable through `chat_channels`. That is why the row carries `channel_id`
 * alongside `message_id`: it keeps the resolution to ONE hop, which is what
 * `parentTenant` below can express. Hanging the row off `message_id` alone would
 * have made it attachment → message → channel → chapter, and neither this
 * harness nor a PostgREST filter states that in one step.
 *
 * Both reads take a `chapterId` and apply it through the inner-joined embed
 * (`.eq('chat_channels.chapter_id', …)`), so a message id from another chapter
 * returns nothing rather than relying on the caller having checked first.
 *
 * Not covered here, for the same reason the sibling `chat_messages` spec calls
 * out: the harness records the `select()` string without parsing it, so dropping
 * `!inner` from `'*, chat_channels!inner(chapter_id)'` is invisible. Against real
 * PostgREST that turns the embed filter into a non-filter and every chapter's
 * attachments leak. That is query shape, and it belongs to the live-PostgREST
 * integration suite.
 */

const CHANNEL_A = '0a000000-0000-4000-8000-000000000180';
const CHANNEL_B = '0b000000-0000-4000-8000-000000000180';
const MESSAGE_A = '0a000000-0000-4000-8000-000000000181';
const MESSAGE_B = '0b000000-0000-4000-8000-000000000181';
const ATTACHMENT_A = '0a000000-0000-4000-8000-000000000182';
const ATTACHMENT_B = '0b000000-0000-4000-8000-000000000182';

const message = (id: string, channelId: string, chapterId: string) => ({
  id,
  channel_id: channelId,
  sender_id: USER_SHARED,
  content: 'minutes attached',
  type: 'TEXT',
  reply_to_id: null,
  metadata: { attachment_count: 1 },
  is_pinned: false,
  pinned_at: null,
  edited_at: null,
  is_deleted: false,
  created_at: '2026-01-01T00:00:00.000Z',
  chat_channels: { chapter_id: chapterId },
});

/**
 * The twins differ ONLY in `id`, `message_id`, `channel_id` and the embed. Same
 * filename, same bucket, same storage path shape, same timestamp — so every
 * predicate the repository applies other than the tenant one matches both, and
 * only a real chapter filter can narrow the result to one.
 */
const attachment = (
  id: string,
  messageId: string,
  channelId: string,
  chapterId: string,
) => ({
  id,
  message_id: messageId,
  channel_id: channelId,
  bucket: 'chat',
  storage_path: `chapters/${chapterId}/chat/${channelId}/${messageId}/minutes.pdf`,
  filename: 'minutes.pdf',
  content_type: 'application/pdf',
  byte_size: 2048,
  width: null,
  height: null,
  external_url: null,
  created_at: '2026-01-01T00:00:00.000Z',
  chat_channels: { chapter_id: chapterId },
});

const seed = () => ({
  chat_channels: [
    inA({ id: CHANNEL_A, name: 'general', type: 'PUBLIC' }),
    inB({ id: CHANNEL_B, name: 'general', type: 'PUBLIC' }),
  ],
  chat_messages: [
    message(MESSAGE_A, CHANNEL_A, CHAPTER_A),
    message(MESSAGE_B, CHANNEL_B, CHAPTER_B),
  ],
  chat_message_attachments: [
    attachment(ATTACHMENT_A, MESSAGE_A, CHANNEL_A, CHAPTER_A),
    attachment(ATTACHMENT_B, MESSAGE_B, CHANNEL_B, CHAPTER_B),
  ],
});

describe('SupabaseChatMessageAttachmentRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatMessageAttachmentRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      // Neither table carries `chapter_id`, so the column predicate cannot run
      // for either. Resolving through the channel — the way production does —
      // keeps the foreign-write check alive.
      untenantedTables: ['chat_messages', 'chat_message_attachments'],
      parentTenant: {
        chat_messages: { column: 'channel_id', table: 'chat_channels' },
        chat_message_attachments: {
          column: 'channel_id',
          table: 'chat_channels',
        },
      },
    });
    repo = new SupabaseChatMessageAttachmentRepository(harness.client);
  });

  it('findByMessage filters through the channel join', async () => {
    const rows = await repo.findByMessage(MESSAGE_B, CHAPTER_B);

    expect(rows.map((r) => r.id)).toEqual([ATTACHMENT_B]);
    expect(
      harness.ops[0].filters.map((f) => [f.column, f.value]),
    ).toContainEqual(['chat_channels.chapter_id', CHAPTER_B]);
  });

  it('never returns external_url, which would leak a source-system URL', async () => {
    // `ChatService.listMessageAttachments` spreads whatever this returns into an
    // API response, so this is a disclosure boundary. A Discord CDN link is
    // signed and time-limited, so shipping one would hand every chapter member a
    // working read of the source object that bypasses the private-bucket,
    // signed-URL-only posture — then rot into a dead link.
    const [row] = await repo.findByMessage(MESSAGE_B, CHAPTER_B);

    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('external_url');
    expect(row.storage_path).toBeDefined();
  });

  it('findByMessage returns nothing for a message in another chapter', async () => {
    // The point of carrying `chapterId` into the query rather than trusting the
    // caller: a message id that resolves in chapter A must not answer for a
    // caller scoped to chapter B, even though the id itself is real.
    const rows = await repo.findByMessage(MESSAGE_A, CHAPTER_B);

    expect(rows).toEqual([]);
  });

  it('strips the channel embed off returned rows', async () => {
    // The embed carries the tenant filter; it is not part of the entity. Leaving
    // it on would put a second, differently-shaped chapter_id on a row that
    // deliberately has none.
    const [row] = await repo.findByMessage(MESSAGE_B, CHAPTER_B);

    expect(row).toBeDefined();
    expect(row).not.toHaveProperty('chat_channels');
  });

  it('createMany writes rows inside the caller chapter subtree', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.createMany([
        {
          message_id: MESSAGE_B,
          channel_id: CHANNEL_B,
          bucket: 'chat',
          storage_path: `chapters/${CHAPTER_B}/chat/${CHANNEL_B}/${MESSAGE_B}/agenda.pdf`,
          filename: 'agenda.pdf',
          content_type: 'application/pdf',
          byte_size: 512,
        },
      ]),
    );

    const rows = harness.rows('chat_message_attachments');
    expect(rows.map((r) => r.filename).sort()).toEqual([
      'agenda.pdf',
      'minutes.pdf',
      'minutes.pdf',
    ]);
  });

  it('createMany issues no query for an empty list', async () => {
    // An `insert([])` records an operation with an empty payload, which
    // satisfies "something was queried" without writing anything — a shape the
    // harness documents as a blind spot. Returning early keeps it out.
    const rows = await repo.createMany([]);

    expect(rows).toEqual([]);
    expect(harness.ops).toHaveLength(0);
  });
});

/**
 * `findSharedObjects` (#514) — the read that keeps a message delete from
 * purging an object another message still points at.
 *
 * Seeded with the shape only the Discord importer produces: two messages in one
 * channel whose attachment rows carry the **same** `bucket` + `storage_path`.
 * The table's unique key is `(message_id, bucket, storage_path)`, so this is a
 * legal state, and the importer reaches it deliberately — DCE deduplicates
 * identical media, and every reference resolves to the one object.
 *
 * Not wrapped in `assertScoped`: this read is deliberately cross-chapter. The
 * question is "does anything anywhere still point at these bytes", and a
 * chapter-scoped answer could only ever be falsely negative — the direction
 * that deletes a live file. It returns no tenant data; every path it can return
 * was supplied by the caller.
 */
describe('SupabaseChatMessageAttachmentRepository — findSharedObjects', () => {
  const CHANNEL = '0a000000-0000-4000-8000-000000000190';
  const CHANNEL_OTHER = '0b000000-0000-4000-8000-000000000190';
  const KEEPER = '0a000000-0000-4000-8000-000000000191';
  const DOOMED = '0a000000-0000-4000-8000-000000000192';
  const SHARED_PATH = `chapters/${CHAPTER_A}/chat-archive/${CHANNEL}/dce-dedup.png`;
  const SOLE_PATH = `chapters/${CHAPTER_A}/chat/${CHANNEL}/${DOOMED}/only-mine.pdf`;

  let harness: TenantHarness;
  let repo: SupabaseChatMessageAttachmentRepository;

  const row = (
    id: string,
    messageId: string,
    path: string,
    bucket: string,
    deleted = false,
  ) => ({
    id,
    message_id: messageId,
    channel_id: CHANNEL,
    bucket,
    storage_path: path,
    filename: path.split('/').pop(),
    content_type: 'image/png',
    byte_size: 128,
    width: null,
    height: null,
    external_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    chat_channels: { chapter_id: CHAPTER_A },
    // The read joins `chat_messages!inner(is_deleted)`: an object held only by
    // already-deleted messages must not read as shared.
    chat_messages: { is_deleted: deleted },
  });

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        chat_channels: [
          inA({ id: CHANNEL, name: 'imported', type: 'PUBLIC' }),
          // Present only to satisfy the harness, which refuses a
          // single-chapter seed. It proves nothing about this read on its own
          // — no attachment row lives in B — and is not claimed to.
          inB({ id: CHANNEL_OTHER, name: 'imported', type: 'PUBLIC' }),
        ],
        chat_message_attachments: [
          row('att-keeper', KEEPER, SHARED_PATH, 'chat-archive'),
          row('att-doomed-shared', DOOMED, SHARED_PATH, 'chat-archive'),
          row('att-doomed-sole', DOOMED, SOLE_PATH, 'chat'),
        ],
      },
      untenantedTables: ['chat_message_attachments'],
    });
    repo = new SupabaseChatMessageAttachmentRepository(harness.client);
  });

  it('reports the object a surviving message still references', async () => {
    const shared = await repo.findSharedObjects(
      [
        { bucket: 'chat-archive', storage_path: SHARED_PATH },
        { bucket: 'chat', storage_path: SOLE_PATH },
      ],
      DOOMED,
    );

    expect(shared).toEqual([
      { bucket: 'chat-archive', storage_path: SHARED_PATH },
    ]);
  });

  it('does not count a reference held by an already-deleted message', async () => {
    // Soft delete leaves attachment rows in place. Counting them would let two
    // deleted messages spare each other's object forever — nothing would ever
    // purge it, which is the leak #514 exists to close.
    harness = createTenantHarness({
      tables: {
        chat_channels: [
          inA({ id: CHANNEL, name: 'imported', type: 'PUBLIC' }),
          inB({ id: CHANNEL_OTHER, name: 'imported', type: 'PUBLIC' }),
        ],
        chat_message_attachments: [
          row('att-gone', KEEPER, SHARED_PATH, 'chat-archive', true),
          row('att-doomed-shared', DOOMED, SHARED_PATH, 'chat-archive'),
        ],
      },
      untenantedTables: ['chat_message_attachments'],
    });
    repo = new SupabaseChatMessageAttachmentRepository(harness.client);

    const shared = await repo.findSharedObjects(
      [{ bucket: 'chat-archive', storage_path: SHARED_PATH }],
      DOOMED,
    );

    expect(shared).toEqual([]);
  });

  it("does not count the deleted message's own rows as a reference", async () => {
    // `DOOMED` carries SOLE_PATH itself. Without the `message_id` exclusion
    // every object would look shared and nothing would ever be purged — the
    // guard would silently turn the whole fix off.
    const shared = await repo.findSharedObjects(
      [{ bucket: 'chat', storage_path: SOLE_PATH }],
      DOOMED,
    );

    expect(shared).toEqual([]);
  });

  it('matches on bucket as well as path', async () => {
    // The query filters on `storage_path` alone (PostgREST has no tuple IN),
    // so the bucket half is applied in memory. Same path, wrong bucket must
    // not read as shared, or a `chat` object would be spared by a
    // `chat-archive` row.
    const shared = await repo.findSharedObjects(
      [{ bucket: 'chat', storage_path: SHARED_PATH }],
      DOOMED,
    );

    expect(shared).toEqual([]);
  });

  it('issues no query for an empty candidate list', async () => {
    const shared = await repo.findSharedObjects([], DOOMED);

    expect(shared).toEqual([]);
    expect(harness.ops).toHaveLength(0);
  });
});
