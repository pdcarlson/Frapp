import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseStorageService } from './supabase-storage.service';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';

describe('SupabaseStorageService', () => {
  let service: SupabaseStorageService;
  let list: jest.Mock;
  let remove: jest.Mock;

  beforeEach(async () => {
    list = jest.fn();
    remove = jest.fn().mockResolvedValue({ error: null });
    const mockSupabase = {
      storage: { from: jest.fn(() => ({ list, remove })) },
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
});
