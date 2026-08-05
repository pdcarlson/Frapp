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
        .mockResolvedValueOnce({ data: [entry('last.png')], error: null });

      const paths = await service.listFiles(
        'profiles',
        'chapters/c/profiles/u',
      );

      expect(paths).toHaveLength(1001);
      expect(paths[1000]).toBe('chapters/c/profiles/u/last.png');
      expect(list).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenLastCalledWith('chapters/c/profiles/u', {
        limit: 1000,
        offset: 1000,
      });
    });

    it('skips folder placeholder entries (id: null)', async () => {
      list.mockResolvedValueOnce({
        data: [entry('real.png'), { id: null, name: 'subfolder' }],
        error: null,
      });

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
