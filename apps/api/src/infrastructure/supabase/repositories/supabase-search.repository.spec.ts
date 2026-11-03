import { HttpException } from '@nestjs/common';
import {
  BACKWORK_SEARCH_COLUMNS,
  EVENT_SEARCH_COLUMNS,
  SupabaseSearchRepository,
} from './supabase-search.repository';
import { SupabaseQueryError } from '../supabase-query-error';
import type { FrappSupabaseClient } from '../database.types';
import {
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for the global-search reads, then the query shapes that decide
 * whether search is indexed, injection-proof and complete.
 *
 * Every chapter-scoped source filters on its own `chapter_id`. Messages are the
 * exception: `chat_messages` has no chapter column, and the read is scoped by
 * the channel ids `SearchService` already reduced to what the caller may read,
 * so that case asserts the channel narrowing directly.
 */

const CHANNEL_A = '0a000000-0000-4000-8000-000000000500';
const CHANNEL_B = '0b000000-0000-4000-8000-000000000500';

const seed = () => ({
  backwork_resources: [
    inA({
      id: '0a000000-0000-4000-8000-000000000501',
      title: 'Budget memo',
      search_vector: 'budget memo',
    }),
    inB({
      id: '0b000000-0000-4000-8000-000000000501',
      title: 'Budget memo',
      search_vector: 'budget memo',
    }),
  ],
  events: [
    inA({
      id: '0a000000-0000-4000-8000-000000000502',
      name: 'Budget meeting',
      search_vector: 'budget meeting',
    }),
    inB({
      id: '0b000000-0000-4000-8000-000000000502',
      name: 'Budget meeting',
      search_vector: 'budget meeting',
    }),
  ],
  members: [
    inA({
      id: '0a000000-0000-4000-8000-000000000503',
      user_id: USER_SHARED,
      role_ids: ['role-officer'],
      users: {
        id: USER_SHARED,
        display_name: 'Ann Budgetson',
        display_name_search: 'ann budgetson',
        email: 'ann@x.dev',
      },
    }),
    inB({
      id: '0b000000-0000-4000-8000-000000000503',
      user_id: USER_SHARED,
      role_ids: ['role-officer'],
      users: {
        id: USER_SHARED,
        display_name: 'Ann Budgetson',
        display_name_search: 'ann budgetson',
        email: 'ann@x.dev',
      },
    }),
  ],
  chat_channels: [
    inA({
      id: CHANNEL_A,
      type: 'PUBLIC',
      member_ids: null,
      required_permissions: null,
    }),
    inB({
      id: CHANNEL_B,
      type: 'PUBLIC',
      member_ids: null,
      required_permissions: null,
    }),
  ],
  chat_messages: [
    {
      id: '0a000000-0000-4000-8000-000000000504',
      channel_id: CHANNEL_A,
      content: 'budget is due',
      content_search: 'budget is due',
      is_deleted: false,
      created_at: '2026-03-01T00:00:00.000Z',
    },
    {
      id: '0b000000-0000-4000-8000-000000000504',
      channel_id: CHANNEL_B,
      content: 'budget is due',
      content_search: 'budget is due',
      is_deleted: false,
      created_at: '2026-03-01T00:00:00.000Z',
    },
    {
      id: '0b000000-0000-4000-8000-000000000505',
      channel_id: CHANNEL_B,
      content: 'old budget',
      content_search: 'old budget',
      is_deleted: true,
      created_at: '2026-02-01T00:00:00.000Z',
    },
  ],
});

describe('SupabaseSearchRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseSearchRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      untenantedTables: ['chat_messages'],
      parentTenant: {
        chat_messages: { column: 'channel_id', table: 'chat_channels' },
      },
    });
    repo = new SupabaseSearchRepository(harness.client);
  });

  it('searchBackwork matches only in the caller chapter', async () => {
    const hits = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.searchBackwork(CHAPTER_B, 'budget', 10),
    );

    expect(hits.map((h) => h.chapter_id)).toEqual([CHAPTER_B]);
  });

  it('searchEvents matches only in the caller chapter', async () => {
    const hits = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.searchEvents(CHAPTER_B, 'budget', 10),
    );

    expect(hits.map((h) => h.chapter_id)).toEqual([CHAPTER_B]);
  });

  it('searchMembers matches a shared user only through the caller chapter membership', async () => {
    // `users` is global and the same person belongs to both chapters, so the
    // outer chapter filter is the only thing keeping this source local.
    const hits = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.searchMembers(CHAPTER_B, 'budgetson', 10),
    );

    expect(hits).toEqual([
      {
        id: '0b000000-0000-4000-8000-000000000503',
        user_id: USER_SHARED,
        chapter_id: CHAPTER_B,
        display_name: 'Ann Budgetson',
        email: 'ann@x.dev',
      },
    ]);
  });

  it('findChannelsForAccess reads the caller chapter channels', async () => {
    const channels = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findChannelsForAccess(CHAPTER_B),
    );

    expect(channels.map((c) => c.id)).toEqual([CHANNEL_B]);
  });

  it('findChannelsForAccess finds nothing for another chapter channel id', async () => {
    const channels = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findChannelsForAccess(CHAPTER_B, CHANNEL_A),
    );

    expect(channels).toEqual([]);
  });

  it('searchMessages reads only the channels it is handed, and skips deleted rows', async () => {
    const hits = await repo.searchMessages([CHANNEL_B], 'budget', 10);

    expect(hits.map((h) => h.id)).toEqual([
      '0b000000-0000-4000-8000-000000000504',
    ]);
  });
});

