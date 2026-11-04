// One chapter_documents row per stored object (#3399), against a real PostgREST.
//
// The unit suites prove that `create` re-selects on a `23505` and that
// `confirmUpload` hands the filed row back only to its uploader. What only a
// live database answers is that the `23505` happens: that
// `chapter_documents_storage_path_key` refuses a second row for a path, so a
// confirm retried after a lost response ends with one row, not two sharing an
// object that deleting either would remove. So this drives the real
// `ChapterDocumentService.confirmUpload` over the real repository.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568), like the other
// integration suites.

import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { ChapterDocumentService } from '../../src/application/services/chapter-document.service';
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
    const path = `chapters/${chapterId}/documents/${randomUUID()}/minutes.jpg`;

    const assertOk = (label: string, error: { message: string } | null) => {
      if (error) throw new Error(`seed ${label}: ${error.message}`);
    };

    const rowsForPath = async () => {
      const { data, error } = await supabase
        .from('chapter_documents')
        .select('id, title')
        .eq('storage_path', path);
      if (error) throw error;
      return data ?? [];
    };

    const confirm = (uploadedBy: string, title: string) =>
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
      // With no folder, `confirmUpload` reads neither the folder repository nor
      // storage.
      const unused = {} as never;
      documents = new ChapterDocumentService(
        new SupabaseChapterDocumentRepository(supabase),
        unused,
        unused,
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
      const first = await confirm(uploaderId, 'Minutes');
      // The member edited the title before retrying; the filed row stands.
      const retry = await confirm(uploaderId, 'Minutes — Nov 2');

      expect(retry.id).toBe(first.id);
      expect(retry.title).toBe('Minutes');
      expect(await rowsForPath()).toEqual([{ id: first.id, title: 'Minutes' }]);
    });

    it('refuses the filed path to another member and files nothing', async () => {
      await expect(confirm(otherMemberId, 'Not mine')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(await rowsForPath()).toHaveLength(1);
    });
  },
);
