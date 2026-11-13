import { SupabaseChapterDocumentTypeRepository } from './supabase-chapter-document-type.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chapter_document_types` (#3642). Every chapter is seeded
 * with the same six names, so `findByName` without its chapter predicate
 * would resolve another chapter's "Bylaws".
 */

const TYPE_A = '0a000000-0000-4000-8000-0000000000c0';
const TYPE_B = '0b000000-0000-4000-8000-0000000000c0';

const seed = () => ({
  chapter_document_types: [
    inA({
      id: TYPE_A,
      name: 'Bylaws',
      sort_order: 1,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
    inB({
      id: TYPE_B,
      name: 'Bylaws',
      sort_order: 1,
      created_at: '2026-01-01T00:00:00.000Z',
    }),
  ],
});

describe('SupabaseChapterDocumentTypeRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseChapterDocumentTypeRepository;

  beforeEach(() => {
    harness = createTenantHarness({ tables: seed() });
    repo = new SupabaseChapterDocumentTypeRepository(harness.client);
  });

  it('findByChapter returns only the caller chapter types', async () => {
    const types = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByChapter(CHAPTER_B),
    );
    expect(types.map((t) => t.id)).toEqual([TYPE_B]);
  });

  it('findByName does not resolve the same name in another chapter', async () => {
    const type = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByName(CHAPTER_B, 'bylaws'),
    );
    expect(type?.id).toBe(TYPE_B);
  });

  it('findById does not return another chapter type', async () => {
    const type = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findById(TYPE_A, CHAPTER_B),
    );
    expect(type).toBeNull();
  });

  it('findByName matches the key, not a pattern: `*` and punctuation are characters', async () => {
    const byKey = await harness.expectTenantScoped(CHAPTER_B, () =>
      repo.findByName(CHAPTER_B, 'BY-LAWS'),
    );
    expect(byKey?.id).toBe(TYPE_B);
    await expect(repo.findByName(CHAPTER_B, 'B*')).resolves.toBeNull();
    await expect(repo.findByName(CHAPTER_B, '*')).resolves.toBeNull();
  });

  it('setSortOrder is scoped to the chapter', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.setSortOrder(TYPE_A, CHAPTER_A, 3),
    );
  });

  it('rename and delete pass the chapter to the database functions', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.rename(CHAPTER_A, TYPE_A, 'Constitution'),
    );
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.deleteWithDocuments(CHAPTER_A, TYPE_A),
    );
    expect(harness.rpcCalls.map((call) => call.fn)).toEqual([
      'rename_chapter_document_type',
      'delete_chapter_document_type',
    ]);
  });
});
