import {
  CHAT_CONVERSATION_GAP_MS,
  buildChatWindowChunks,
  chatLeftOutNotice,
  chatPassageHeading,
  type ChatWindowMessage,
} from './corpus-chat';
import { CORPUS_CHUNK_MAX_CHARS } from './corpus-chunker';

const SAM = 'sam';
const LEE = 'lee';
const QUIET = 'quiet'; // never said yes

let n = 0;
function message(
  overrides: Partial<ChatWindowMessage> & { at: string },
): ChatWindowMessage {
  n += 1;
  const { at, ...rest } = overrides;
  return {
    id: `msg-${n}`,
    senderId: SAM,
    senderName: 'Sam Ortiz',
    content: `message ${n}`,
    createdAt: at,
    threadRootId: null,
    conversationAt: at,
    ...rest,
  };
}

const yes = new Set([SAM, LEE]);

describe('buildChatWindowChunks', () => {
  beforeEach(() => {
    n = 0;
  });

  it('reads a conversation as one passage, each line naming its author, and records whose it is', () => {
    const first = message({
      at: '2026-11-09T22:00:00Z',
      content: 'Who has the van keys?',
    });
    const reply = message({
      at: '2026-11-09T22:02:00Z',
      senderId: LEE,
      senderName: 'Lee Park',
      content: 'I do, they are on the hook.',
    });
    const built = buildChatWindowChunks(
      { channelName: 'general', day: '2026-11-09', messages: [first, reply] },
      yes,
    );
    expect(built.passages).toEqual([
      {
        heading: 'November 9, 2026',
        content:
          'Sam Ortiz: Who has the van keys?\nLee Park: I do, they are on the hook.',
        authorIds: [SAM, LEE],
        anchorId: first.id,
        anchorAt: first.createdAt,
        messageCount: 2,
      },
    ]);
    expect(built.leftOutCount).toBe(0);
    expect(built.firstAt).toBe(first.createdAt);
  });

  it('rebuilds a passage without a member who did not say yes, counting them and keeping who for later', () => {
    const before = message({
      at: '2026-11-09T22:00:00Z',
      content: 'Washer is broken.',
    });
    const quiet = message({
      at: '2026-11-09T22:01:00Z',
      senderId: QUIET,
      senderName: 'Quiet Member',
      content: 'The code is 4417, do not share it.',
    });
    const after = message({
      at: '2026-11-09T22:02:00Z',
      senderId: LEE,
      senderName: 'Lee Park',
      content: 'Use the basement one.',
    });
    const built = buildChatWindowChunks(
      {
        channelName: 'house',
        day: '2026-11-09',
        messages: [before, quiet, after],
      },
      yes,
    );
    expect(built.passages).toHaveLength(1);
    expect(built.passages[0].content).not.toContain('4417');
    expect(built.passages[0].content).not.toContain('Quiet Member');
    expect(built.passages[0].authorIds).toEqual([SAM, LEE]);
    expect(built.passages[0].messageCount).toBe(2);
    expect(built.leftOutCount).toBe(1);
    expect(built.leftOutAuthorIds).toEqual([QUIET]);
  });

  it('leaves out an imported message nobody linked, and every message when nobody said yes', () => {
    const imported = message({
      at: '2026-11-09T22:00:00Z',
      senderId: null,
      senderName: '',
      content: 'old discord history',
    });
    const built = buildChatWindowChunks(
      {
        channelName: 'general',
        day: '2026-11-09',
        messages: [imported, message({ at: '2026-11-09T22:01:00Z' })],
      },
      new Set(),
    );
    expect(built.passages).toEqual([]);
    expect(built.leftOutCount).toBe(2);
    // An unlinked import has no member to bring back.
    expect(built.leftOutAuthorIds).toEqual([SAM]);
    expect(built.firstAt).toBeNull();
  });

  it('starts a new passage after a long pause, and keeps a late thread reply with the message it answers', () => {
    const root = message({
      at: '2026-11-09T14:00:00Z',
      content: 'Who is driving Saturday?',
    });
    const lateReply = message({
      at: '2026-11-10T02:00:00Z',
      conversationAt: root.createdAt,
      threadRootId: root.id,
      senderId: LEE,
      senderName: 'Lee Park',
      content: 'I can drive.',
    });
    const evening = message({
      at: new Date(
        Date.parse(root.createdAt) + CHAT_CONVERSATION_GAP_MS + 60_000,
      ).toISOString(),
      content: 'Dinner at 7?',
    });
    const built = buildChatWindowChunks(
      {
        channelName: 'general',
        day: '2026-11-09',
        messages: [root, lateReply, evening],
      },
      yes,
    );
    expect(built.passages.map((p) => p.content)).toEqual([
      'Sam Ortiz: Who is driving Saturday?\nLee Park, replying in a thread: I can drive.',
      'Sam Ortiz: Dinner at 7?',
    ]);
    expect(built.passages[1].anchorId).toBe(evening.id);
  });

  it('closes a passage before it grows past the largest size, and never splits a message across two', () => {
    const long = 'word '.repeat(150).trim(); // ~750 characters
    const messages = Array.from({ length: 8 }, (_, i) =>
      message({ at: `2026-11-09T22:0${i}:00Z`, content: long }),
    );
    const built = buildChatWindowChunks(
      { channelName: 'general', day: '2026-11-09', messages },
      yes,
    );
    expect(built.passages.length).toBeGreaterThan(1);
    for (const passage of built.passages) {
      expect(passage.content.length).toBeLessThanOrEqual(
        CORPUS_CHUNK_MAX_CHARS,
      );
      expect(
        passage.content.split('\n').every((line) => line.endsWith('word')),
      ).toBe(true);
    }
    expect(built.passages.reduce((sum, p) => sum + p.messageCount, 0)).toBe(8);
  });

  it('cuts one message too long for a passage into its own passages, all anchored on it', () => {
    const huge = message({
      at: '2026-11-09T22:00:00Z',
      content: 'A long policy paste. '.repeat(400),
    });
    const built = buildChatWindowChunks(
      {
        channelName: 'general',
        day: '2026-11-09',
        messages: [message({ at: '2026-11-09T21:59:00Z' }), huge],
      },
      yes,
    );
    expect(built.passages.length).toBeGreaterThan(2);
    expect(
      built.passages
        .slice(1)
        .every((p) => p.anchorId === huge.id && p.messageCount === 1),
    ).toBe(true);
    expect(
      built.passages.every((p) => p.content.length <= CORPUS_CHUNK_MAX_CHARS),
    ).toBe(true);
  });

  it('names an author with no display name plainly', () => {
    const built = buildChatWindowChunks(
      {
        channelName: 'general',
        day: '2026-11-09',
        messages: [
          message({
            at: '2026-11-09T22:00:00Z',
            senderName: '  ',
            content: 'hi',
          }),
        ],
      },
      yes,
    );
    expect(built.passages[0].content).toBe('A member: hi');
  });
});

describe('chatPassageHeading', () => {
  it('writes the day out in full, the same in every time zone', () => {
    expect(chatPassageHeading('2026-11-09')).toBe('November 9, 2026');
  });
});

describe('chatLeftOutNotice', () => {
  it('says how many, never whose, and nothing when none', () => {
    expect(chatLeftOutNotice(0)).toBeNull();
    expect(chatLeftOutNotice(1)).toBe(
      "1 message from a member who opted out isn't included.",
    );
    expect(chatLeftOutNotice(4)).toBe(
      "4 messages from members who opted out aren't included.",
    );
  });
});
