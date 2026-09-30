// Chapter logo replacement (#2592) against a real storage-api.
//
// `chapter.service.spec.ts` proves what the service asks storage for. It can't
// prove how storage answers, and the defect this fixes was entirely in that
// answer: re-signing an existing key without `upsert` gets a 409 from
// storage-api, which is why replacing a PNG with another PNG failed when the
// key was `logo.<ext>`. This drives the real `SupabaseStorageService` through
// the service's mint → PUT → confirm, twice with the same extension, and checks
// what is left in the bucket.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today; #1568 tracks wiring the
// suite in.
//
// The chapter row is an in-memory stand-in: the column write is ordinary
// PostgREST that other suites cover, and a real row would need a whole
// chapter's worth of foreign keys for nothing this suite asserts.

import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { ChapterService } from '../../src/application/services/chapter.service';
import type { ChapterAuditLogService } from '../../src/application/services/chapter-audit-log.service';
import { SupabaseStorageService } from '../../src/infrastructure/storage/supabase-storage.service';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import type { Chapter } from '../../src/domain/entities/chapter.entity';
import type { IChapterRepository } from '../../src/domain/repositories/chapter.repository.interface';
import { createServiceRoleClient, describeIntegration } from './stack';

const BUCKET = 'branding';
/** The smallest valid PNG: the bucket checks the declared type, not the bytes. */
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  ),
);

describeIntegration('Chapter logo replacement against live storage', () => {
  let supabase: FrappSupabaseClient;
  let storage: SupabaseStorageService;
  let service: ChapterService;
  let row: Pick<Chapter, 'id' | 'logo_path'>;
  const chapterId = randomUUID();
  const folder = `chapters/${chapterId}/branding`;

  async function listed(): Promise<string[]> {
    return (await storage.listFiles(BUCKET, folder)).sort();
  }

  async function putTo(signedUrl: string): Promise<void> {
    const response = await fetch(signedUrl, {
      method: 'PUT',
      body: PNG,
      headers: { 'content-type': 'image/png' },
    });
    if (!response.ok) {
      throw new Error(
        `PUT failed (${response.status}): ${await response.text()}`,
      );
    }
  }

  async function upload(): Promise<string> {
    const { signedUrl, storagePath } = await service.requestLogoUploadUrl(
      chapterId,
      'crest.png',
      'image/png',
    );
    await putTo(signedUrl);
    return storagePath;
  }

  beforeAll(() => {
    supabase = createServiceRoleClient();
    storage = new SupabaseStorageService(supabase);
    row = { id: chapterId, logo_path: null };
    const chapterRepo = {
      findById: jest.fn(async () => ({ ...row }) as Chapter),
      update: jest.fn(async (_id: string, patch: Partial<Chapter>) => {
        row = { ...row, ...patch };
        return { ...row } as Chapter;
      }),
    } as unknown as IChapterRepository;
    const auditLog = {
      record: jest.fn(async () => undefined),
    } as unknown as ChapterAuditLogService;
    const unused = {} as never;
    service = new ChapterService(
      chapterRepo,
      unused,
      unused,
      storage,
      supabase,
      unused,
      auditLog,
    );
  });

  afterAll(async () => {
    const left = await storage.listFiles(BUCKET, folder);
    if (left.length > 0) await storage.deleteFiles(BUCKET, left);
  });

  it('shows the premise: re-signing an existing key without upsert is refused', async () => {
    const first = await upload();
    await service.confirmLogoUpload(chapterId, first, 'user-1');

    // What the old fixed `logo.<ext>` key did on every same-extension
    // replacement.
    await expect(
      storage.getSignedUploadUrl(BUCKET, first, 'image/png'),
    ).rejects.toThrow();
  });

  it('replaces a PNG with another PNG and leaves only the new object', async () => {
    const before = row.logo_path!;
    const next = await upload();
    expect(next).not.toBe(before);
    expect(await listed()).toEqual([before, next].sort());

    await service.confirmLogoUpload(chapterId, next, 'user-1');

    expect(row.logo_path).toBe(next);
    expect(await listed()).toEqual([next]);
  });

  it('leaves a fresh unconfirmed upload for its own confirm', async () => {
    // Another officer's upload, PUT but not yet confirmed. Deleting it would
    // fail their confirm with a 400 and, raced, leave the chapter with no logo.
    const theirs = await upload();
    const mine = await upload();

    await service.confirmLogoUpload(chapterId, mine, 'user-1');
    expect(await listed()).toEqual([mine, theirs].sort());

    // Their confirm still works, and removes the logo it replaced.
    await service.confirmLogoUpload(chapterId, theirs, 'user-2');
    expect(row.logo_path).toBe(theirs);
    expect(await listed()).toEqual([theirs]);
  });

  it('leaves the chapter on an existing object when two confirms race', async () => {
    const a = await upload();
    const b = await upload();

    await Promise.all([
      service.confirmLogoUpload(chapterId, a, 'user-1'),
      service.confirmLogoUpload(chapterId, b, 'user-2'),
    ]);

    // Whichever landed last is the logo, and its object is still there.
    expect([a, b]).toContain(row.logo_path);
    expect(await listed()).toContain(row.logo_path);
  });

  it('refuses a confirm for a minted key nothing was uploaded to', async () => {
    const current = row.logo_path!;
    const before = await listed();
    const { storagePath } = await service.requestLogoUploadUrl(
      chapterId,
      'crest.png',
      'image/png',
    );

    await expect(
      service.confirmLogoUpload(chapterId, storagePath, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(row.logo_path).toBe(current);
    expect(await listed()).toEqual(before);
  });
});
