import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
} from '#test/helpers/tenant-scope.harness';
import type { FrappSupabaseClient } from '../database.types';

/**
 * Self-test for the tenant-scope harness.
 *
 * The repository specs in this directory are only worth their runtime if the
 * harness fails when a tenant filter is missing. A harness that always passes
 * looks exactly like a well-scoped codebase, and it would be discovered the way
 * these things always are — after a leak.
 *
 * So each guard is exercised against a deliberately broken repository stand-in
 * and asserted to throw. `scopedFindByChapter` and `leakyFindByChapter` differ by
 * one `.eq('chapter_id', …)` call; that single line is the whole difference
 * between the two outcomes below.
 *
 * It lives beside the repository specs rather than beside the harness because it
 * has to run in the same suite they do — `test/helpers/` is outside the unit
 * config's `rootDir`, so a spec there would be collected by no suite at all.
 */

const ROW_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ROW_B = 'bbbbbbbb-0000-4000-8000-000000000001';

const widgets = () => ({
  widgets: [
    inA({
      id: ROW_A,
      user_id: USER_SHARED,
      name: 'Treasurer',
      archived: false,
    }),
    inB({
      id: ROW_B,
      user_id: USER_SHARED,
      name: 'Treasurer',
      archived: false,
    }),
  ],
});

/** A correctly scoped read. */
async function scopedFindByChapter(
  supabase: FrappSupabaseClient,
  chapterId: string,
) {
  const { data } = await (supabase as any)
    .from('widgets')
    .select('*')
    .eq('chapter_id', chapterId);
  return data as unknown[];
}

/** The same read with the tenant filter dropped — the bug this all exists for. */
async function leakyFindByChapter(
  supabase: FrappSupabaseClient,
  _chapterId: string,
) {
  const { data } = await (supabase as any).from('widgets').select('*');
  return data as unknown[];
}

