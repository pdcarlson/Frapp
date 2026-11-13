// One chapter_documents row per stored object (#3399), against a real PostgREST.
//
// The unit suites prove that `confirmUpload` reads the path before filing and
// hands a filed row back only to its uploader, and that `create` re-selects on
// a `23505`. What only a live database answers is that those reads and that
// `23505` happen: that a confirm retried after a lost response ends with one
// row, not two sharing an object that deleting either would remove, and that
// two confirms racing past the read still file one. So this drives the real
// `ChapterDocumentService.confirmUpload` over the real repository.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568), like the other
// integration suites.

import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { ChapterDocumentService } from '../../src/application/services/chapter-document.service';
import { ChapterDocumentTypeService } from '../../src/application/services/chapter-document-type.service';
import { SupabaseChapterDocumentRepository } from '../../src/infrastructure/supabase/repositories/supabase-chapter-document.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration(
  'One document row per stored object against live PostgREST',
  () => {
    let supabase: FrappSupabaseClient;
    let documents: ChapterDocumentService;

    const chapterId = randomUUID();
    const uploaderId = randomUUID();
    const otherMemberId = randomUUID();
    const newPath = () =>
      `chapters/${chapterId}/documents/${randomUUID()}/minutes.jpg`;
    let repo: SupabaseChapterDocumentRepository;

    const assertOk = (label: string, error: { message: string } | null) => {
      if (error) throw new Error(`seed ${label}: ${error.message}`);
    };

    const rowsForPath = async (path: string) => {
      const { data, error } = await supabase
        .from('chapter_documents')
        .select('id, title')
        .eq('storage_path', path);
      if (error) throw error;
      return data ?? [];
    };

    const confirm = (path: string, uploadedBy: string, title: string) =>
      documents.confirmUpload({
        chapter_id: chapterId,
        title,
        storage_path: path,
        uploaded_by: uploadedBy,
        content_type: 'image/jpeg',
        byte_size: 4096,
      });

    beforeAll(async () => {
      supabase = createServiceRoleClient();
      // With no folder and no type, `confirmUpload` reads neither the folder
      // nor the type repository, nor storage.
      const unused = {} as never;
      repo = new SupabaseChapterDocumentRepository(supabase);
      documents = new ChapterDocumentService(
        repo,
        unused,
        unused,
        unused,
        new ChapterDocumentTypeService(unused),
      );

      assertOk(
        'chapters',
        (
          await supabase.from('chapters').insert({
            id: chapterId,
            name: `doc-confirm-${chapterId.slice(0, 8)}`,
            university: 'Integration Test University',
          } as never)
        ).error,
      );
      assertOk(
        'users',
        (
          await supabase.from('users').insert(
            [uploaderId, otherMemberId].map((id) => ({
              id,
              supabase_auth_id: randomUUID(),
              email: `doc-confirm-${id}@example.test`,
              display_name: 'Document Uploader',
            })) as never,
          )
        ).error,
      );
    });

    afterAll(async () => {
      if (!supabase) return;
      await supabase
        .from('chapter_documents')
        .delete()
        .eq('chapter_id', chapterId);
      await supabase
        .from('users')
        .delete()
        .in('id', [uploaderId, otherMemberId]);
      await supabase.from('chapters').delete().eq('id', chapterId);
    });

    it('files a retried confirm once and hands the uploader the first row', async () => {
      const path = newPath();
      const first = await confirm(path, uploaderId, 'Minutes');
      const retry = await confirm(path, uploaderId, 'Minutes');

      expect(retry.id).toBe(first.id);
      expect(await rowsForPath(path)).toEqual([
        { id: first.id, title: 'Minutes' },
      ]);
    });

    it('refuses a filed path to another member and files nothing', async () => {
      const path = newPath();
      await confirm(path, uploaderId, 'Minutes');

      await expect(
        confirm(path, otherMemberId, 'Not mine'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(await rowsForPath(path)).toHaveLength(1);
    });

    it('answers a second insert of a filed path with the filed row', async () => {
      // What two confirms racing past the service's read meet: the index's
      // 23505, which the repository turns into the winner's row.
      const path = newPath();
      const row = {
        chapter_id: chapterId,
        title: 'Minutes',
        storage_path: path,
        uploaded_by: uploaderId,
      };
      const first = await repo.create(row);
      const second = await repo.create({ ...row, title: 'Lost the race' });

      expect(second.id).toBe(first.id);
      expect(await rowsForPath(path)).toEqual([
        { id: first.id, title: 'Minutes' },
      ]);
    });

    it('files one row for two confirms sent at once', async () => {
      const path = newPath();
      const [a, b] = await Promise.all([
        confirm(path, uploaderId, 'Minutes'),
        confirm(path, uploaderId, 'Minutes'),
      ]);

      expect(a.id).toBe(b.id);
      expect(await rowsForPath(path)).toHaveLength(1);
    });
  },
);
