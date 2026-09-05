import { SupabasePollVoteRepository } from './supabase-poll-vote.repository';
import {
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `poll_votes`.
 *
 * No method here takes a chapter, and the table has no `chapter_id` — a vote's
 * chapter is its message's channel's. `PollService` establishes that before
 * every call: `ChannelAccessService.assertChannelAccess` on the single-message
 * paths, and `filterAccessibleChannelIds` over
 * `chatMessageRepo.findPollsByChapter(chapterId)` on the list path, so the batch
 * RPCs only ever receive message ids that already passed the chapter filter.
 *
 * What this spec can therefore prove is narrower than elsewhere, and saying so
 * is the point: the message-id predicate is applied, so the upstream check is
 * scoping something real. Two polls in two chapters share a voter, an option
 * index and a timestamp; only `message_id` separates them.
 */

const MESSAGE_A = '0a000000-0000-4000-8000-000000000150';
const MESSAGE_B = '0b000000-0000-4000-8000-000000000150';
const VOTE_A = '0a000000-0000-4000-8000-000000000151';
const VOTE_B = '0b000000-0000-4000-8000-000000000151';

const CHANNEL_A = '0a000000-0000-4000-8000-000000000152';
const CHANNEL_B = '0b000000-0000-4000-8000-000000000152';

const seed = () => ({
  chat_channels: [
    inA({ id: CHANNEL_A, name: 'general', type: 'PUBLIC' }),
    inB({ id: CHANNEL_B, name: 'general', type: 'PUBLIC' }),
  ],
  chat_messages: [
    { id: MESSAGE_A, channel_id: CHANNEL_A, type: 'POLL' },
    { id: MESSAGE_B, channel_id: CHANNEL_B, type: 'POLL' },
  ],
  poll_votes: [
    {
      id: VOTE_A,
      message_id: MESSAGE_A,
      user_id: USER_SHARED,
      option_index: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: VOTE_B,
      message_id: MESSAGE_B,
      user_id: USER_SHARED,
      option_index: 0,
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ],
});

/** Mirrors `POLL_VOTES_PAGE_SIZE` in the repository under test. */
const PAGE_SIZE = 1000;

/**
 * Minimal PostgREST query-builder stand-in that records the window each page
 * asked for. The tenant harness above resolves queries in one shot, so the
 * paging walk itself needs its own stub to be observable.
 */
function makePagingClient(pages: Array<{ data: unknown[] | null }>) {
  const ranges: Array<[number, number]> = [];
  let index = 0;
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'in', 'order']) {
    builder[method] = jest.fn(() => builder);
  }
  builder.range = jest.fn((from: number, to: number) => {
    ranges.push([from, to]);
    return Promise.resolve(pages[index++] ?? { data: [], error: null });
  });
  return { client: { from: jest.fn(() => builder) }, ranges };
}

const voteRows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `vote-${i}` }));

describe('SupabasePollVoteRepository — paging', () => {
  // #1628: POLL_VOTES_PAGE_SIZE is exactly the common PostgREST `max_rows`
  // default, so this was the most exposed of the repo's sweep loops — any cap
  // at or below 1000 made the first page short and ended the read there,
  // under-counting every poll aggregate built from it.
  it('does not end the read on a short-but-non-empty page', async () => {
    const { client, ranges } = makePagingClient([
      // Asked for 1000, capped at 400 by the server.
      { data: voteRows(400) },
      { data: voteRows(400) },
      { data: voteRows(30) },
      { data: [] },
    ]);
    const repo = new SupabasePollVoteRepository(
      client as unknown as ConstructorParameters<
        typeof SupabasePollVoteRepository
      >[0],
    );

    const votes = await repo.findByMessages([MESSAGE_A]);

    expect(votes).toHaveLength(830);
    // Every window opens where the previous one actually ended.
    expect(ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [400, 400 + PAGE_SIZE - 1],
      [800, 800 + PAGE_SIZE - 1],
      [830, 830 + PAGE_SIZE - 1],
    ]);
  });

  it('makes no request at all for an empty message-id list', async () => {
    const { client, ranges } = makePagingClient([]);
    const repo = new SupabasePollVoteRepository(
      client as unknown as ConstructorParameters<
        typeof SupabasePollVoteRepository
      >[0],
    );

    expect(await repo.findByMessages([])).toEqual([]);
    expect(ranges).toEqual([]);
  });

  it('propagates a page error rather than returning a partial read', async () => {
    const ranges: Array<[number, number]> = [];
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'in', 'order']) {
      builder[method] = jest.fn(() => builder);
    }
    builder.range = jest.fn((from: number, to: number) => {
      ranges.push([from, to]);
      return Promise.resolve({ data: null, error: { message: 'boom' } });
    });
    const repo = new SupabasePollVoteRepository({
      from: jest.fn(() => builder),
    } as unknown as ConstructorParameters<
      typeof SupabasePollVoteRepository
    >[0]);

    await expect(repo.findByMessages([MESSAGE_A])).rejects.toEqual({
      message: 'boom',
    });
  });
});

describe('SupabasePollVoteRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabasePollVoteRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      untenantedTables: ['poll_votes', 'chat_messages'],
      // A vote's chapter is two hops away: vote → message → channel. Wiring it
      // up keeps the foreign-write check alive for a table that could otherwise
      // be emptied by a mis-filtered delete without anything noticing.
      parentTenant: {
        poll_votes: { column: 'message_id', table: 'chat_messages' },
        chat_messages: { column: 'channel_id', table: 'chat_channels' },
      },
    });
    repo = new SupabasePollVoteRepository(harness.client);
  });

  it('findByMessage returns only that message votes', async () => {
    const votes = await repo.findByMessage(MESSAGE_B);

    expect(votes.map((v) => v.id)).toEqual([VOTE_B]);
  });

  it('findByMessageAndUser does not return the same voter poll in another chapter', async () => {
    const votes = await repo.findByMessageAndUser(MESSAGE_B, USER_SHARED);

    expect(votes.map((v) => v.id)).toEqual([VOTE_B]);
  });

  it('deleteByMessageAndUser leaves the other chapter vote in place', async () => {
    // Routed through the guard rather than asserted by hand: `parentTenant`
    // resolves each vote's chapter through message → channel, so a delete that
    // matched on the shared `user_id` instead of the message would be caught
    // here even though `poll_votes` has no chapter of its own.
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.deleteByMessageAndUser(MESSAGE_B, USER_SHARED),
    );

    expect(harness.rows('poll_votes').map((v) => v.id)).toEqual([VOTE_A]);
  });

  it('the batch RPCs are scoped only by the message ids they are handed', async () => {
    // Characterisation of the contract `PollService` has to honour: the RPCs
    // take no chapter argument, so passing an unfiltered id list would read
    // across chapters. `filterAccessibleChannelIds` is what prevents that.
    await repo.aggregateOptionTotalsByMessages([MESSAGE_B]);
    await repo.findUserVotesByMessagesForUser([MESSAGE_B], USER_SHARED);

    expect(harness.rpcCalls.map((c) => ({ fn: c.fn, args: c.args }))).toEqual([
      {
        fn: 'get_poll_vote_option_totals',
        args: { p_message_ids: [MESSAGE_B] },
      },
      {
        fn: 'get_poll_user_votes_for_messages',
        args: { p_message_ids: [MESSAGE_B], p_user_id: USER_SHARED },
      },
    ]);
  });
});
