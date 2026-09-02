import { Test, TestingModule } from '@nestjs/testing';
import {
  SearchService,
  BACKWORK_SEARCH_COLUMNS,
  EVENT_SEARCH_COLUMNS,
} from './search.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { RbacService } from './rbac.service';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';

describe('SearchService', () => {
  let service: SearchService;
  let mockSupabase: jest.Mocked<Pick<FrappSupabaseClient, 'from'>>;
  let mockRbacService: {
    getEffectivePermissions: jest.Mock;
    memberHasAnyPermission: jest.Mock;
  };

  const makeChain = (resolveValue: { data: unknown[]; error: unknown }) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: jest.fn().mockReturnValue(chain),
      eq: jest.fn().mockReturnValue(chain),
      in: jest.fn().mockReturnValue(chain),
      ilike: jest.fn().mockReturnValue(chain),
      textSearch: jest.fn().mockReturnValue(chain),
      or: jest.fn().mockReturnValue(chain),
      limit: jest.fn().mockReturnValue(chain),
      order: jest.fn().mockReturnValue(chain),
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve(resolveValue).then(resolve),
      catch: () => Promise.reject().catch(() => {}),
    });
    return chain;
  };

  beforeEach(async () => {
    mockSupabase = {
      from: jest
        .fn()
        .mockImplementation(() => makeChain({ data: [], error: null })),
    };

    mockRbacService = {
      getEffectivePermissions: jest.fn().mockResolvedValue([]),
      memberHasAnyPermission: jest.fn().mockResolvedValue(false),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: SUPABASE_CLIENT,
          useValue: mockSupabase,
        },
        { provide: RbacService, useValue: mockRbacService },
      ],
    }).compile();

    service = module.get(SearchService);
  });

  describe('search', () => {
    it('should return empty results for empty query', async () => {
      const result = await service.search('ch-1', 'user-1', '');
      expect(result).toEqual({
        backwork: [],
        events: [],
        members: [],
        messages: [],
      });
    });

    it('should return empty results for whitespace-only query', async () => {
      const result = await service.search('ch-1', 'user-1', '   ');
      expect(result).toEqual({
        backwork: [],
        events: [],
        members: [],
        messages: [],
      });
    });

    it('should return empty results without querying for sub-3-char queries', async () => {
      const result = await service.search('ch-1', 'user-1', 'ab');
      expect(result).toEqual({
        backwork: [],
        events: [],
        members: [],
        messages: [],
      });
      // Spec default: shorter queries never touch the database.
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should return grouped results from all domains', async () => {
      const backworkChain = makeChain({ data: [], error: null });
      const eventsChain = makeChain({
        data: [
          {
            id: 'ev-1',
            chapter_id: 'ch-1',
            name: 'Chapter Meeting',
            description: 'Weekly meeting',
            start_time: '2026-02-26T10:00:00Z',
            end_time: '2026-02-26T11:00:00Z',
            point_value: 10,
            is_mandatory: false,
          },
        ],
        error: null,
      });
      // Member search is one query now, so this chain carries the joined user
      // rather than a bare roster row awaiting a second `users` lookup.
      const membersChain = makeChain({
        data: [
          {
            id: 'm-1',
            user_id: 'user-1',
            chapter_id: 'ch-1',
            users: {
              id: 'user-1',
              display_name: 'Ann Meeting',
              email: 'ann@test.dev',
            },
          },
        ],
        error: null,
      });
      const usersChain = makeChain({ data: [], error: null });
      const rolesChain = makeChain({
        data: [{ permissions: [] }],
        error: null,
      });
      const channelsChain = makeChain({
        data: [
          {
            id: 'pub',
            type: 'PUBLIC',
            member_ids: null,
            required_permissions: null,
          },
        ],
        error: null,
      });
      const messagesChain = makeChain({ data: [], error: null });

      (mockSupabase.from as jest.Mock).mockImplementation((t: string) => {
        if (t === 'backwork_resources') return backworkChain;
        if (t === 'events') return eventsChain;
        if (t === 'members') return membersChain;
        if (t === 'users') return usersChain;
        if (t === 'roles') return rolesChain;
        if (t === 'chat_channels') return channelsChain;
        if (t === 'chat_messages') return messagesChain;
        return makeChain({ data: [], error: null });
      });

      const result = await service.search('ch-1', 'user-1', 'meeting');

      expect(result.backwork).toHaveLength(0);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].name).toBe('Chapter Meeting');
      expect(result.members).toHaveLength(1);
      expect(result.members[0].display_name).toBe('Ann Meeting');
      expect(result.messages).toHaveLength(0);
    });

    it('should scope message search to channels the caller can access', async () => {
      let searchedChannelIds: string[] = [];

      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'chat_channels') {
          return makeChain({
            data: [
              {
                id: 'pub',
                type: 'PUBLIC',
                member_ids: null,
                required_permissions: null,
              },
              {
                id: 'priv-in',
                type: 'PRIVATE',
                member_ids: ['user-1'],
                required_permissions: null,
              },
              {
                id: 'priv-out',
                type: 'PRIVATE',
                member_ids: ['user-2'],
                required_permissions: null,
              },
              {
                id: 'gated-yes',
                type: 'ROLE_GATED',
                member_ids: null,
                required_permissions: ['alumni:view'],
              },
              {
                id: 'gated-no',
                type: 'ROLE_GATED',
                member_ids: null,
                required_permissions: ['secret:view'],
              },
            ],
            error: null,
          });
        }
        if (table === 'members') {
          return makeChain({ data: [{ id: 'member-1' }], error: null });
        }
        if (table === 'chat_messages') {
          const chain: Record<string, unknown> = {};
          Object.assign(chain, {
            select: jest.fn().mockReturnValue(chain),
            in: jest.fn().mockImplementation((_col: string, ids: string[]) => {
              searchedChannelIds = ids;
              return chain;
            }),
            ilike: jest.fn().mockReturnValue(chain),
            textSearch: jest.fn().mockReturnValue(chain),
            eq: jest.fn().mockReturnValue(chain),
            limit: jest.fn().mockReturnValue(chain),
            order: jest.fn().mockReturnValue(chain),
            then: (resolve: (v: unknown) => void) =>
              Promise.resolve({ data: [], error: null }).then(resolve),
            catch: () => Promise.reject().catch(() => {}),
          });
          return chain;
        }
        return makeChain({ data: [], error: null });
      });

      // The permission set now resolves through RbacService, so custom-role
      // capabilities gate search exactly as they gate chat channel access
      // (bridge model, spec/behavior/rbac.md).
      mockRbacService.getEffectivePermissions.mockResolvedValue([
        'alumni:view',
      ]);

      await service.search('ch-1', 'user-1', 'hello');

      expect(mockRbacService.getEffectivePermissions).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
      expect(searchedChannelIds).toEqual(['pub', 'priv-in', 'gated-yes']);
      expect(searchedChannelIds).not.toContain('priv-out');
      expect(searchedChannelIds).not.toContain('gated-no');
    });

    describe('single-channel scope (#469)', () => {
      // `spec/behavior/chat/README.md`: "full-text search within a single
      // channel or across all channels the user can access."
      let searchedChannelIds: string[] = [];
      let tablesQueried: string[] = [];

      const mockChannels = () => {
        searchedChannelIds = [];
        tablesQueried = [];
        (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
          tablesQueried.push(table);
          if (table === 'chat_channels') {
            return makeChain({
              data: [
                {
                  id: 'pub',
                  type: 'PUBLIC',
                  member_ids: null,
                  required_permissions: null,
                },
                {
                  id: 'pub-2',
                  type: 'PUBLIC',
                  member_ids: null,
                  required_permissions: null,
                },
                {
                  id: 'priv-out',
                  type: 'PRIVATE',
                  member_ids: ['user-2'],
                  required_permissions: null,
                },
              ],
              error: null,
            });
          }
          if (table === 'members') {
            return makeChain({ data: [{ id: 'member-1' }], error: null });
          }
          if (table === 'chat_messages') {
            const chain: Record<string, unknown> = {};
            Object.assign(chain, {
              select: jest.fn().mockReturnValue(chain),
              in: jest
                .fn()
                .mockImplementation((_col: string, ids: string[]) => {
                  searchedChannelIds = ids;
                  return chain;
                }),
              textSearch: jest.fn().mockReturnValue(chain),
              eq: jest.fn().mockReturnValue(chain),
              limit: jest.fn().mockReturnValue(chain),
              order: jest.fn().mockReturnValue(chain),
              then: (resolve: (v: unknown) => void) =>
                Promise.resolve({
                  data: [{ id: 'm-1', channel_id: 'pub' }],
                  error: null,
                }).then(resolve),
              catch: () => Promise.reject().catch(() => {}),
            });
            return chain;
          }
          return makeChain({ data: [], error: null });
        });
        mockRbacService.getEffectivePermissions.mockResolvedValue([]);
      };

      it('narrows the message scan to the one requested channel', async () => {
        mockChannels();

        await service.search('ch-1', 'user-1', 'hello', 'pub-2');

        // The whole point: the narrowing reaches SQL. Filtering client-side
        // would be wrong, because SEARCH_LIMIT is applied by the database
        // across every accessible channel before any client sees a row.
        expect(searchedChannelIds).toEqual(['pub-2']);
      });

      it('returns nothing for a channel the caller cannot read, without a 403', async () => {
        mockChannels();

        const result = await service.search(
          'ch-1',
          'user-1',
          'hello',
          'priv-out',
        );

        // Never queried: the id intersects the accessible set to nothing, so
        // the scan is skipped entirely rather than run against every channel.
        expect(tablesQueried).not.toContain('chat_messages');
        expect(result.messages).toEqual([]);
      });

      it('returns nothing for a channel id that does not exist', async () => {
        mockChannels();

        const result = await service.search('ch-1', 'user-1', 'hello', 'nope');

        // Same empty answer as an inaccessible channel, deliberately: telling
        // the two apart would make search a channel-existence oracle.
        expect(tablesQueried).not.toContain('chat_messages');
        expect(result.messages).toEqual([]);
      });

      it('runs only the message source, leaving the other three empty', async () => {
        mockChannels();

        const result = await service.search('ch-1', 'user-1', 'hello', 'pub');

        expect(result.messages).toHaveLength(1);
        expect(result.backwork).toEqual([]);
        expect(result.events).toEqual([]);
        expect(result.members).toEqual([]);
        // A channel-scoped query is definitionally a chat search; firing the
        // other three would be work no such caller renders, once per
        // debounced keystroke on an @ThrottleExpensiveRead() route.
        expect(tablesQueried).not.toContain('backwork_resources');
        expect(tablesQueried).not.toContain('events');
      });

      it('still fans out to all four sources when no channel is named', async () => {
        mockChannels();

        await service.search('ch-1', 'user-1', 'hello');

        expect(tablesQueried).toContain('backwork_resources');
        expect(tablesQueried).toContain('events');
        expect(searchedChannelIds).toEqual(['pub', 'pub-2']);
      });

      it('still refuses a sub-minimum query, channel or not', async () => {
        mockChannels();

        const result = await service.search('ch-1', 'user-1', 'hi', 'pub');

        expect(tablesQueried).toEqual([]);
        expect(result.messages).toEqual([]);
      });
    });

    it('should not query messages at all for a non-member', async () => {
      const fromCalls: string[] = [];
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        fromCalls.push(table);
        if (table === 'chat_channels') {
          return makeChain({
            data: [
              {
                id: 'pub',
                type: 'PUBLIC',
                member_ids: null,
                required_permissions: null,
              },
            ],
            error: null,
          });
        }
        // members → empty: caller is not in this chapter
        return makeChain({ data: [], error: null });
      });

      const result = await service.search('ch-1', 'outsider', 'hello');

      expect(result.messages).toEqual([]);
      expect(fromCalls).not.toContain('chat_messages');
    });

    /**
     * These two replace a pair of tests that asserted `escapeFilterValue`
     * quoting inside hand-built `.or(title.ilike.X,course_number.ilike.X)`
     * strings. That construct is gone: backwork and events now match through a
     * generated tsvector, so there is no filter expression to inject into.
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
      const chains: Record<string, Record<string, unknown>> = {};

      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        const chain = makeChain({ data: [], error: null });
        chains[table] = chain;
        return chain;
      });

      await service.search('ch-1', 'user-1', hostile);

      for (const [table, column] of [
        ['backwork_resources', 'search_vector'],
        ['events', 'search_vector'],
        ['members', 'users.display_name_search'],
      ] as const) {
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
     * Regression: the first draft of the `select('*')` → explicit-list change
     * silently dropped `check_in_zone` / `check_in_zone_name` from event search
     * results. Rows are cast to `Event`, so the types kept claiming the fields
     * were there while `event-editor-dialog.tsx` — which reads `check_in_zone`
     * to populate the geofence editor — would have received `undefined`.
     *
     * `check-pglite-migrations.mjs` asserts the full list against the real
     * schema; this pins the specific columns whose loss is most damaging, so
     * the failure is legible without a database.
     */
    it('selects the geofence columns for event results', async () => {
      expect(EVENT_SEARCH_COLUMNS).toContain('check_in_zone');
      expect(EVENT_SEARCH_COLUMNS).toContain('check_in_zone_name');
      // and the tsvector is still excluded, which is why the list is explicit
      expect(EVENT_SEARCH_COLUMNS).not.toContain('search_vector');
      expect(BACKWORK_SEARCH_COLUMNS).not.toContain('search_vector');
    });

    // Search must not become a side-channel around EventService's read
    // visibility (#1463): a role-targeted event a viewer can't see via
    // `GET /v1/events` must not surface here either.
    describe('role-targeted event visibility (#1463)', () => {
      const targetedEvent = {
        id: 'ev-targeted',
        chapter_id: 'ch-1',
        name: 'Exec Meeting',
        description: null,
        start_time: '2026-02-26T10:00:00Z',
        end_time: '2026-02-26T11:00:00Z',
        point_value: 10,
        is_mandatory: false,
        required_role_ids: ['role-officer'],
      };

      const mockFrom = (opts: { events: unknown[]; memberRow: unknown }) => {
        (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
          if (table === 'events') {
            return makeChain({ data: opts.events, error: null });
          }
          if (table === 'chat_channels') {
            // Short-circuits accessibleChannelIds before it queries `members`,
            // so the `members` chain below is only ever read by
            // `filterVisibleEvents` (and by `searchMembers`, whose join-shaped
            // read of the same row simply yields no member match).
            return makeChain({ data: [], error: null });
          }
          if (table === 'members') {
            return makeChain({ data: [opts.memberRow], error: null });
          }
          return makeChain({ data: [], error: null });
        });
      };

      it('drops a role-targeted event for a viewer without a matching role', async () => {
        mockFrom({
          events: [targetedEvent],
          memberRow: { role_ids: ['role-member'] },
        });

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(result.events).toEqual([]);
      });

      it('keeps a role-targeted event for a viewer with a matching role', async () => {
        mockFrom({
          events: [targetedEvent],
          memberRow: { role_ids: ['role-officer'] },
        });

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(result.events).toHaveLength(1);
        expect(result.events[0].id).toBe('ev-targeted');
      });

      it('keeps a role-targeted event for a viewer holding events:update, regardless of role', async () => {
        mockFrom({
          events: [targetedEvent],
          memberRow: { role_ids: ['role-member'] },
        });
        mockRbacService.memberHasAnyPermission.mockResolvedValue(true);

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(result.events).toHaveLength(1);
        // The events:update check short-circuits before the `members` role
        // lookup — no need to resolve the caller's own role_ids at all.
        expect(mockRbacService.memberHasAnyPermission).toHaveBeenCalledWith(
          'ch-1',
          'user-1',
          expect.arrayContaining(['events:update']),
        );
      });

      it('does not query members at all when no matched event is role-targeted', async () => {
        const untargeted = { ...targetedEvent, required_role_ids: null };
        const fromCalls: string[] = [];
        (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
          fromCalls.push(table);
          if (table === 'events') {
            return makeChain({ data: [untargeted], error: null });
          }
          return makeChain({ data: [], error: null });
        });

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(result.events).toHaveLength(1);
        expect(mockRbacService.memberHasAnyPermission).not.toHaveBeenCalled();
      });
    });

    it('never raises on punctuation that would break to_tsquery', async () => {
      // `websearch` parse mode is what makes this true; `to_tsquery` would
      // raise a syntax error and turn a stray "?" in the search box into a 500.
      // Confirmed end to end against the local stack for `!!! ???`,
      // `a & b | c`, a quoted phrase, `budget -draft` and `'; drop table
      // users;--` — every one returned an empty result set, none an error.
      (mockSupabase.from as jest.Mock).mockImplementation(() =>
        makeChain({ data: [], error: null }),
      );

      await expect(
        service.search('ch-1', 'user-1', "'; drop table users;--"),
      ).resolves.toEqual({
        backwork: [],
        events: [],
        members: [],
        messages: [],
      });
    });

    /**
     * #1085. The old implementation selected EVERY `members` row for the
     * chapter and then filtered `users` with `.in(rosterIds).ilike(...)`, so a
     * search cost O(roster) before it could match anything.
     */
    it('member search never loads the chapter roster', async () => {
      const fromCalls: string[] = [];
      let membersChain: Record<string, unknown> | undefined;

      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        fromCalls.push(table);
        const chain = makeChain({ data: [], error: null });
        if (table === 'members') membersChain = chain;
        return chain;
      });

      await service.search('ch-1', 'user-1', 'budgetson');

      // one query, with the join and the match both pushed into SQL
      expect(membersChain?.select).toHaveBeenCalledWith(
        'id, user_id, chapter_id, users!inner(id, display_name, email)',
      );
      expect(membersChain?.eq).toHaveBeenCalledWith('chapter_id', 'ch-1');
      expect(membersChain?.limit).toHaveBeenCalled();
      // the roster fan-out is gone: no standalone `users` read, no `.in()` list
      expect(fromCalls).not.toContain('users');
      expect(membersChain?.in).not.toHaveBeenCalled();
    });

    it('maps the member embed whether it arrives as an object or an array', async () => {
      // PostgREST returns a to-one embed as an object; looser typings and some
      // client versions hand back a single-element array. Neither shape should
      // decide whether member search returns anything.
      const rows = [
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
      ];

      (mockSupabase.from as jest.Mock).mockImplementation((table: string) =>
        table === 'members'
          ? makeChain({ data: rows, error: null })
          : makeChain({ data: [], error: null }),
      );

      const result = await service.search('ch-1', 'user-1', 'budgetson');

      expect(result.members).toEqual([
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
  });

  describe('searchWithinBudget', () => {
    const emptyResult = {
      backwork: [],
      events: [],
      members: [],
      messages: [],
    };

    /** A query that never settles, for driving the budget. */
    const makeHangingChain = () => {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: jest.fn().mockReturnValue(chain),
        eq: jest.fn().mockReturnValue(chain),
        in: jest.fn().mockReturnValue(chain),
        ilike: jest.fn().mockReturnValue(chain),
        textSearch: jest.fn().mockReturnValue(chain),
        or: jest.fn().mockReturnValue(chain),
        limit: jest.fn().mockReturnValue(chain),
        order: jest.fn().mockReturnValue(chain),
        then: () => new Promise(() => {}),
        catch: () => Promise.reject().catch(() => {}),
      });
      return chain;
    };

    /** Wires the chapter/membership lookups the message source walks. */
    const wireSources = (overrides: Record<string, unknown> = {}) => {
      const defaults: Record<string, unknown> = {
        backwork_resources: makeChain({ data: [], error: null }),
        events: makeChain({
          data: [
            {
              id: 'ev-1',
              chapter_id: 'ch-1',
              name: 'Chapter Meeting',
              description: 'Weekly meeting',
              start_time: '2026-02-26T10:00:00Z',
              end_time: '2026-02-26T11:00:00Z',
              point_value: 10,
              is_mandatory: false,
            },
          ],
          error: null,
        }),
        members: makeChain({
          data: [
            {
              id: 'm-1',
              user_id: 'user-1',
              chapter_id: 'ch-1',
              role_ids: ['role-1'],
            },
          ],
          error: null,
        }),
        users: makeChain({ data: [], error: null }),
        roles: makeChain({ data: [{ permissions: [] }], error: null }),
        chat_channels: makeChain({
          data: [
            {
              id: 'pub',
              type: 'PUBLIC',
              member_ids: null,
              required_permissions: null,
            },
          ],
          error: null,
        }),
        chat_messages: makeChain({ data: [], error: null }),
        ...overrides,
      };
      (mockSupabase.from as jest.Mock).mockImplementation(
        (table: string) =>
          defaults[table] ?? makeChain({ data: [], error: null }),
      );
    };

    it('returns an untouched result when every source is inside the budget', async () => {
      wireSources();

      const outcome = await service.searchWithinBudget(
        'ch-1',
        'user-1',
        'meeting',
      );

      expect(outcome.timedOut).toBe(false);
      expect(outcome.timedOutSources).toEqual([]);
      expect(outcome.results.events).toHaveLength(1);
    });

    it('short-circuits a query below the minimum length without a budget', async () => {
      const outcome = await service.searchWithinBudget('ch-1', 'user-1', 'ab');

      expect(outcome).toEqual({
        results: emptyResult,
        timedOut: false,
        timedOutSources: [],
      });
    });

    it('degrades ONLY the slow source, and names it', async () => {
      // This is the regression the per-source budget exists for. The budget used
      // to wrap the whole `Promise.all`, so one slow query returned four empty
      // arrays — the events hit below was already in hand and got thrown away,
      // and the UI rendered it identically to a genuine miss.
      jest.useFakeTimers();
      try {
        wireSources({ chat_messages: makeHangingChain() });

        const promise = service.searchWithinBudget('ch-1', 'user-1', 'meeting');
        await jest.advanceTimersByTimeAsync(500);
        const outcome = await promise;

        expect(outcome.timedOut).toBe(true);
        expect(outcome.timedOutSources).toEqual(['messages']);
        expect(outcome.results.messages).toEqual([]);
        // The half that used to be lost.
        expect(outcome.results.events).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