/**
 * The shapes below are what a passthrough harness cannot see: which
 * text-search parse mode reaches PostgREST, which columns are selected, and
 * which builder methods are never called. Each `from()` gets a recording chain
 * that resolves with `result`.
 */
describe('SupabaseSearchRepository — query shape', () => {
  type Chain = Record<string, jest.Mock> & {
    then: (resolve: (v: unknown) => unknown) => Promise<unknown>;
  };

  const recordingClient = (
    result: { data: unknown; error: unknown } = { data: [], error: null },
  ) => {
    const chains: Record<string, Chain> = {};
    const from = jest.fn((table: string) => {
      const chain = {} as Chain;
      for (const method of [
        'select',
        'eq',
        'in',
        'ilike',
        'or',
        'textSearch',
        'limit',
        'order',
      ]) {
        chain[method] = jest.fn(() => chain);
      }
      chain.then = (resolve) => Promise.resolve(result).then(resolve);
      chains[table] = chain;
      return chain;
    });
    return {
      client: { from } as unknown as FrappSupabaseClient,
      from,
      chains,
    };
  };

  /**
   * These replace a pair of tests that asserted `escapeFilterValue` quoting
   * inside hand-built `.or(title.ilike.X,course_number.ilike.X)` strings. That
   * construct is gone: every source matches through a generated tsvector, so
   * there is no filter expression to inject into.
   *
   * The property still worth pinning is the one that replaced it — the raw
   * query reaches PostgREST as ONE opaque parameter value and is never
   * concatenated into a filter grammar. Verified against the local stack: a
   * `test,id.eq.secret` query serialises to
   * `search_vector=wfts%28english%29.test%2Cid.eq.secret`, with the comma
   * percent-encoded inside the single value, so it cannot become a second
   * filter.
   */
  it('passes a hostile query to text search as one opaque value, never a filter expression', async () => {
    const hostile = 'test,id.eq.secret';
    const { client, chains } = recordingClient();
    const repo = new SupabaseSearchRepository(client);

    await repo.searchBackwork('ch-1', hostile, 10);
    await repo.searchEvents('ch-1', hostile, 10);
    await repo.searchMembers('ch-1', hostile, 10);
    await repo.searchMessages(['c-1'], hostile, 10);

    for (const [table, column] of [
      ['backwork_resources', 'search_vector'],
      ['events', 'search_vector'],
      ['members', 'users.display_name_search'],
      ['chat_messages', 'content_search'],
    ] as const) {
      // `websearch`, never `to_tsquery`: stray punctuation ("?", "&", a
      // quote) must not become a syntax error and a 500. Confirmed end to end
      // against the local stack for `!!! ???`, `a & b | c`, a quoted phrase,
      // `budget -draft` and `'; drop table users;--`.
      expect(chains[table].textSearch).toHaveBeenCalledWith(
        column,
        // the raw query, unescaped and unwrapped — no `%…%`, no quoting
        hostile,
        { type: 'websearch', config: 'english' },
      );
      // the injection vector this replaces: no filter string is built at all
      expect(chains[table].or).not.toHaveBeenCalled();
      expect(chains[table].ilike).not.toHaveBeenCalled();
    }
  });

  /**
   * #1085. The old implementation selected EVERY `members` row for the
   * chapter and then filtered `users` with `.in(rosterIds).ilike(...)`, so a
   * search cost O(roster) before it could match anything.
   */
  it('member search never loads the chapter roster', async () => {
    const { client, from, chains } = recordingClient();
    const repo = new SupabaseSearchRepository(client);

    await repo.searchMembers('ch-1', 'budgetson', 10);

    // one query, with the join and the match both pushed into SQL
    expect(chains.members.select).toHaveBeenCalledWith(
      'id, user_id, chapter_id, users!inner(id, display_name, email)',
    );
    expect(chains.members.eq).toHaveBeenCalledWith('chapter_id', 'ch-1');
    expect(chains.members.limit).toHaveBeenCalledWith(10);
    // the roster fan-out is gone: no standalone `users` read, no `.in()` list
    expect(from).not.toHaveBeenCalledWith('users');
    expect(chains.members.in).not.toHaveBeenCalled();
  });

  it('maps the member embed whether it arrives as an object or an array', async () => {
    // PostgREST returns a to-one embed as an object; looser typings and some
    // client versions hand back a single-element array. Neither shape should
    // decide whether member search returns anything.
    const { client } = recordingClient({
      data: [
        {
          id: 'm-1',
          user_id: 'u-1',
          chapter_id: 'ch-1',
          users: { id: 'u-1', display_name: 'Bob Budgetson', email: 'b@x.dev' },
        },
        {
          id: 'm-2',
          user_id: 'u-2',
          chapter_id: 'ch-1',
          users: [
            { id: 'u-2', display_name: 'Ann Budgetson', email: 'a@x.dev' },
          ],
        },
        // an embed that came back empty must be dropped, not returned blank
        { id: 'm-3', user_id: 'u-3', chapter_id: 'ch-1', users: null },
      ],
      error: null,
    });
    const repo = new SupabaseSearchRepository(client);

    await expect(repo.searchMembers('ch-1', 'budgetson', 10)).resolves.toEqual([
      {
        id: 'm-1',
        user_id: 'u-1',
        chapter_id: 'ch-1',
        display_name: 'Bob Budgetson',
        email: 'b@x.dev',
      },
      {
        id: 'm-2',
        user_id: 'u-2',
        chapter_id: 'ch-1',
        display_name: 'Ann Budgetson',
        email: 'a@x.dev',
      },
    ]);
  });

  it('message search drops deleted rows, newest first, capped', async () => {
    const { client, chains } = recordingClient();
    const repo = new SupabaseSearchRepository(client);

    await repo.searchMessages(['c-1', 'c-2'], 'budget', 10);

    const messages = chains.chat_messages;
    expect(messages.in).toHaveBeenCalledWith('channel_id', ['c-1', 'c-2']);
    expect(messages.eq).toHaveBeenCalledWith('is_deleted', false);
    expect(messages.limit).toHaveBeenCalledWith(10);
    expect(messages.order).toHaveBeenCalledWith('created_at', {
      ascending: false,
    });
    // Not `*`: that would ship the stored tsvector back with every hit.
    expect(messages.select).not.toHaveBeenCalledWith('*');
    expect(String(messages.select.mock.calls[0][0])).not.toContain(
      'content_search',
    );
  });

  describe('channel candidate push-down (#469)', () => {
    const CHANNEL = '22222222-2222-4222-8222-222222222222';

    it('narrows the candidate channel query itself, still chapter-scoped', async () => {
      // Without the push-down, validating one known channel still selects
      // every channel row in the chapter — on an archive-imported chapter that
      // is a chapter-wide scan per debounced keystroke, inside a 500ms
      // per-source budget.
      const { client, chains } = recordingClient();
      const repo = new SupabaseSearchRepository(client);

      await repo.findChannelsForAccess('ch-1', CHANNEL);

      expect(chains.chat_channels.eq).toHaveBeenCalledWith('id', CHANNEL);
      expect(chains.chat_channels.eq).toHaveBeenCalledWith(
        'chapter_id',
        'ch-1',
      );
    });

    it('does not push a non-uuid channelId down to a uuid column', async () => {
      // `chat_channels.id` is a uuid column: PostgREST answers a malformed
      // comparison with 22P02, thrown as a `SupabaseQueryError` (a 500). So
      // `?channelId=general` must skip the push-down and leave the answer to
      // the service's intersection — "no matches", which is what the contract
      // promises — rather than erroring.
      const { client, chains } = recordingClient();
      const repo = new SupabaseSearchRepository(client);

      await repo.findChannelsForAccess('ch-1', 'general');

      const columns = chains.chat_channels.eq.mock.calls.map(([col]) => col);
      expect(columns).not.toContain('id');
    });

    it('does not narrow the candidate query for a chapter-wide search', async () => {
      const { client, chains } = recordingClient();
      const repo = new SupabaseSearchRepository(client);

      await repo.findChannelsForAccess('ch-1');

      const columns = chains.chat_channels.eq.mock.calls.map(([col]) => col);
      expect(columns).not.toContain('id');
    });
  });

  it('a failed query surfaces as a SupabaseQueryError, not a 500 carrying its text', async () => {
    // Search's own `throwIfError` used to throw
    // `InternalServerErrorException(error.message)`, which put PostgREST's
    // text in the response body. A `SupabaseQueryError` is not an
    // HttpException, so `AllExceptionsFilter` answers it with the generic
    // 500 body and sends the code and the query's stack to Sentry (#1264).
    const { client } = recordingClient({
      data: null,
      error: {
        code: '42P01',
        message: 'relation "backwork_resources" does not exist',
      },
    });
    const repo = new SupabaseSearchRepository(client);

    const thrown: unknown = await repo
      .searchBackwork('ch-1', 'meeting', 10)
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(SupabaseQueryError);
    expect(thrown).not.toBeInstanceOf(HttpException);
    expect(thrown).toMatchObject({ code: '42P01' });
  });

  /**
   * Regression: the first draft of the `select('*')` → explicit-list change
   * silently dropped `check_in_zone` / `check_in_zone_name` from event search
   * results. Rows are cast to `Event`, so the types kept claiming the fields
   * were there while `event-editor-dialog.tsx` — which reads `check_in_zone`
   * to populate the geofence editor — would have received `undefined`.
   *
   * `scripts/pglite/landmarks.mjs` asserts the full list against the real
   * schema; this pins the specific columns whose loss is most damaging, so
   * the failure is legible without a database.
   */
  it('selects the geofence columns for event results', async () => {
    const { client, chains } = recordingClient();
    const repo = new SupabaseSearchRepository(client);

    await repo.searchEvents('ch-1', 'meeting', 10);
    await repo.searchBackwork('ch-1', 'meeting', 10);

    expect(chains.events.select).toHaveBeenCalledWith(EVENT_SEARCH_COLUMNS);
    expect(chains.backwork_resources.select).toHaveBeenCalledWith(
      BACKWORK_SEARCH_COLUMNS,
    );
    expect(EVENT_SEARCH_COLUMNS).toContain('check_in_zone');
    expect(EVENT_SEARCH_COLUMNS).toContain('check_in_zone_name');
    // and the tsvector is still excluded, which is why the list is explicit
    expect(EVENT_SEARCH_COLUMNS).not.toContain('search_vector');
    expect(BACKWORK_SEARCH_COLUMNS).not.toContain('search_vector');
  });
});
