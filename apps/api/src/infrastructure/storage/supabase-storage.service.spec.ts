import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseStorageService } from './supabase-storage.service';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';

describe('SupabaseStorageService', () => {
  let service: SupabaseStorageService;
  let list: jest.Mock;
  let remove: jest.Mock;
  let download: jest.Mock;
  let upload: jest.Mock;
  let createSignedUrl: jest.Mock;
  let createSignedUploadUrl: jest.Mock;

  beforeEach(async () => {
    list = jest.fn();
    remove = jest.fn().mockResolvedValue({ error: null });
    download = jest.fn().mockResolvedValue({ data: null, error: null });
    upload = jest.fn().mockResolvedValue({ error: null });
    createSignedUrl = jest
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'd' }, error: null });
    createSignedUploadUrl = jest
      .fn()
      .mockResolvedValue({ data: { signedUrl: 'u' }, error: null });
    const mockSupabase = {
      storage: {
        from: jest.fn(() => ({
          list,
          remove,
          download,
          upload,
          createSignedUrl,
          createSignedUploadUrl,
        })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseStorageService,
        { provide: SUPABASE_CLIENT, useValue: mockSupabase },
      ],
    }).compile();

    service = module.get(SupabaseStorageService);
  });

  describe('listFiles', () => {
    const entry = (name: string) => ({ id: `id-${name}`, name });

    it('paginates until the folder is exhausted', async () => {
      const firstPage = Array.from({ length: 1000 }, (_, i) =>
        entry(`a${i}.png`),
      );
      list
        .mockResolvedValueOnce({ data: firstPage, error: null })
        .mockResolvedValueOnce({ data: [entry('last.png')], error: null })
        // Paging stops on an EMPTY page, never a short one — a short page is
        // exactly what a server-side `limit` cap looks like.
        .mockResolvedValueOnce({ data: [], error: null });

      const paths = await service.listFiles(
        'profiles',
        'chapters/c/profiles/u',
      );

      expect(paths).toHaveLength(1001);
      expect(paths[1000]).toBe('chapters/c/profiles/u/last.png');
      expect(list).toHaveBeenCalledTimes(3);
      // Offset advances by rows actually returned, not by the requested page
      // size, so a clamped page cannot skip rows.
      expect(list).toHaveBeenLastCalledWith('chapters/c/profiles/u', {
        limit: 1000,
        offset: 1001,
      });
    });

    it('skips folder placeholder entries (id: null)', async () => {
      list
        .mockResolvedValueOnce({
          data: [entry('real.png'), { id: null, name: 'subfolder' }],
          error: null,
        })
        .mockResolvedValueOnce({ data: [], error: null });

      const paths = await service.listFiles('profiles', 'p');

      expect(paths).toEqual(['p/real.png']);
    });

    it('treats a missing bucket as an empty folder', async () => {
      list.mockResolvedValueOnce({
        data: null,
        error: { message: 'Bucket not found' },
      });

      await expect(service.listFiles('profiles', 'p')).resolves.toEqual([]);
    });

    it('propagates other listing errors', async () => {
      list.mockResolvedValueOnce({
        data: null,
        error: { message: 'internal error' },
      });

      await expect(service.listFiles('profiles', 'p')).rejects.toBeTruthy();
    });
  });

  describe('listObjects', () => {
    it('returns each object with its stored-at timestamp', async () => {
      list
        .mockResolvedValueOnce({
          data: [
            {
              id: 'id-1',
              name: 'roster-2026-08-05-uuid.pdf',
              created_at: '2026-08-05T10:30:00Z',
            },
          ],
          error: null,
        })
        .mockResolvedValueOnce({ data: [], error: null });

      const objects = await service.listObjects(
        'reports',
        'chapters/c/reports',
      );

      expect(objects).toEqual([
        {
          path: 'chapters/c/reports/roster-2026-08-05-uuid.pdf',
          createdAt: new Date('2026-08-05T10:30:00Z'),
        },
      ]);
    });

    it.each([
      ['missing', undefined],
      ['null', null],
      ['unparseable', 'not-a-date'],
    ])(
      'reports a %s timestamp as null, not an Invalid Date',
      async (_label, created_at) => {
        // An Invalid Date compares false against every cutoff, so an age-based
        // caller could not tell "too new to reap" from "no idea when".
        list
          .mockResolvedValueOnce({
            data: [{ id: 'id-1', name: 'x.pdf', created_at }],
            error: null,
          })
          .mockResolvedValueOnce({ data: [], error: null });

        const objects = await service.listObjects('reports', 'p');

        expect(objects).toEqual([{ path: 'p/x.pdf', createdAt: null }]);
      },
    );

    it('treats a missing bucket as an empty folder', async () => {
      list.mockResolvedValueOnce({
        data: null,
        error: { message: 'Bucket not found' },
      });

      await expect(service.listObjects('reports', 'p')).resolves.toEqual([]);
    });
  });

  describe('deleteFiles', () => {
    it('removes paths in chunks of at most 100 per call', async () => {
      const paths = Array.from({ length: 150 }, (_, i) => `p/${i}.png`);

      await service.deleteFiles('profiles', paths);

      expect(remove).toHaveBeenCalledTimes(2);
      expect(remove.mock.calls[0][0]).toHaveLength(100);
      expect(remove.mock.calls[1][0]).toHaveLength(50);
    });

    it('propagates a removal error', async () => {
      remove.mockResolvedValueOnce({ error: { message: 'denied' } });

      await expect(
        service.deleteFiles('profiles', ['p/x.png']),
      ).rejects.toBeTruthy();
    });
  });

  /**
   * Path containment is a security property, not a tidiness one.
   *
   * storage-js interpolates the object path into the request URL unencoded and
   * Node's URL parser then collapses `..`, so a traversal path escapes the
   * bucket entirely and is served under the API's service-role key, which
   * bypasses RLS. Reproduced against a live stack before this guard existed:
   * a crafted `chapters/<mine>/branding/../../../../reports/...` read another
   * chapter's report PDF.
   */
  describe('path containment', () => {
    const TRAVERSALS = [
      'chapters/a/branding/../../../reports/chapters/b/secret.pdf',
      '../outside.png',
      'chapters/a/./logo.png',
      'chapters//a/logo.png',
      '',
      // Percent-encoded dot segments. The URL parser treats %2e as "." during
      // dot-segment removal, so these escaped a raw-segment-only check —
      // verified reading another bucket's object against a live stack.
      'chapters/a/branding/%2e%2e/%2e%2e/reports/chapters/b/secret.pdf',
      'chapters/a/branding/%2E%2E/%2E%2E/reports/chapters/b/secret.pdf',
      'chapters/a/branding/.%2e/.%2e/reports/chapters/b/secret.pdf',
      // Backslash is a segment separator for special-scheme URLs.
      'chapters/a/branding/..\\..\\secret.pdf',
      // Tab/LF/CR are DELETED by the WHATWG URL parser before dot-segment
      // removal, so ".\t." arrives as "..". Seven spellings of this leaked a
      // different bucket's object against a live stack before the guard
      // rejected control characters.
      '.\t./reports/chapters/b/secret.pdf',
      '.\n./reports/chapters/b/secret.pdf',
      '.\r./reports/chapters/b/secret.pdf',
      '.\r\n./reports/chapters/b/secret.pdf',
      '..\t/reports/chapters/b/secret.pdf',
      '\t../reports/chapters/b/secret.pdf',
      '..\n/reports/chapters/b/secret.pdf',
      // Percent-encoded tab decodes to the same thing.
      '.%09./reports/chapters/b/secret.pdf',
      // A malformed percent anywhere in the string used to make
      // decodeURIComponent throw, silently disabling the decoded-form check
      // that was the only detector of %2e%2e. The dot test no longer depends
      // on decoding succeeding.
      'p%/%2e%2e/reports/chapters/b/secret.pdf',
      'p%ff/%2e%2e/reports/chapters/b/secret.pdf',
      'p%/.%2e/reports/chapters/b/secret.pdf',
      'p%/../reports/chapters/b/secret.pdf',
      '%2e./reports/chapters/b/secret.pdf',
      // Percent-encoded separators. Inert on today's stack (undici leaves them
      // literal and storage rejects the key), but the raw check must not depend
      // on that — the decoded form was the only other detector, and a malformed
      // % disables it.
      '..%2f..%2freports/chapters/b/secret.pdf',
      '..%2F..%2Freports/chapters/b/secret.pdf',
      '..%5c..%5creports/chapters/b/secret.pdf',
      '..%2f..%2fsecret%2ekey%ff',
      '..%2f..%2fsecret%2ekey%',
    ];

    it.each(TRAVERSALS)('downloadFile rejects %p', async (path) => {
      await expect(
        service.downloadFile('branding', path),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(download).not.toHaveBeenCalled();
    });

    it.each(TRAVERSALS)('uploadFile rejects %p', async (path) => {
      await expect(
        service.uploadFile(
          'reports',
          path,
          new Uint8Array([1]),
          'application/pdf',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(upload).not.toHaveBeenCalled();
    });

    it.each(TRAVERSALS)('getSignedDownloadUrl rejects %p', async (path) => {
      await expect(
        service.getSignedDownloadUrl('reports', path),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createSignedUrl).not.toHaveBeenCalled();
    });

    it.each(TRAVERSALS)('getSignedUploadUrl rejects %p', async (path) => {
      await expect(
        service.getSignedUploadUrl('branding', path, 'image/png'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createSignedUploadUrl).not.toHaveBeenCalled();
    });

    it.each(TRAVERSALS)('deleteFile rejects %p', async (path) => {
      await expect(service.deleteFile('reports', path)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(remove).not.toHaveBeenCalled();
    });

    it('rejects a traversal hidden among valid batch deletes', async () => {
      await expect(
        service.deleteFiles('reports', ['chapters/a/ok.pdf', '../../etc/x']),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(remove).not.toHaveBeenCalled();
    });

    it('allows a filename containing a bare % (malformed encoding is not a traversal)', async () => {
      // Server-built keys embed path.basename(userFilename), so "Q1 50% growth"
      // is a legitimate object name. decodeURIComponent throws on it; the raw
      // check must still pass it through.
      await expect(
        service.uploadFile(
          'documents',
          'chapters/a/documents/doc-1/Q1 50% growth.pdf',
          new Uint8Array([1]),
          'application/pdf',
        ),
      ).resolves.toBeUndefined();
      expect(upload).toHaveBeenCalled();
    });

    it.each([
      'chapters/a/documents/doc-1/notes (final) v2.pdf',
      'chapters/a/documents/doc-1/...notes.pdf',
      'chapters/a/documents/doc-1/résumé — José.pdf',
      'chapters/a/chat/ch-1/msg-1/photo+1&2.jpg',
      'chapters/a/backwork/res-1/中文文件.pdf',
      'chapters/a/documents/doc-1/report..final.pdf',
      'chapters/a/documents/doc-1/100%done.pdf',
      // Normalizing %2f splits this into two harmless segments, not a traversal.
      'chapters/a/documents/doc-1/weird%2fname.png',
    ])('accepts the realistic uploaded filename %p', async (path) => {
      // Keys embed path.basename(userFilename); a guard that rejects these
      // breaks real uploads, which is as much a defect as letting a traversal by.
      await expect(
        service.uploadFile(
          'documents',
          path,
          new Uint8Array([1]),
          'image/jpeg',
        ),
      ).resolves.toBeUndefined();
    });

    it('allows a filename whose decoded form merely contains dots', async () => {
      // "b%2e%2e" decodes to "b.." — not a dot *segment*, so it is legal.
      await expect(
        service.uploadFile(
          'documents',
          'chapters/a/documents/doc-1/b%2e%2e.pdf',
          new Uint8Array([1]),
          'application/pdf',
        ),
      ).resolves.toBeUndefined();
      expect(upload).toHaveBeenCalled();
    });

    it('allows ordinary chapter-scoped paths', async () => {
      await expect(
        service.uploadFile(
          'reports',
          'chapters/11111111-1111-1111-1111-111111111111/reports/roster-2026-08-05-uuid.pdf',
          new Uint8Array([1]),
          'application/pdf',
        ),
      ).resolves.toBeUndefined();
      expect(upload).toHaveBeenCalled();
    });

    it('allows the empty list prefix (bucket root) but not a traversing one', async () => {
      list.mockResolvedValueOnce({ data: [], error: null });
      await expect(service.listFiles('reports', '')).resolves.toEqual([]);
      await expect(
        service.listFiles('reports', '../other'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('downloadFile error handling', () => {
    it('returns null when the object is missing', async () => {
      download.mockResolvedValueOnce({
        data: null,
        error: { message: 'Object not found' },
      });

      await expect(
        service.downloadFile('branding', 'a/b.png'),
      ).resolves.toBeNull();
    });

    it('throws when the bucket itself is missing', async () => {
      // An unprovisioned bucket is a misconfiguration. Swallowing it here would
      // make every chapter's PDF render logo-less with nothing in the logs.
      download.mockResolvedValueOnce({
        data: null,
        error: { message: 'Bucket not found' },
      });

      await expect(
        service.downloadFile('branding', 'a/b.png'),
      ).rejects.toBeTruthy();
    });
  });
});
