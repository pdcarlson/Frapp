import { Logger } from '@nestjs/common';
import {
  ChatNotificationPreferenceRepository,
  PREFERENCE_PAGE_SIZE,
} from './chat-notification-preference.repository';
import {
  CHAPTER_B,
  USER_A,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chat_notification_preferences` (push-worker lookup).
 *
 * `findForUsers(userIds, chapterId)` is the worker's read. The worker already
 * knows the chapter of the message it is notifying about; this spec pins that
 * the query binds `chapter_id` rather than returning the same users' prefs
 * from another chapter.
 */

const PREF_A = '0a000000-0000-4000-8000-000000000210';
const PREF_B = '0b000000-0000-4000-8000-000000000210';
const CHANNEL_SHARED = '0c000000-0000-4000-8000-000000000210';

/**
 * A second member holding their own row in the same chapter. The batched read
 * groups rows by user, and a grouping bug (every row landing in one bucket)
 * is invisible against a fixture where only one user has a row at all — the
 * single-user fixture below cannot tell "grouped correctly" from "grouped into
 * the only key there is".
 */
const PREF_A_OTHER = '0a000000-0000-4000-8000-000000000211';
const PREF_B_OTHER = '0b000000-0000-4000-8000-000000000211';
const CHANNEL_OTHER = '0c000000-0000-4000-8000-000000000211';

/**
 * Row ids out of a result, for the twin assertions below.
 *
 * `id` is deliberately NOT on `ChatNotificationPreferenceRow` and not in any of
 * this repository's `select()` lists — no caller reads it, and the batched read
 * uses it only as an `order()` key, which PostgREST does not require projected.
 * The harness supplies it anyway because it ignores the select projection (its
 * own docblock says so), and these tests need it: the fixture is built from
 * colliding twins that are identical in every column **except `id` and
 * `chapter_id`**, so `id` is the only thing that can prove chapter B's row came
 * back rather than chapter A's.
 *
 * The cast is that coupling, stated once and named, rather than four silent
 * `r.id` accesses that type-error the moment specs enter a typechecked project.
 */
const idsOf = (rows: readonly object[] | undefined): unknown[] =>
  (rows ?? []).map((row) => (row as { id: unknown }).id);

const seed = () => ({
  chat_notification_preferences: [
    inA({
      id: PREF_A,
      user_id: USER_SHARED,
      scope: 'channel',
      scope_id: CHANNEL_SHARED,
      scope_kind: null,
      level: 'all',
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: PREF_B,
      user_id: USER_SHARED,
      scope: 'channel',
      scope_id: CHANNEL_SHARED,
      scope_kind: null,
      level: 'all',
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
    inA({
      id: PREF_A_OTHER,
      user_id: USER_A,
      scope: 'channel',
      scope_id: CHANNEL_OTHER,
      scope_kind: null,
      level: 'off',
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: PREF_B_OTHER,
      user_id: USER_A,
      scope: 'channel',
      scope_id: CHANNEL_OTHER,
      scope_kind: null,
      level: 'off',
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('ChatNotificationPreferenceRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: ChatNotificationPreferenceRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
    });
    repo = new ChatNotificationPreferenceRepository(harness.client);
  });

  it('findForUsers returns only the caller chapter prefs for the shared user', async () => {
    const byUser = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findForUsers([USER_SHARED], CHAPTER_B),
    );

    expect(idsOf(byUser.get(USER_SHARED))).toEqual([PREF_B]);
  });

  /**
   * The grouping contract the worker's `?? []` fallback rests on: a user who
   * was asked about but holds no rows is **absent** from the map, not present
   * with an empty array, and one user's rows never leak into another's bucket.
   *
   * Pinned because this is the specific thing that breaks when a per-row query
   * becomes a grouped one — the old per-user method could not get it wrong,
   * since each call returned exactly one user's rows by construction.
   */
  it('findForUsers groups by user and omits users with no rows', async () => {
    const byUser = await repo.findForUsers(
      [USER_SHARED, USER_A, 'no-prefs-user'],
      CHAPTER_B,
    );

    // Each member gets their OWN row, not the other's. Two users with rows is
    // what makes this assertion able to fail: against a single-user fixture,
    // dumping every row into one bucket looks identical to grouping correctly.
    expect(idsOf(byUser.get(USER_SHARED))).toEqual([PREF_B]);
    expect(idsOf(byUser.get(USER_A))).toEqual([PREF_B_OTHER]);

    // Absent, not present-and-empty — this is the shape the worker's `?? []`
    // fallback is written against. Asserted with `has`, not with
    // `get(...) ?? []`: `undefined ?? []` is `[]`, so that form passes whenever
    // this line does and pins nothing of its own.
    expect(byUser.has('no-prefs-user')).toBe(false);
  });

  /**
   * An empty audience resolves to an empty map without touching the database.
   *
   * `chunkIds([])` already yields no chunks, so today the explicit early return
   * is belt-and-braces rather than the only thing preventing a query — this
   * pins the observable contract instead, which is what would break if the
   * chunking were ever removed and `in ('user_id', [])` were issued directly.
   * That request is well-formed and, depending on the PostgREST version,
   * returns every row the remaining filters allow rather than none.
   */
  it('findForUsers issues no query for an empty audience', async () => {
    const before = harness.ops.length;

    await expect(repo.findForUsers([], CHAPTER_B)).resolves.toEqual(new Map());

    expect(harness.ops.length).toBe(before);
  });

  /**
   * The paging loop, which the tenant harness cannot reach: its fixture is a
   * handful of rows, so every read there comes back short on the first page and
   * the loop body runs exactly once. Truncation is the failure this paging
   * exists to prevent, and it is silent — PostgREST caps at `max_rows` with a
   * plain 200 and a null error — so an untested loop is the worst kind.
   *
   * Driven through a stub client that hands back scripted pages, because what
   * needs pinning is the *arithmetic* (which windows are requested, and that a
   * full page is followed by another request) rather than any database
   * behaviour.
   */
  describe('findForUsers paging', () => {
    /**
     * `pages` is the script ONE chunk walks; each chunk walks it independently.
     *
     * A fresh builder per `select()`, and a page cursor keyed by the chunk's own
     * id list — deliberately, not incidentally. `fetchAllPages` re-invokes the
     * query callback every iteration and the chunks run concurrently under
     * `Promise.all`, so a
     * single shared chain with one counter would hand chunk 2 the page scripted
     * for chunk 1's second iteration. Today's scripts happen not to expose that
     * (every multi-page test uses a single chunk), which is exactly the kind of
     * accident that turns into a wrong test the moment someone adds the obvious
     * next case — a multi-chunk audience that pages more than once.
     */
    function pagingRepo(pages: { user_id: string }[][]) {
      const ranges: [number, number][] = [];
      const orderedBy: string[] = [];
      const inLists: string[][] = [];
      const pagesServed = new Map<string, number>();
      const client = {
        from: () => ({
          select: () => {
            let chunkKey = '';
            const chain: Record<string, unknown> = {
              in: (_column: string, values: string[]) => {
                chunkKey = values.join(',');
                inLists.push(values);
                return chain;
              },
              eq: () => chain,
              order: (column: string) => {
                orderedBy.push(column);
                return chain;
              },
              range: (from: number, to: number) => {
                ranges.push([from, to]);
                const page = pagesServed.get(chunkKey) ?? 0;
                pagesServed.set(chunkKey, page + 1);
                return Promise.resolve({
                  data: pages[page] ?? [],
                  error: null,
                });
              },
            };
            return chain;
          },
        }),
      };
      const repo = new ChatNotificationPreferenceRepository(client as never);
      return { repo, ranges, orderedBy, inLists };
    }

    const rowsFor = (userId: string, count: number) =>
      Array.from({ length: count }, () => ({ user_id: userId }));

    it('reads every page and stops on the empty one', async () => {
      const { repo: paged, ranges } = pagingRepo([
        rowsFor('u1', PREFERENCE_PAGE_SIZE),
        rowsFor('u1', 3),
        [],
      ]);

      const byUser = await paged.findForUsers(['u1'], CHAPTER_B);

      // Every row from both non-empty pages, none dropped, none double-counted.
      expect(byUser.get('u1')).toHaveLength(PREFERENCE_PAGE_SIZE + 3);
      // Contiguous, non-overlapping windows, each starting where the rows that
      // actually ARRIVED left off. `range` is inclusive on both ends, so an
      // off-by-one here either skips a row or reads one twice.
      expect(ranges).toEqual([
        [0, PREFERENCE_PAGE_SIZE - 1],
        [PREFERENCE_PAGE_SIZE, PREFERENCE_PAGE_SIZE * 2 - 1],
        [PREFERENCE_PAGE_SIZE + 3, PREFERENCE_PAGE_SIZE * 2 + 2],
      ]);
    });

    /**
     * The #686 rule, and the reason this loop does not stop on a short page.
     *
     * A short page is indistinguishable from the server capping the response at
     * its `max_rows`. `supabase/config.toml`'s `max_rows = 1000` governs the
     * LOCAL stack only — the hosted project's Max rows is a dashboard setting
     * this code cannot read — so "our page size is below the cap" is not
     * something any file here can assert. #1628 tracks the copies of this loop
     * that still get it wrong.
     */
    it('does not treat a short page as the end of the rows', async () => {
      const { repo: paged, ranges } = pagingRepo([
        // Every page is far short of the requested 500, as a server whose cap
        // sits below PREFERENCE_PAGE_SIZE would return.
        rowsFor('u1', 3),
        rowsFor('u1', 2),
        [],
      ]);

      const byUser = await paged.findForUsers(['u1'], CHAPTER_B);

      // All five rows. Stopping on the first short page would yield three and
      // silently drop the rest, with a 200 and a null error.
      expect(byUser.get('u1')).toHaveLength(5);
      // Advanced by rows ARRIVED (3, then 5), never by rows requested — a
      // capped page leaves the tail of the requested window unread, and
      // stepping over it drops those rows outright.
      expect(ranges).toEqual([
        [0, PREFERENCE_PAGE_SIZE - 1],
        [3, PREFERENCE_PAGE_SIZE + 2],
        [5, PREFERENCE_PAGE_SIZE + 4],
      ]);
    });

    /**
     * The 414 guard. A chapter-sized id list in a single `in (...)` overflows
     * the request line — measured in `domain/utils/chunk-ids`, where 200 UUIDs
     * succeeded and 250 returned `414 URI Too Long`. That failure is what the
     * report roster hit before its chunking was added, and it takes down the
     * whole read rather than degrading.
     *
     * Asserted on the id lists actually sent, not just the request count, so a
     * chunking that split the requests but re-sent every id in each one would
     * still fail.
     */
    it('splits a chapter-sized audience into chunked in() lists', async () => {
      const audience = Array.from({ length: 250 }, (_, i) => `user-${i}`);
      const { repo: paged, inLists } = pagingRepo([]);

      await paged.findForUsers(audience, CHAPTER_B);

      expect(inLists.map((ids) => ids.length)).toEqual([100, 100, 50]);
      // Every member asked about exactly once, across all chunks.
      expect(inLists.flat().sort()).toEqual([...audience].sort());
    });

    /**
     * Offset paging over a non-unique sort key has no guaranteed order between
     * statements, so a row sharing a sort value across a page boundary can be
     * served twice or skipped. `user_id` is NOT unique here — a member may hold
     * a channel row and a kind row — so the sort is on `id`, the primary key,
     * which is unconditionally total and is the key every other paged read in
     * this repo uses.
     */
    it('orders by a total key so page boundaries are stable', async () => {
      const { repo: paged, orderedBy } = pagingRepo([[]]);

      await paged.findForUsers(['u1'], CHAPTER_B);

      expect(orderedBy).toEqual(['id']);
    });

    /**
     * A failed chunk costs its own members their preferences for this message
     * and nothing more. Two failure shapes are wrong and both were live in an
     * earlier draft of this method: returning early abandons the chunks that
     * had not run yet, stripping preferences from members whose query would
     * have succeeded; and keeping the rows read before the error leaves a user
     * present with an INCOMPLETE set, which resolves to a different level than
     * absence does (a missing channel row falls through to a kind row or the
     * channel-name default rather than to "no preference").
     */
    it('drops only the failing chunk, whole, and still reads the others', async () => {
      const audience = Array.from({ length: 150 }, (_, i) => `user-${i}`);
      // Keyed by which chunk is asking, not by a global request counter: the
      // chunks run concurrently, so a counter would interleave them and the
      // test would be scripting something other than what it claims.
      const pagesServed = new Map<string, number>();
      const failingRepo = new ChatNotificationPreferenceRepository({
        from: () => ({
          // A fresh builder per page — the paged read rebuilds the query on
          // every iteration, so per-chain state would reset and prove nothing.
          select: () => {
            let ids: string[] = [];
            const chain: Record<string, unknown> = {
              in: (_column: string, values: string[]) => {
                ids = values;
                return chain;
              },
              eq: () => chain,
              order: () => chain,
              range: () => {
                const chunk = ids.includes('user-0') ? 'first' : 'second';
                const page = (pagesServed.get(chunk) ?? 0) + 1;
                pagesServed.set(chunk, page);

                if (chunk === 'first') {
                  // A full page lands, THEN the read errors — so there really
                  // are rows in hand that a partial return would keep.
                  return page === 1
                    ? Promise.resolve({
                        data: rowsFor('user-0', PREFERENCE_PAGE_SIZE),
                        error: null,
                      })
                    : Promise.resolve({
                        data: null,
                        error: { message: 'boom', code: '57014' },
                      });
                }
                return page === 1
                  ? Promise.resolve({
                      data: rowsFor('user-100', 2),
                      error: null,
                    })
                  : Promise.resolve({ data: [], error: null });
              },
            };
            return chain;
          },
        }),
      } as never);

      const byUser = await failingRepo.findForUsers(audience, CHAPTER_B);

      // The failed chunk's member is absent, not half-populated.
      expect(byUser.has('user-0')).toBe(false);
      // The chunk that succeeded is unaffected.
      expect(byUser.get('user-100')).toHaveLength(2);
    });

    /**
     * The degradation covers a failed QUERY, not a broken read.
     *
     * A PostgREST failure arrives as a plain `{ code, message, ... }` object,
     * so an `Error` instance means something else went wrong — here, a 200
     * carrying a non-array body, which makes the paging helper's spread throw
     * `TypeError: … is not iterable`. Swallowing that would hand back an empty
     * map, and an absent user reads as "stored no preferences", i.e. *not
     * muted*: every member of the chunk would be pushed for every message,
     * chapter-wide, behind nothing but a WARN. It has to reach the worker's
     * outer handler instead, which reports it.
     */
    it('rethrows a non-query failure instead of degrading to "no preferences"', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const chain: Record<string, unknown> = {
        in: () => chain,
        eq: () => chain,
        order: () => chain,
        // A 200 with a non-array body: postgrest-js reports no error, so the
        // helper spreads a non-iterable and throws a real `Error`.
        range: () => Promise.resolve({ data: {}, error: null }),
      };
      const brokenRepo = new ChatNotificationPreferenceRepository({
        from: () => ({ select: () => chain }),
      } as never);

      try {
        await expect(
          brokenRepo.findForUsers(['u1'], CHAPTER_B),
        ).rejects.toThrow(TypeError);
        // Not laundered into the degraded path on the way out.
        expect(warn).not.toHaveBeenCalled();
      } finally {
        warn.mockRestore();
      }
    });

    /**
     * A PostgREST error carries `details`, which is Postgres' row-value
     * channel — it can quote the offending row, including a `Key (user_id)=(…)`
     * fragment, into plaintext application logs. #1669 is the open issue for
     * call sites that hand the whole error object to a logger; this one builds
     * a string through `toReportableError`, which joins `code`, `message` and
     * `hint` and drops `details`.
     *
     * The assertions below pin the property, not the formatting: one string
     * argument, the diagnostic fields present, the row value absent. That
     * outlives the interpolation moving into the shared normalizer, which is
     * exactly what happened to the hand-built `code: message` line this
     * replaced. `hint` is asserted too, because the shared helper emits it and
     * the line it replaced did not — a widening worth a test rather than a
     * silent one.
     */
    it('logs the error message and code, never the raw PostgrestError', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const chain: Record<string, unknown> = {
        in: () => chain,
        eq: () => chain,
        order: () => chain,
        range: () =>
          Promise.resolve({
            data: null,
            error: {
              message: 'boom',
              code: '23503',
              hint: 'Perhaps you meant to reference the column "users.id".',
              details: 'Key (user_id)=(secret-uuid) is not present in "users".',
            },
          }),
      };
      const failingRepo = new ChatNotificationPreferenceRepository({
        from: () => ({ select: () => chain }),
      } as never);

      // try/finally, not a trailing `mockRestore()`: this project sets none of
      // Jest's auto-reset options, so a failing assertion below would leave
      // `Logger.prototype.warn` a no-op for every test that runs after it —
      // silencing the diagnostic output of the sibling failure tests at exactly
      // the moment someone is reading them to debug this one.
      try {
        await failingRepo.findForUsers(['u1', 'u2'], CHAPTER_B);

        expect(warn).toHaveBeenCalledTimes(1);
        // One argument, and it is a string: passing the error as a second
        // argument is what serializes every field of it, `details` included.
        const [message, ...rest] = warn.mock.calls[0];
        expect(rest).toEqual([]);
        expect(typeof message).toBe('string');
        expect(message).toContain('23503');
        expect(message).toContain('boom');
        expect(message).toContain('Perhaps you meant');
        expect(message).not.toContain('secret-uuid');
        // The failing chunk has to be locatable. This degradation is silent —
        // its members read as "no stored preferences", which `decidePush`
        // treats as *not muted* — so the only symptom is a member pushed
        // despite an explicit `off`, and a line naming a bare count leaves an
        // operator holding that report with nothing to place it against.
        expect(message).toContain('chunk 1/1');
        expect(message).toContain('2 users');
        // And it must stay BOUNDED: no member ids, however few are in play.
        // A fixture of two ids is what makes this bite — with one, a
        // `chunk.join(', ')` or `chunk[0]` regression is indistinguishable from
        // the position form, and both are things a "make this more helpful"
        // edit reaches for. Ids here would be worse than useless: `findByChapter`
        // reads the roster unordered, so an id names one member of the chunk
        // and implies the rest were fine (#1772).
        expect(message).not.toContain('u1');
        expect(message).not.toContain('u2');
      } finally {
        warn.mockRestore();
      }
    });
  });

  /**
   * Same binding, on the read that backs the mute UI (#296). The worker's
   * lookup and the UI's lookup are separate methods, so tenant scope has to be
   * pinned on both — a `chapter_id` filter dropped from one would not be caught
   * by the other's test.
   */
  it('findChannelPreferencesForUser binds chapter_id too', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findChannelPreferencesForUser(USER_SHARED, CHAPTER_B),
    );

    expect(idsOf(rows)).toEqual([PREF_B]);
  });

  /**
   * The kind arm's read (#500). Same reasoning as the channel read above: a
   * `chapter_id` filter dropped from this one would be caught by neither of
   * the other two tests.
   */
  it('findKindPreferencesForUser binds chapter_id too', async () => {
    const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findKindPreferencesForUser(USER_SHARED, CHAPTER_B),
    );

    // The seed holds only channel-scoped rows, so the scope filter must
    // exclude both of them — an assertion that would fail if this method
    // stopped filtering on `scope`, which is what keeps the two UI reads from
    // reporting each other's rows.
    expect(rows).toEqual([]);
  });

  /**
   * The only DESTRUCTIVE method on this repository, and the one where a lost
   * `chapter_id` filter is worst: RLS is bypassed on the service-role client,
   * so these `.eq()` calls are the entire tenant boundary. A member of two
   * chapters clearing an override in one must not lose it in the other.
   *
   * Pinned here rather than in `chat.service.spec.ts`, where the repository is
   * mocked and the filter chain is therefore invisible.
   */
  it('deleteKindLevel binds user, chapter and scope', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.deleteKindLevel(USER_SHARED, CHAPTER_B, 'system_audit'),
    );

    const op = harness.ops.at(-1);
    expect(op?.mode).toBe('delete');

    const bound = Object.fromEntries(
      (op?.filters ?? [])
        .filter((f) => f.op === 'eq')
        .map((f) => [f.column, f.value]),
    );
    expect(bound).toEqual({
      user_id: USER_SHARED,
      chapter_id: CHAPTER_B,
      scope: 'kind',
      scope_kind: 'system_audit',
    });

    // Chapter A's row for the same user is untouched. `expectTenantScoped`
    // already proves no foreign row was written, but stating it directly is
    // what makes this test readable as "the other chapter survives".
    expect(
      harness.rows('chat_notification_preferences').map((r) => r.id),
    ).toContain(PREF_A);
  });

  /**
   * The two reads differ deliberately on error handling, and it is worth
   * pinning because it looks like an inconsistency.
   *
   * `findForUsers` swallows: a failed preference lookup must not stop the
   * worker deciding a push at all, and a missed mute beats a dropped
   * notification. `findChannelPreferencesForUser` throws: there the array IS
   * the answer, so an empty list on a database error would render every channel
   * as unmuted — indistinguishable from the user having muted nothing, and the
   * UI would silently misreport their own settings back to them.
   */
  it('the UI read throws on error where the worker read degrades', async () => {
    const failing = createTenantHarness({ tables: seed() });
    const failure = { data: null, error: { message: 'boom' } };
    // Chainable AND thenable, so the same failure lands whatever the builder
    // depth or call order. That generality is the point: an earlier fixed-depth
    // mock terminated after exactly three `.eq()` calls, so
    // `findChannelPreferencesForUser` (which makes exactly three) saw the error
    // while a method with any other builder shape sailed past it, awaited a
    // plain object, read `error` as `undefined`, and returned through the happy
    // path — leaving the assertion on it vacuous.
    //
    // The two methods asserted below have different chain shapes —
    // `findChannelPreferencesForUser` is `select` + three `eq`,
    // `findForUsers` is `select` + `in` + `eq` + `order` + `range` — so a
    // depth-sensitive stub would silently stop testing one of them.
    const chain: Record<string, unknown> = {
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      range: () => chain,
      then: (resolve: (v: typeof failure) => unknown) => resolve(failure),
    };
    jest.spyOn(failing.client, 'from').mockReturnValue({
      select: () => chain,
    });
    const failingRepo = new ChatNotificationPreferenceRepository(
      failing.client,
    );

    await expect(
      failingRepo.findChannelPreferencesForUser(USER_SHARED, CHAPTER_B),
    ).rejects.toBeDefined();

    // The other half of the same contract, which this test asserted only in
    // its title. Without it, "harmonising" `findForUsers` to throw would keep
    // this suite green while making a transient PostgREST error propagate out
    // of `handleMessage` — and now that the lookup is batched and hoisted ABOVE
    // the recipient loop, that is strictly worse than it used to be: one failed
    // query would drop the push for every recipient of the message at once,
    // where the per-user read only lost the one member it was called for.
    // `chat-push-worker.service.spec.ts` cannot catch that either: it hardcodes
    // the lookup to resolve.
    const worker = new ChatNotificationPreferenceRepository(failing.client);
    await expect(
      worker.findForUsers([USER_SHARED], CHAPTER_B),
    ).resolves.toEqual(new Map());
  });
});
