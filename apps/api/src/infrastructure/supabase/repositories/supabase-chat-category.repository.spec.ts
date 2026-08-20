import { SupabaseChatCategoryRepository } from './supabase-chat-category.repository';
import {
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '../../../../test/helpers/tenant-scope.harness';

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
