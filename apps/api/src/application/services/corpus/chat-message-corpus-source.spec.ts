import type { CorpusCandidate } from '#domain/entities/corpus.entity';
import type {
  ChatWindowRead,
  ICorpusRepository,
} from '#domain/repositories/corpus.repository.interface';
import {
  ChatMessageCorpusSource,
  chatPassagesStillAllowed,
  type ChatBlockReader,
  type ChatChannelReader,
  type ChatConsentReader,
} from './chat-message-corpus-source';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const ASKER = '44444444-4444-4444-8444-444444444444';
const SAM = 'sam';
const LEE = 'lee';
const QUIET = 'quiet';

const window: ChatWindowRead = {
  channelId: 'channel-house',
  channelName: 'house',
  day: '2026-10-11',
  messages: [
    {
      id: 'msg-washer',
      senderId: QUIET,
      senderName: 'Quiet Member',
      content: 'Washer code got changed, it is 4417 now.',
      createdAt: '2026-10-11T21:30:00.000Z',
      threadRootId: null,
      conversationAt: '2026-10-11T21:30:00.000Z',
    },
    {
      id: 'msg-dryer',
      senderId: SAM,
      senderName: 'Sam Ortiz',
      content: 'Dryer on the second floor is broken again.',
      createdAt: '2026-10-11T21:42:00.000Z',
      threadRootId: null,
      conversationAt: '2026-10-11T21:42:00.000Z',
    },
  ],
};

const candidate = (overrides: Partial<CorpusCandidate>): CorpusCandidate => ({
  chunk_id: 'chunk',
  corpus_source_id: 'row',
  source_type: 'chat_message',
  source_id: 'window-1',
  title: '#house',
  heading: 'October 11, 2026',
  content: 'Sam Ortiz: Dryer on the second floor is broken again.',
  page_start: null,
  page_end: null,
  source_at: '2026-10-11T21:42:00.000Z',
  decays: true,
  dense_rank: 1,
  sparse_rank: null,
  distance: 0.1,
  author_ids: [SAM],
  anchor_id: 'msg-dryer',
  anchor_at: '2026-10-11T21:42:00.000Z',
  message_count: 1,
  left_out_count: 1,
  channel_id: 'channel-house',
  ...overrides,
});

function setup(
  options: { yes?: string[]; open?: string[]; blocked?: string[] } = {},
) {
  const corpus = {
    readChatWindow: jest.fn().mockResolvedValue(window),
    chatWindowChannels: jest.fn().mockResolvedValue(
      new Map([
        ['window-1', 'channel-house'],
        ['window-exec', 'channel-exec'],
      ]),
    ),
  } as unknown as jest.Mocked<ICorpusRepository>;
  const yes = new Set(options.yes ?? [SAM, LEE]);
  const consent: jest.Mocked<ChatConsentReader> = {
    chatAuthorsWhoSaidYes: jest.fn((_chapter: string, ids: readonly string[]) =>
      Promise.resolve(new Set(ids.filter((id) => yes.has(id)))),
    ),
  };
  const open = new Set(options.open ?? ['channel-house']);
  const channels: jest.Mocked<ChatChannelReader> = {
    filterAccessibleChannelIds: jest.fn(
      (_chapter: string, _user: string, ids: string[]) =>
        Promise.resolve(new Set(ids.filter((id) => open.has(id)))),
    ),
  };
  const blocks: jest.Mocked<ChatBlockReader> = {
    findBlockedUserIds: jest.fn().mockResolvedValue(options.blocked ?? []),
  };
  const source = new ChatMessageCorpusSource(corpus, consent, channels, blocks);
  return { source, corpus, consent, channels, blocks };
}

