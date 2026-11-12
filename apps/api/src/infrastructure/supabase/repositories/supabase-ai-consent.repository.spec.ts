import { SupabaseAiConsentRepository } from './supabase-ai-consent.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_A,
  USER_B,
  USER_SHARED,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for `chapter_ai_settings` (#4308), whose key is the chapter.
 * The A/B twins agree on every switch, so a read or write that drops the
 * chapter predicate reaches the other chapter's row.
 *
 * `user_ai_consents` is per person, not per chapter: one answer covers every
 * chapter the person is in, so it is untenanted here and its reads are
 * pinned to the person instead.
 */

const UPDATED = '2026-11-12T10:00:00.000Z';
const NOW = new Date('2026-11-12T11:00:00.000Z');

const settings = () => ({
  ask_enabled: true,
  meeting_notes_enabled: false,
  chat_source_enabled: false,
  updated_by: USER_SHARED,
  updated_at: UPDATED,
});

const seed = () => ({
  // The table's key is `chapter_id`; `id` is only the harness's handle on
  // each row.
  chapter_ai_settings: [
    inA({ id: 'settings-a', ...settings() }),
    inB({ id: 'settings-b', ...settings() }),
  ],
  user_ai_consents: [
    {
      user_id: USER_SHARED,
      sheet_version: 1,
      accepted: true,
      answered_at: UPDATED,
    },
    {
      user_id: USER_SHARED,
      sheet_version: 2,
      accepted: false,
      answered_at: UPDATED,
    },
    {
      user_id: USER_A,
      sheet_version: 2,
      accepted: true,
      answered_at: UPDATED,
    },
  ],
});

describe('SupabaseAiConsentRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseAiConsentRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: seed(),
      untenantedTables: ['user_ai_consents'],
    });
    repo = new SupabaseAiConsentRepository(harness.client);
  });

  describe('chapter switches', () => {
    it('findChapterSettings reads only the chapter’s row', async () => {
      const found = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.findChapterSettings(CHAPTER_A),
      );
      expect(found).toEqual(expect.objectContaining({ chapter_id: CHAPTER_A }));
    });

    it('saveChapterSettings writes only the chapter’s row', async () => {
      const saved = await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.saveChapterSettings(
          CHAPTER_A,
          { chat_source_enabled: true },
          USER_A,
          NOW,
        ),
      );
      expect(saved).toEqual(
        expect.objectContaining({
          chapter_id: CHAPTER_A,
          chat_source_enabled: true,
          updated_by: USER_A,
        }),
      );
      const rows = harness.rows('chapter_ai_settings');
      expect(rows.find((row) => row.chapter_id === CHAPTER_B)).toEqual(
        expect.objectContaining({
          chat_source_enabled: false,
          updated_by: USER_SHARED,
        }),
      );
    });

    it('a patch cannot move the write to another chapter', async () => {
      await harness.expectTenantScoped(CHAPTER_A, () =>
        repo.saveChapterSettings(
          CHAPTER_A,
          { chapter_id: CHAPTER_B } as never,
          USER_A,
          NOW,
        ),
      );
      expect(
        harness
          .rows('chapter_ai_settings')
          .find((row) => row.chapter_id === CHAPTER_B),
      ).toEqual(expect.objectContaining({ updated_by: USER_SHARED }));
    });
  });

  describe('member answers', () => {
    it('findConsent reads the person’s answer on that version only', async () => {
      await expect(repo.findConsent(USER_SHARED, 1)).resolves.toEqual(
        expect.objectContaining({ accepted: true }),
      );
      await expect(repo.findConsent(USER_SHARED, 2)).resolves.toEqual(
        expect.objectContaining({ accepted: false }),
      );
      await expect(repo.findConsent(USER_B, 2)).resolves.toBeNull();
    });

    it('findLatestConsent reads the person’s newest version', async () => {
      await expect(repo.findLatestConsent(USER_SHARED)).resolves.toEqual(
        expect.objectContaining({ sheet_version: 2, accepted: false }),
      );
    });

    it('findAcceptedUserIds keeps only Yes on that version', async () => {
      await expect(
        repo.findAcceptedUserIds([USER_SHARED, USER_A, USER_B], 2),
      ).resolves.toEqual([USER_A]);
      await expect(repo.findAcceptedUserIds([], 2)).resolves.toEqual([]);
    });
  });
});
