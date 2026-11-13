import { SystemPermissions } from '#domain/constants/permissions';
import type { CorpusPassage } from '../../corpus/corpus-retrieval.service';
import type { AskTool } from '../ask-tool';
import { AgentToolUnavailableError, type AgentToolContext } from './agent-tool';
import { SearchChapterAgentTool, agentToolFromAskTool } from './interim-tools';

const CHAPTER = 'chapter-a';
const context: AgentToolContext = {
  chapterId: CHAPTER,
  userId: 'user-1',
  now: new Date('2026-11-12T18:00:00.000Z'),
  timeZone: 'America/New_York',
  permissions: new Set([SystemPermissions.AI_USE]),
  enabledModules: null,
};

const passage = (over: Partial<CorpusPassage> = {}): CorpusPassage => ({
  id: 'p1',
  sourceType: 'chapter_document',
  sourceId: 'doc-1',
  title: 'Bylaws',
  heading: 'Article IV',
  text: 'Quorum is two thirds of active members.',
  pageStart: 3,
  pageEnd: 3,
  sourceAt: '2026-09-01T00:00:00.000Z',
  score: 1,
  matchedBy: ['words'],
  channelId: null,
  messageId: null,
  authorIds: [],
  messageCount: null,
  ...over,
});

describe('agentToolFromAskTool', () => {
  const roster = (over: Partial<AskTool> = {}): AskTool => ({
    name: 'roster',
    description: 'Who is in the chapter.',
    kind: 'roster',
    title: 'Roster',
    page: 'members',
    permission: SystemPermissions.MEMBERS_VIEW,
    module: null,
    effect: 'read',
    run: jest.fn(async () => ({
      chapterId: CHAPTER,
      text: 'Dana Reyes: Treasurer',
    })),
    ...over,
  });

  it('keeps the gate of the read it wraps and takes no arguments', () => {
    const tool = agentToolFromAskTool(roster({ module: 'points' }));
    expect(tool).toEqual(
      expect.objectContaining({
        name: 'roster',
        permission: SystemPermissions.MEMBERS_VIEW,
        module: 'points',
        effect: 'read',
        reading: 'Reading the roster',
      }),
    );
    expect(tool.input.safeParse({}).success).toBe(true);
  });

  it('returns the read as one live source that opens its page', async () => {
    const wrapped = roster();
    const result = await agentToolFromAskTool(wrapped).run({}, context);
    expect(wrapped.run).toHaveBeenCalledWith({
      chapterId: CHAPTER,
      userId: 'user-1',
      now: context.now,
      timeZone: 'America/New_York',
    });
    expect(result.sources).toEqual([
      {
        id: 'tool:roster',
        kind: 'roster',
        title: 'Roster',
        detail: null,
        date: null,
        target: { type: 'page', page: 'members' },
        text: 'Dana Reyes: Treasurer',
        chat: false,
        authorIds: [],
      },
    ]);
  });

  it('says where the wrapped read says it read, so the loop can refuse it', async () => {
    const result = await agentToolFromAskTool(
      roster({
        run: async () => ({ chapterId: 'chapter-b', text: 'Not yours' }),
      }),
    ).run({}, context);
    expect(result.chapterId).toBe('chapter-b');
  });

  it('returns no source for a read with nothing to say', async () => {
    const result = await agentToolFromAskTool(
      roster({ run: async () => null }),
    ).run({}, context);
    expect(result.sources).toEqual([]);
    expect(result.note).toBe('Nothing there.');
  });

  it('refuses to wrap anything but a read', () => {
    expect(() => agentToolFromAskTool(roster({ effect: 'propose' }))).toThrow(
      'not a read',
    );
  });
});

describe('SearchChapterAgentTool', () => {
  function build(options: {
    retrieved?: unknown;
    passages?: CorpusPassage[];
    saidNo?: string[];
  }) {
    const retrieval = {
      retrieve: jest.fn(
        async () =>
          options.retrieved ?? {
            status: 'ok',
            passages: options.passages ?? [],
            leftOutMessages: 2,
          },
      ),
    };
    const consent = {
      chatAuthorsWhoSaidYes: jest.fn(
        async (_chapter: string, authors: readonly string[]) =>
          new Set(authors.filter((id) => !options.saidNo?.includes(id))),
      ),
    };
    return {
      tool: new SearchChapterAgentTool(retrieval as never, consent as never),
      retrieval,
    };
  }

  it('is gated like Ask itself and needs words to search for', () => {
    const { tool } = build({});
    expect(tool.permission).toBe(SystemPermissions.AI_USE);
    expect(tool.effect).toBe('read');
    expect(tool.input.safeParse({}).success).toBe(false);
    expect(tool.input.safeParse({ query: '   ' }).success).toBe(false);
    expect(tool.input.safeParse({ query: 'x'.repeat(301) }).success).toBe(
      false,
    );
    // Nothing in the arguments can name a chapter or a member.
    expect(
      tool.input.safeParse({ query: 'quorum', chapterId: 'chapter-b' }).data,
    ).toEqual({ query: 'quorum' });
  });

  it("searches as the asker, in the asker's chapter", async () => {
    const { tool, retrieval } = build({ passages: [passage()] });
    const result = await tool.run({ query: 'quorum' }, context);
    expect(retrieval.retrieve).toHaveBeenCalledWith(
      {
        chapterId: CHAPTER,
        actingUserId: 'user-1',
        query: 'quorum',
        limit: 8,
      },
      context.now,
    );
    expect(result.chapterId).toBe(CHAPTER);
    expect(result.sources).toEqual([
      {
        id: 'passage:p1',
        kind: 'document',
        title: 'Bylaws',
        detail: 'Article IV, page 3',
        date: '2026-09-01T00:00:00.000Z',
        target: { type: 'document', document_id: 'doc-1', page: 3 },
        text: 'Quorum is two thirds of active members.',
        chat: false,
        authorIds: [],
      },
    ]);
  });

  it('drops chat whose author has since said no, and counts it without saying whose', async () => {
    const chat = (id: string, author: string) =>
      passage({
        id,
        sourceType: 'chat_message',
        sourceId: `window-${id}`,
        title: '#general',
        heading: null,
        pageStart: null,
        pageEnd: null,
        channelId: 'ch',
        messageId: `m-${id}`,
        authorIds: [author],
        messageCount: 1,
        text: `${author}: hello`,
      });
    const { tool } = build({
      passages: [chat('c1', 'dana'), chat('c2', 'lee')],
      saidNo: ['lee'],
    });
    const result = await tool.run({ query: 'hello' }, context);
    expect(result.sources).toEqual([
      expect.objectContaining({
        id: 'passage:c1',
        kind: 'chat',
        chat: true,
        authorIds: ['dana'],
        detail: null,
        target: { type: 'message', channel_id: 'ch', message_id: 'm-c1' },
      }),
    ]);
    expect(result.leftOutMessages).toBe(3);
    expect(JSON.stringify(result)).not.toContain('lee');
  });

  it('says so when nothing matched, and ends the turn when the search could not run', async () => {
    const none = await build({ passages: [] }).tool.run(
      { query: 'x' },
      context,
    );
    expect(none).toEqual(
      expect.objectContaining({ sources: [], note: 'No passage matched.' }),
    );
    const unavailable = { status: 'unavailable', reason: 'spend_cap' };
    const off = build({ retrieved: unavailable }).tool.run(
      { query: 'x' },
      context,
    );
    await expect(off).rejects.toBeInstanceOf(AgentToolUnavailableError);
    await expect(off).rejects.toEqual(expect.objectContaining({ unavailable }));
  });
});