describe('ChatMessageCorpusSource', () => {
  describe('read', () => {
    it('reads only the messages of members who said yes, and records what it left out', async () => {
      const { source, consent } = setup();
      const read = await source.read(CHAPTER, 'window-1');
      expect(consent.chatAuthorsWhoSaidYes).toHaveBeenCalledWith(CHAPTER, [
        QUIET,
        SAM,
      ]);
      if (read.status !== 'ok') throw new Error('expected content');
      expect(read.content.title).toBe('#house');
      expect(read.content.decays).toBe(true);
      expect(read.content.sourceAt).toBe('2026-10-11T21:42:00.000Z');
      expect(read.content.passages).toHaveLength(1);
      expect(read.content.passages?.[0].content).not.toContain('4417');
      expect(read.content.leftOut).toEqual({ count: 1, authorIds: [QUIET] });
    });

    it('calls a window the database no longer returns gone (deleted, another chapter, or a DM)', async () => {
      const { source, corpus } = setup();
      corpus.readChatWindow.mockResolvedValue(null);
      await expect(source.read(CHAPTER, 'window-dm')).resolves.toEqual({
        status: 'gone',
      });
    });

    it('reads nothing of anyone while the chapter switch is off (nobody counts as yes)', async () => {
      const { source } = setup({ yes: [] });
      const read = await source.read(CHAPTER, 'window-1');
      if (read.status !== 'ok') throw new Error('expected content');
      expect(read.content.passages).toEqual([]);
      expect(read.content.leftOut?.count).toBe(2);
    });
  });

  describe('readableBy', () => {
    it('lets through only windows in channels the asker can open now, by the timeline’s own check', async () => {
      const { source, channels } = setup();
      const readable = await source.readableBy(CHAPTER, ASKER, [
        'window-1',
        'window-exec',
      ]);
      expect([...readable]).toEqual(['window-1']);
      expect(channels.filterAccessibleChannelIds).toHaveBeenCalledWith(
        CHAPTER,
        ASKER,
        ['channel-house', 'channel-exec'],
      );
    });

    it('lets nothing through for a window the lookup does not return (a DM, another chapter)', async () => {
      const { source, corpus, channels } = setup();
      corpus.chatWindowChannels.mockResolvedValue(new Map());
      await expect(
        source.readableBy(CHAPTER, ASKER, ['window-dm']),
      ).resolves.toEqual(new Set());
      expect(channels.filterAccessibleChannelIds).not.toHaveBeenCalled();
    });
  });

  describe('admit', () => {
    it('withholds a passage with any author who no longer says yes, and counts its messages', async () => {
      const { source } = setup({ yes: [SAM] });
      const admission = await source.admit(CHAPTER, ASKER, [
        candidate({ chunk_id: 'sam-only' }),
        candidate({
          chunk_id: 'with-lee',
          author_ids: [SAM, LEE],
          message_count: 3,
        }),
      ]);
      expect([...admission.admitted]).toEqual(['sam-only']);
      expect([...admission.withheldBySource]).toEqual([['window-1', 3]]);
    });

    it('withholds a passage by a member the asker blocked, without counting it', async () => {
      const { source, blocks } = setup({ blocked: [LEE] });
      const admission = await source.admit(CHAPTER, ASKER, [
        candidate({ chunk_id: 'with-lee', author_ids: [SAM, LEE] }),
      ]);
      expect(admission.admitted.size).toBe(0);
      expect(admission.withheldBySource.size).toBe(0);
      expect(blocks.findBlockedUserIds).toHaveBeenCalledWith(CHAPTER, ASKER);
    });

    it('fails rather than serve a blocked member when the block list cannot be read', async () => {
      const { source, blocks } = setup();
      blocks.findBlockedUserIds.mockRejectedValue(new Error('database away'));
      await expect(
        source.admit(CHAPTER, ASKER, [candidate({})]),
      ).rejects.toThrow('database away');
    });

    it('withholds a passage that names no author', async () => {
      const { source } = setup();
      const admission = await source.admit(CHAPTER, ASKER, [
        candidate({ author_ids: [] }),
      ]);
      expect(admission.admitted.size).toBe(0);
    });
  });
});

describe('chatPassagesStillAllowed', () => {
  it('drops chat passages whose authors no longer all say yes, keeps everything else in order, and counts what it dropped', async () => {
    const consent: ChatConsentReader = {
      chatAuthorsWhoSaidYes: jest.fn((_c: string, ids: readonly string[]) =>
        Promise.resolve(new Set(ids.filter((id) => id === SAM))),
      ),
    };
    const passages = [
      {
        id: 'doc',
        sourceType: 'chapter_document',
        sourceId: 'doc-1',
        authorIds: [],
      },
      {
        id: 'sam',
        sourceType: 'chat_message',
        sourceId: 'w1',
        authorIds: [SAM],
        messageCount: 2,
      },
      {
        id: 'lee',
        sourceType: 'chat_message',
        sourceId: 'w1',
        authorIds: [SAM, LEE],
        messageCount: 4,
      },
    ];
    const result = await chatPassagesStillAllowed(passages, CHAPTER, consent);
    expect(result.passages.map((p) => p.id)).toEqual(['doc', 'sam']);
    expect(result.withheldMessages).toBe(4);
  });
});
