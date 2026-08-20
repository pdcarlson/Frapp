import {
  CHAPTER_A,
  CHAPTER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
} from '../../../../test/helpers/tenant-scope.harness';
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
      // Wave 0C type-wiring could not catch.
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

    it('skips the twin requirement for declared global tables', () => {
      expect(() =>
        createTenantHarness({
          tables: { users: [{ id: USER_SHARED, email: 'a@example.com' }] },
          globalTables: ['users'],
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