describe('tenant-scope harness', () => {
  describe('read scoping', () => {
    it('passes a repository that filters by chapter_id', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      const rows = await harness.expectTenantScoped(CHAPTER_B, () =>
        scopedFindByChapter(harness.client, CHAPTER_B),
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: ROW_B, chapter_id: CHAPTER_B });
    });

    it('fails a repository that drops the tenant filter', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      await expect(
        harness.expectTenantScoped(CHAPTER_B, () =>
          leakyFindByChapter(harness.client, CHAPTER_B),
        ),
      ).rejects.toThrow(/ran without a tenant predicate/);
    });

    it('fails a repository that filters on the wrong column', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      // `.eq('id', chapterId)` type-checks and is the exact class of bug the
      // type-wiring in #1083 could not catch.
      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          const { data } = await (harness.client as any)
            .from('widgets')
            .select('*')
            .eq('id', CHAPTER_B);
          return data as unknown[];
        }),
      ).rejects.toThrow(/ran without a tenant predicate/);
    });

    it('reports rows that leak through even when a predicate is present', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      // A predicate is present but the returned payload carries a foreign row —
      // the shape an embed or a hand-assembled response can produce.
      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          await (harness.client as any)
            .from('widgets')
            .select('*')
            .eq('chapter_id', CHAPTER_B);
          return [{ id: ROW_A, chapter_id: CHAPTER_A }];
        }),
      ).rejects.toThrow(/returned 1 row\(s\) from another chapter/);
    });

    /**
     * The read-side walk has to see inside a `Map`, and this is the failing
     * case that proves it does.
     *
     * A `Map`'s entries are not own enumerable properties, so `Object.values()`
     * on one returns `[]`. Before the walk handled `Map` explicitly, a
     * repository that grouped its rows — `ChatNotificationPreferenceRepository.
     * findForUsers` returns `Map<userId, rows>` — had its returned payload
     * inspected for nothing at all, while `expectTenantScoped` still reported
     * "scoped". A passing-direction test cannot catch that: it is green either
     * way. This one is red unless the branch exists.
     */
    it('reports rows that leak inside a Map or a Set', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      const scopedRead = async () => {
        await (harness.client as any)
          .from('widgets')
          .select('*')
          .eq('chapter_id', CHAPTER_B);
      };

      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          await scopedRead();
          return new Map([
            ['some-user-id', [{ id: ROW_A, chapter_id: CHAPTER_A }]],
          ]);
        }),
      ).rejects.toThrow(/returned 1 row\(s\) from another chapter/);

      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          await scopedRead();
          return new Set([{ id: ROW_A, chapter_id: CHAPTER_A }]);
        }),
      ).rejects.toThrow(/returned 1 row\(s\) from another chapter/);
    });

    /**
     * Walking Maps and Sets removed an accidental cycle barrier — a Map used to
     * end the walk by yielding no values — so the traversal carries a seen-set.
     * A tenancy assertion that dies with `RangeError: Maximum call stack size
     * exceeded` reads as an unrelated bug, which is the confusion this harness
     * orders its checks to avoid.
     */
    it('survives a cyclic result rather than overflowing the stack', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      const leaked: Record<string, unknown> = {
        id: ROW_A,
        chapter_id: CHAPTER_A,
      };
      // parent ↔ child back-reference, threaded through a Map.
      leaked.group = new Map([['self', leaked]]);

      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          await (harness.client as any)
            .from('widgets')
            .select('*')
            .eq('chapter_id', CHAPTER_B);
          return [leaked];
        }),
      ).rejects.toThrow(/returned 1 row\(s\) from another chapter/);
    });
  });

  describe('write scoping', () => {
    it('passes an update scoped to the caller chapter', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      await harness.expectTenantScoped(CHAPTER_B, async () => {
        await (harness.client as any)
          .from('widgets')
          .update({ archived: true })
          .eq('id', ROW_B)
          .eq('chapter_id', CHAPTER_B);
      });

      const rows = harness.rows('widgets');
      expect(rows.find((r) => r.id === ROW_B)!.archived).toBe(true);
      expect(rows.find((r) => r.id === ROW_A)!.archived).toBe(false);
    });

    it('fails an update that reaches into another chapter', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          // Updating by id alone: correct-looking, and it happily rewrites the
          // other chapter's row when the id belongs to that chapter.
          await (harness.client as any)
            .from('widgets')
            .update({ archived: true })
            .eq('id', ROW_A);
        }),
      ).rejects.toThrow(/ran without a tenant predicate/);
    });

    it('fails when the predicate binds a different chapter than the caller', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          await (harness.client as any)
            .from('widgets')
            .update({ archived: true })
            .eq('chapter_id', CHAPTER_A);
        }),
      ).rejects.toThrow(/ran without a tenant predicate/);
    });

    it('fails a correctly-scoped write whose payload reassigns the chapter', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      // The query is scoped properly; the payload is what escapes. Only the
      // before/after row comparison can see this.
      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          await (harness.client as any)
            .from('widgets')
            .update({ chapter_id: CHAPTER_A })
            .eq('id', ROW_B)
            .eq('chapter_id', CHAPTER_B);
        }),
      ).rejects.toThrow(/was REASSIGNED from chapter/);
    });

    it('fails a delete that removes another chapter row', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          await (harness.client as any)
            .from('widgets')
            .delete()
            .eq('id', ROW_A);
        }),
      ).rejects.toThrow(/ran without a tenant predicate/);
    });

    it('honours an upsert conflict target that includes the chapter', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      // A conflict target without `chapter_id` would merge onto whichever twin
      // matched first. Modelling `onConflict` is what lets a spec prove the
      // chapter is part of the key.
      await harness.expectTenantScoped(CHAPTER_B, async () => {
        await (harness.client as any)
          .from('widgets')
          .upsert(
            {
              user_id: USER_SHARED,
              chapter_id: CHAPTER_B,
              name: 'Treasurer',
              archived: true,
            },
            { onConflict: 'user_id,chapter_id,name' },
          )
          .select()
          .single();
      });

      const rows = harness.rows('widgets');
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.id === ROW_B)!.archived).toBe(true);
      expect(rows.find((r) => r.id === ROW_A)!.archived).toBe(false);
    });

    it('fails an insert written under another chapter', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          await (harness.client as any)
            .from('widgets')
            .insert({ id: 'new', chapter_id: CHAPTER_A, name: 'Treasurer' })
            .select()
            .single();
        }),
      ).rejects.toThrow(/carried chapter_id/);
    });
  });

  describe('predicates that only look like scoping', () => {
    it('does not accept a tenant filter that is one arm of an .or()', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      // `.or('chapter_id.eq.B,name.eq.Treasurer')` returns *both* chapters,
      // because the second arm matches the twin by design. Flattening the
      // disjuncts into the conjunctive filter list would make this read as a
      // bound tenant predicate.
      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          const { data } = await (harness.client as any)
            .from('widgets')
            .select('id')
            .or(`chapter_id.eq.${CHAPTER_B},name.eq.Treasurer`);
          return (data as { id: string }[]).map((r) => r.id);
        }),
      ).rejects.toThrow(/\.or\(\) group\(s\), which do not count/);
    });

    it('fails when nothing was queried at all', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      // A method that early-returns on an empty input list would otherwise be
      // certified "tenant-scoped" without touching the database.
      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => []),
      ).rejects.toThrow(/issued no query and no RPC/);
    });

    it('checks every RPC in the window, not just calls that touched no table', async () => {
      const harness = createTenantHarness({
        tables: widgets(),
        rpc: { do_thing: { data: [] } },
      });

      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          await (harness.client as any)
            .from('widgets')
            .select('*')
            .eq('chapter_id', CHAPTER_B);
          await (harness.client as any).rpc('do_thing', { p_widget_id: ROW_B });
        }),
      ).rejects.toThrow(/rpc do_thing did not pass p_chapter_id/);
    });

    it('checks the chapter argument by name, not by value anywhere in the args', async () => {
      const harness = createTenantHarness({
        tables: widgets(),
        rpc: { check_in: { data: [] } },
      });

      // Transposing two arguments is an ordinary refactor slip, and a
      // "some argument equals the chapter" check certifies it.
      await expect(
        harness.expectTenantScoped(CHAPTER_B, () =>
          (harness.client as any).rpc('check_in', {
            p_user_id: CHAPTER_B,
            p_chapter_id: USER_SHARED,
          }),
        ),
      ).rejects.toThrow(/did not pass p_chapter_id/);
    });

    it('does not let an earlier call satisfy a later unscoped RPC', async () => {
      const harness = createTenantHarness({
        tables: widgets(),
        rpc: { scoped: { data: [] }, unscoped: { data: [] } },
      });

      await harness.expectTenantScoped(CHAPTER_B, () =>
        (harness.client as any).rpc('scoped', { p_chapter_id: CHAPTER_B }),
      );

      // Reading the whole RPC history rather than the current window would let
      // the first call's argument vouch for the second.
      await expect(
        harness.expectTenantScoped(CHAPTER_B, () =>
          (harness.client as any).rpc('unscoped', { p_widget_id: ROW_B }),
        ),
      ).rejects.toThrow(/rpc unscoped did not pass p_chapter_id/);
    });
  });

  describe('indirectly scoped tables', () => {
    const nested = () => ({
      widgets: [
        inA({ id: ROW_A, name: 'Treasurer' }),
        inB({ id: ROW_B, name: 'Treasurer' }),
      ],
      parts: [
        { id: 'part-a', widget_id: ROW_A, label: 'bolt' },
        { id: 'part-b', widget_id: ROW_B, label: 'bolt' },
      ],
    });

    const harnessFor = () =>
      createTenantHarness({
        tables: nested(),
        untenantedTables: ['parts'],
        parentTenant: { parts: { column: 'widget_id', table: 'widgets' } },
      });

    it('catches a write that reaches the other chapter through the parent', async () => {
      const harness = harnessFor();

      // `parts` has no chapter_id, so the predicate check cannot run. Resolving
      // through `widget_id` is what keeps the write check alive — without it
      // this update passes silently.
      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          await (harness.client as any)
            .from('parts')
            .update({ label: 'nut' })
            .eq('label', 'bolt');
        }),
      ).rejects.toThrow(/belongs to chapter .* and was MUTATED/);
    });

    it('catches a delete that empties the other chapter through the parent', async () => {
      const harness = harnessFor();

      await expect(
        harness.expectTenantScoped(CHAPTER_B, async () => {
          await (harness.client as any)
            .from('parts')
            .delete()
            .eq('label', 'bolt');
        }),
      ).rejects.toThrow(/belongs to chapter .* and was DELETED/);
    });

    it('refuses a parent chain whose parent table is not seeded', () => {
      // An unseeded parent makes every child's chapter unknowable, which turns
      // the foreign-write check back off — silently, which is the same failure
      // the twin-collision guard exists to prevent.
      expect(() =>
        createTenantHarness({
          tables: { parts: [{ id: 'part-a', widget_id: ROW_A }] },
          untenantedTables: ['parts'],
          parentTenant: { parts: { column: 'widget_id', table: 'widgets' } },
        }),
      ).toThrow(/resolves its chapter through "widgets", which is not seeded/);
    });

    it('passes a write confined to the caller chapter subtree', async () => {
      const harness = harnessFor();

      await harness.expectTenantScoped(CHAPTER_B, async () => {
        await (harness.client as any)
          .from('parts')
          .update({ label: 'nut' })
          .eq('widget_id', ROW_B);
      });

      const parts = harness.rows('parts');
      expect(parts.find((p) => p.id === 'part-b')!.label).toBe('nut');
      expect(parts.find((p) => p.id === 'part-a')!.label).toBe('bolt');
    });
  });

  describe('fixture guards', () => {
    it('rejects twins that differ on a non-tenant column', () => {
      expect(() =>
        createTenantHarness({
          tables: {
            widgets: [
              inA({ id: ROW_A, name: 'Treasurer' }),
              inB({ id: ROW_B, name: 'President' }),
            ],
          },
        }),
      ).toThrow(/twins differ on "name"/);
    });

    it('accepts a differing column that is declared exempt', () => {
      expect(() =>
        createTenantHarness({
          tables: {
            widgets: [
              inA({ id: ROW_A, name: 'Treasurer', channel_id: 'chan-a' }),
              inB({ id: ROW_B, name: 'Treasurer', channel_id: 'chan-b' }),
            ],
          },
          collisionExempt: { widgets: ['channel_id'] },
        }),
      ).not.toThrow();
    });

    it('rejects a seed that only covers one chapter', () => {
      expect(() =>
        createTenantHarness({
          tables: { widgets: [inA({ id: ROW_A, name: 'Treasurer' })] },
        }),
      ).toThrow(/must be seeded in both chapters/);
    });

    it('rejects an unevenly seeded table instead of skipping the collision check', () => {
      // Returning quietly here would disable the guard the design rests on, for
      // that table, with no signal to the author.
      expect(() =>
        createTenantHarness({
          tables: {
            widgets: [
              inA({ id: ROW_A, name: 'Treasurer' }),
              inA({ id: 'a2', name: 'Secretary' }),
              inB({ id: ROW_B, name: 'President' }),
            ],
          },
        }),
      ).toThrow(/seeded unevenly/);
    });

    it('skips the twin requirement for declared untenanted tables', () => {
      expect(() =>
        createTenantHarness({
          tables: { users: [{ id: USER_SHARED, email: 'a@example.com' }] },
          untenantedTables: ['users'],
        }),
      ).not.toThrow();
    });
  });

  describe('query semantics', () => {
    it('throws on an operator it does not model rather than widening', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      await expect(
        (harness.client as any)
          .from('widgets')
          .select('*')
          .filter('name', 'wildly-unsupported', 'x'),
      ).rejects.toThrow(/unsupported PostgREST operator/);
    });

    it('applies in / is / not and JSON-path columns', async () => {
      const harness = createTenantHarness({
        tables: {
          widgets: [
            inA({ id: ROW_A, meta: { flagged: true }, closed_at: null }),
            inB({ id: ROW_B, meta: { flagged: true }, closed_at: null }),
          ],
        },
      });

      const { data: byIn } = await (harness.client as any)
        .from('widgets')
        .select('*')
        .in('id', [ROW_B]);
      expect(byIn).toHaveLength(1);

      const { data: byIs } = await (harness.client as any)
        .from('widgets')
        .select('*')
        .is('closed_at', null);
      expect(byIs).toHaveLength(2);

      const { data: byNot } = await (harness.client as any)
        .from('widgets')
        .select('*')
        .not('meta->>flagged', 'is', null);
      expect(byNot).toHaveLength(2);
    });

    it('negates with Postgres three-valued logic, not JS truthiness', async () => {
      const harness = createTenantHarness({
        tables: {
          widgets: [
            inA({ id: ROW_A, meta: null }),
            inB({ id: ROW_B, meta: null }),
          ],
        },
      });

      // `NOT (NULL @> '{"flagged":true}')` is NULL in Postgres and the row is
      // dropped. A plain `!` would keep it — widening, which is the direction a
      // tenancy test must never fail in.
      const { data } = await (harness.client as any)
        .from('widgets')
        .select('*')
        .not('meta', 'cs', '{"flagged":true}');

      expect(data).toHaveLength(0);
    });

    it('applies order() so limit(1) means "the latest"', async () => {
      const harness = createTenantHarness({
        tables: {
          widgets: [
            inA({ id: ROW_A, created_at: '2026-01-01' }),
            inB({ id: ROW_B, created_at: '2026-01-01' }),
            inA({ id: 'a2', created_at: '2026-06-01' }),
            inB({ id: 'b2', created_at: '2026-06-01' }),
          ],
        },
      });

      const { data } = await (harness.client as any)
        .from('widgets')
        .select('*')
        .eq('chapter_id', CHAPTER_B)
        .order('created_at', { ascending: false })
        .limit(1);

      // A no-op order would return whichever row the seed listed first.
      expect((data as { id: string }[])[0].id).toBe('b2');
    });

    it('parses .or() literals and the not. prefix', async () => {
      const harness = createTenantHarness({
        tables: {
          widgets: [
            inA({ id: ROW_A, mandatory: true, roles: null }),
            inB({ id: ROW_B, mandatory: true, roles: null }),
          ],
        },
      });

      // The form already shipped in scheduled-jobs.repository.ts. Typing the
      // operand as a string would compare 'true' === true and match nothing.
      const { data } = await (harness.client as any)
        .from('widgets')
        .select('*')
        .or('mandatory.eq.true,roles.not.is.null');

      expect(data).toHaveLength(2);
    });

    it('splits .or() on top-level commas only', async () => {
      const harness = createTenantHarness({
        tables: {
          widgets: [
            inA({ id: ROW_A, title: 'CHEM 101, Midterm' }),
            inB({ id: ROW_B, title: 'CHEM 101, Midterm' }),
          ],
        },
      });

      const { data } = await (harness.client as any)
        .from('widgets')
        .select('*')
        .or('title.ilike."%101, Mid%"');

      expect(data).toHaveLength(2);
    });

    it('maybeSingle reports multiple matches instead of picking one', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      // PostgREST's maybeSingle is "zero or one". Returning rows[0] would make
      // a dropped tenant filter look like a successful lookup.
      const { data, error } = await (harness.client as any)
        .from('widgets')
        .select('*')
        .eq('name', 'Treasurer')
        .maybeSingle();

      expect(data).toBeNull();
      expect(error).toMatchObject({ code: 'PGRST116' });
    });

    it('counts the full match, not the current page', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      const { count } = await (harness.client as any)
        .from('widgets')
        .select('*', { count: 'exact', head: true })
        .limit(1);

      expect(count).toBe(2);
    });

    it('supports count/head queries', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      const { count, data } = await (harness.client as any)
        .from('widgets')
        .select('*', { count: 'exact', head: true })
        .eq('chapter_id', CHAPTER_B);

      expect(count).toBe(1);
      expect(data).toBeNull();
    });

    it('resolves embedded tenant columns through a dotted path', async () => {
      const harness = createTenantHarness({
        tables: {
          messages: [
            inA({ id: ROW_A, chat_channels: { chapter_id: CHAPTER_A } }),
            inB({ id: ROW_B, chat_channels: { chapter_id: CHAPTER_B } }),
          ],
        },
        tenantColumns: { messages: 'chat_channels.chapter_id' },
        collisionExempt: { messages: ['chat_channels'] },
      });

      const rows = await harness.expectTenantScoped(CHAPTER_B, async () => {
        const { data } = await (harness.client as any)
          .from('messages')
          .select('*, chat_channels!inner(chapter_id)')
          .eq('chat_channels.chapter_id', CHAPTER_B);
        return data as unknown[];
      });

      expect(rows).toHaveLength(1);
    });
  });

  describe('isolation between tests', () => {
    it('reset() restores the seed and clears the operation log', async () => {
      const harness = createTenantHarness({ tables: widgets() });

      await (harness.client as any)
        .from('widgets')
        .delete()
        .eq('chapter_id', CHAPTER_B);
      expect(harness.rows('widgets')).toHaveLength(1);
      expect(harness.ops).toHaveLength(1);

      harness.reset();

      expect(harness.rows('widgets')).toHaveLength(2);
      expect(harness.ops).toHaveLength(0);
    });
  });
});
