import { SupabaseChatCategoryRepository } from './supabase-chat-category.repository';
import {
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/** Tenant scope for `chat_channel_categories` (backs the `use-chat` sidebar). */

const CATEGORY_A = '0a000000-0000-4000-8000-000000000090';
const CATEGORY_B = '0b000000-0000-4000-8000-000000000090';

const seed = () => ({
  chat_channel_categories: [
    inA({
      id: CATEGORY_A,
      name: 'Committees',
      display_order: 1,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: CATEGORY_B,
      name: 'Committees',
      display_order: 1,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseChatCategoryRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChatCategoryRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseChatCategoryRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter categories', async () => {
    const categories = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );

    expect(categories.map((c) => c.id)).toEqual([CATEGORY_B]);
  });

  it('delete leaves another chapter category in place', async () => {
    await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.delete(CATEGORY_A, CHAPTER_B),
    );

    expect(
      harness
        .rows('chat_channel_categories')
        .map((c) => c.id)
        .sort(),
    ).toEqual([CATEGORY_A, CATEGORY_B].sort());
  });
});

/**
 * `display_order` is `int not null default 0` with no unique constraint, and
 * neither the create path (`max + 1` computed from a 60s-stale cached list) nor
 * `UpdateCategoryDto` prevents two categories sharing a value. Ordering on it
 * alone leaves tied rows in arbitrary Postgres order.
 *
 * That is now member-visible: the web chat rail groups the channel sidebar by
 * these rows and takes this order as authoritative rather than re-sorting, so an
 * unstable tie would shuffle a member's sidebar between refetches.
 */
describe('SupabaseChatCategoryRepository — ordering', () => {
  const AHEAD = '0b000000-0000-4000-8000-0000000000a3';
  const FIRST = '0b000000-0000-4000-8000-0000000000a1';
  const SECOND = '0b000000-0000-4000-8000-0000000000a2';

  /**
   * Seeded newest-first, with the lowest `display_order` last, so a repository
   * that returned insertion order would fail every assertion below. `FIRST` and
   * `SECOND` share `display_order: 3` — the tie this suite exists for.
   *
   * Each row gets a chapter-A twin identical in every column but `id` and
   * `chapter_id`, which is what the harness requires: colliding twins are what
   * prove the tenant filter — and not some other predicate — is narrowing the
   * result. It also means a broken filter returns six rows and the id
   * assertions fail, rather than the leak passing unnoticed.
   */
  const ROWS = [
    { id: SECOND, name: 'Alumni', display_order: 3, created_at: '2026-02-02' },
    {
      id: FIRST,
      name: 'Committees',
      display_order: 3,
      created_at: '2026-01-01',
    },
    {
      id: AHEAD,
      name: 'Executive',
      display_order: 1,
      created_at: '2026-03-03',
    },
  ];

  let harness: TenantHarness;
  let repo: SupabaseChatCategoryRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        chat_channel_categories: ROWS.flatMap(({ id, created_at, ...rest }) => {
          const row = { ...rest, created_at: `${created_at}T00:00:00.000Z` };
          return [
            inA({ ...row, id: id.replace(/^0b/, '0a') }),
            inB({ ...row, id }),
          ];
        }),
      },
    });
    repo = new SupabaseChatCategoryRepository(harness.client);
  });

  it('orders by display_order first', async () => {
    const categories = await repo.findByChapter(CHAPTER_B);

    // `Executive` is newest but has the lowest display_order, so it leads.
    expect(categories[0]?.id).toBe(AHEAD);
  });

  it('breaks a display_order tie by created_at, oldest first', async () => {
    const categories = await repo.findByChapter(CHAPTER_B);

    expect(categories.map((c) => c.id)).toEqual([AHEAD, FIRST, SECOND]);
  });
});
