// Backwork drafts against the real database (#5208).
//
// A draft is a `backwork_resources` row whose `draft_fields` is not null, and
// it must be visible only to its uploader. The unit suite proves the service
// calls the right repository methods; only real PostgREST can say the
// filters those methods send (`is null`, `not is null`, the uploader match)
// do what they claim. If one went missing, a half-filled exam would show in
// the chapter's library and every unit test would stay green.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568); the PGlite tier
// `scripts/pglite/tiers/backwork-search.mjs` is the CI-run proof that search
// leaves drafts out.

import { randomUUID } from 'node:crypto';
import { SupabaseBackworkResourceRepository } from '../../src/infrastructure/supabase/repositories/supabase-backwork-resource.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration(
  'Backwork drafts are visible only to their uploader',
  () => {
    let supabase: FrappSupabaseClient;
    let repo: SupabaseBackworkResourceRepository;

    const chapterId = randomUUID();
    const uploader = randomUUID();
    const otherMember = randomUUID();
    const publishedId = randomUUID();
    const draftId = randomUUID();
    const othersDraftId = randomUUID();

    const assertOk = (label: string, error: { message: string } | null) => {
      if (error) throw new Error(`seed ${label}: ${error.message}`);
    };

    beforeAll(async () => {
      supabase = createServiceRoleClient();
      repo = new SupabaseBackworkResourceRepository(supabase);

      assertOk(
        'chapters',
        (
          await supabase.from('chapters').insert({
            id: chapterId,
            name: `backwork-drafts-${chapterId.slice(0, 8)}`,
            university: 'Integration Test University',
          } as never)
        ).error,
      );
      assertOk(
        'users',
        (
          await supabase.from('users').insert(
            [uploader, otherMember].map((id) => ({
              id,
              supabase_auth_id: randomUUID(),
              email: `drafts-${id}@example.test`,
              display_name: 'Drafts',
            })) as never,
          )
        ).error,
      );
      const row = (id: string, uploaderId: string, draft: object | null) => ({
        id,
        chapter_id: chapterId,
        uploader_id: uploaderId,
        storage_path: `chapters/${chapterId}/backwork/${id}/file.pdf`,
        file_hash: `hash-${id}`,
        is_redacted: true,
        title: draft ? null : 'Published midterm',
        draft_fields: draft,
      });
      assertOk(
        'backwork_resources',
        (
          await supabase
            .from('backwork_resources')
            .insert([
              row(publishedId, uploader, null),
              row(draftId, uploader, { title: 'My draft' }),
              row(othersDraftId, otherMember, { title: 'Their draft' }),
            ] as never)
        ).error,
      );
    });

    afterAll(async () => {
      await supabase.from('chapters').delete().eq('id', chapterId);
      await supabase.from('users').delete().in('id', [uploader, otherMember]);
    });

    it('leaves drafts out of the library, the single read and the zip links', async () => {
      const list = await repo.findByChapter(chapterId);
      expect(list.map((r) => r.id)).toEqual([publishedId]);

      await expect(repo.findById(draftId, chapterId)).resolves.toBeNull();
      await expect(
        repo.findById(publishedId, chapterId),
      ).resolves.toMatchObject({
        id: publishedId,
      });

      const zipped = await repo.findByIds(
        [publishedId, draftId, othersDraftId],
        chapterId,
      );
      expect(zipped.map((r) => r.id)).toEqual([publishedId]);
    });

    it('still finds a draft by its file hash, so a re-upload is a duplicate', async () => {
      await expect(
        repo.findByFileHash(chapterId, `hash-${othersDraftId}`),
      ).resolves.toMatchObject({ id: othersDraftId });
    });

    it("lists and reads only the uploader's own drafts", async () => {
      const mine = await repo.findDrafts(chapterId, uploader);
      expect(mine.map((r) => r.id)).toEqual([draftId]);

      const asked = await repo.findDraftsByIds(
        [draftId, othersDraftId, publishedId],
        chapterId,
        uploader,
      );
      expect(asked.map((r) => r.id)).toEqual([draftId]);
    });

    it("never edits, publishes or deletes someone else's draft", async () => {
      await expect(
        repo.updateDraftFields(othersDraftId, chapterId, uploader, {
          title: 'Hijacked',
        }),
      ).resolves.toBeNull();
      await expect(
        repo.publishDraft(othersDraftId, chapterId, uploader, {
          title: 'Hijacked',
          department_id: null,
          course_number: null,
          professor_id: null,
          year: null,
          semester: null,
          assignment_type: null,
          assignment_number: null,
          document_variant: null,
          tags: [],
        }),
      ).resolves.toBeNull();
      await expect(
        repo.deleteDraft(othersDraftId, chapterId, uploader),
      ).resolves.toBe(false);

      const theirs = await repo.findDrafts(chapterId, otherMember);
      expect(theirs).toHaveLength(1);
      expect(theirs[0].draft_fields).toEqual({ title: 'Their draft' });
    });

    it('edits a draft, then publishes it once into the library', async () => {
      const edited = await repo.updateDraftFields(
        draftId,
        chapterId,
        uploader,
        {
          title: 'Final draft title',
          semester: 'Fall',
        },
      );
      expect(edited?.draft_fields).toEqual({
        title: 'Final draft title',
        semester: 'Fall',
      });

      const columns = {
        title: 'Final draft title',
        department_id: null,
        course_number: null,
        professor_id: null,
        year: 2025,
        semester: 'Fall' as const,
        assignment_type: null,
        assignment_number: null,
        document_variant: null,
        tags: [],
      };
      const published = await repo.publishDraft(
        draftId,
        chapterId,
        uploader,
        columns,
      );
      expect(published).toMatchObject({ ...columns, draft_fields: null });

      // A second publish (another tab) finds no draft and changes nothing.
      await expect(
        repo.publishDraft(draftId, chapterId, uploader, columns),
      ).resolves.toBeNull();

      const list = await repo.findByChapter(chapterId);
      expect(list.map((r) => r.id).sort()).toEqual(
        [publishedId, draftId].sort(),
      );
      await expect(repo.findDrafts(chapterId, uploader)).resolves.toEqual([]);
    });

    it("deletes the uploader's own draft", async () => {
      await expect(
        repo.deleteDraft(othersDraftId, chapterId, otherMember),
      ).resolves.toBe(true);
      await expect(repo.findDrafts(chapterId, otherMember)).resolves.toEqual(
        [],
      );
    });
  },
);
