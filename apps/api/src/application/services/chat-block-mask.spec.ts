import {
  BLOCKED_MESSAGE_CONTENT,
  maskBlockedMessages,
} from './chat-block-mask';
import type { ChatMessage } from '#domain/entities/chat.entity';

/**
 * `spec/behavior/chat/README.md` § What a block does and does not hide, and
 * § The masking contract.
 */
describe('maskBlockedMessages', () => {
  const BLOCKED = 'user-blocked';
  const FRIEND = 'user-friend';

  const message = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
    id: 'msg-1',
    channel_id: 'chan-1',
    sender_id: FRIEND,
    content: 'hello',
    type: 'TEXT',
    reply_to_id: null,
    metadata: {},
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  });

  /**
   * A row exactly as a read surface receives it: every column in
   * `CHAT_MESSAGE_COLUMNS` and nothing else.
   *
   * Separate from {@link message} above, which is a deliberately trimmed
   * fixture that leans on the optional fields. Shape comparisons need the real
   * projection — against the trimmed one, a masked row would differ from a
   * clear one by every field the fixture happened to omit.
   */
  const servedRow = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
    id: 'msg-1',
    channel_id: 'chan-1',
    sender_id: FRIEND,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: 'hello',
    type: 'TEXT',
    kind: 'text',
    payload: null,
    client_message_id: 'client-1',
    reply_to_id: null,
    metadata: {},
    mentions: [],
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  });

  it('masks a message from a blocked sender', () => {
    const [masked] = maskBlockedMessages(
      [message({ sender_id: BLOCKED, content: 'go away' })],
      [BLOCKED],
    );

    expect(masked.sender_blocked).toBe(true);
    expect(masked.content).toBe(BLOCKED_MESSAGE_CONTENT);
  });

  it('leaves everyone else alone, and still flags the row', () => {
    const [clear] = maskBlockedMessages([message()], [BLOCKED]);

    expect(clear.sender_blocked).toBe(false);
    expect(clear.content).toBe('hello');
  });

  it('flags every row even when nothing is blocked', () => {
    // An absent-means-false flag is a sentinel string with extra steps: a client
    // could not tell "this server does not mask" from "this message is fine".
    const [clear] = maskBlockedMessages([message()], []);

    expect(clear.sender_blocked).toBe(false);
  });

  it('withholds every author-controlled field, not only content', () => {
    // A points / task / event card is authored by the acting member and its
    // template interpolates their free text, so `payload` has to go; `metadata`
    // carries `attachment_count`, which is the only way a client learns to fetch
    // a message's files; `mentions` overrides a per-channel mute in the push
    // rules. Leaving any of them would hand a blocked member an unmaskable
    // channel into the blocker's timeline.
    const [masked] = maskBlockedMessages(
      [
        message({
          sender_id: BLOCKED,
          kind: 'task',
          payload: { title: 'read this instead' },
          metadata: { attachment_count: 2 },
          mentions: ['user-blocker'],
          author_name: 'imported-handle',
          author_avatar_path: 'chat-archive/avatar.png',
          author_external_id: '1234',
        }),
      ],
      [BLOCKED],
    );

    expect(masked.payload).toBeNull();
    expect(masked.metadata).toEqual({});
    expect(masked.mentions).toBeNull();
    expect(masked.author_name).toBeNull();
    expect(masked.author_avatar_path).toBeNull();
    expect(masked.author_external_id).toBeNull();
  });

  it('keeps the structure a thread needs to render a tombstone in place', () => {
    const [masked] = maskBlockedMessages(
      [
        message({
          id: 'msg-7',
          sender_id: BLOCKED,
          reply_to_id: 'msg-6',
          is_pinned: true,
          pinned_at: '2026-03-02T00:00:00.000Z',
          edited_at: '2026-03-03T00:00:00.000Z',
        }),
      ],
      [BLOCKED],
    );

    expect(masked).toMatchObject({
      id: 'msg-7',
      channel_id: 'chan-1',
      // Kept deliberately: the blocker chose the block and owns the list, and
      // without it a client cannot reconcile a server-masked row against the
      // list it applies itself to the Realtime echo.
      sender_id: BLOCKED,
      reply_to_id: 'msg-6',
      is_pinned: true,
      pinned_at: '2026-03-02T00:00:00.000Z',
      edited_at: '2026-03-03T00:00:00.000Z',
      created_at: '2026-03-01T00:00:00.000Z',
    });
  });

  it('never masks an imported message, which has no user to have blocked', () => {
    // Blocks are keyed on `users.id`; a `sender_id: null` archive row is not a
    // Signet user, so there is nothing to match. Masking it would hide history
    // the member never blocked.
    const [row] = maskBlockedMessages(
      [message({ sender_id: null, author_name: 'someone#1234' })],
      [BLOCKED],
    );

    expect(row.sender_blocked).toBe(false);
    expect(row.author_name).toBe('someone#1234');
  });

  it('gives a masked row exactly the keys a clear row has', () => {
    // The uniformity argument this module rests on, as an assertion. A masked
    // row carrying a key clear rows lack is itself a signal — one a client
    // could key off instead of `sender_blocked`, and one that says "masked" to
    // anything diffing the two shapes. It is also how a field outside the
    // served projection sneaks into the rebuild: `external_message_id` is
    // declared on `ChatMessage` but deliberately omitted from
    // `CHAT_MESSAGE_COLUMNS` (no client reads a Discord snowflake), so
    // rebuilding it here put 21 keys on a masked row against a clear row's 20.
    //
    // `servedRow` is the repository's projection, not the trimmed fixture the
    // rest of this file uses — a clear row is whatever the repository handed
    // over, so the comparison is only honest against the real column list.
    const [masked, clear] = maskBlockedMessages(
      [servedRow({ sender_id: BLOCKED }), servedRow()],
      [BLOCKED],
    );

    expect(Object.keys(masked).sort()).toEqual(Object.keys(clear).sort());
  });

  it('does not mutate the rows it was given', () => {
    const original = message({ sender_id: BLOCKED, content: 'go away' });

    maskBlockedMessages([original], [BLOCKED]);

    expect(original.content).toBe('go away');
  });
});
