import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseStorageService } from './supabase-storage.service';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';

describe('SupabaseStorageService', () => {
  let service: SupabaseStorageService;

  const mockCreateSignedUploadUrl = jest.fn();
  const mockCreateSignedUrl = jest.fn();
  const mockRemove = jest.fn();

  const mockFrom = jest.fn().mockReturnValue({
    createSignedUploadUrl: mockCreateSignedUploadUrl,
    createSignedUrl: mockCreateSignedUrl,
    remove: mockRemove,
  });

  const mockSupabaseClient = {
    storage: {
      from: mockFrom,
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupabaseStorageService,
        {
          provide: SUPABASE_CLIENT,
          useValue: mockSupabaseClient,
        },
      ],
    }).compile();

    service = module.get<SupabaseStorageService>(SupabaseStorageService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSignedUploadUrl', () => {
    it('should return a signed upload URL', async () => {
      const bucket = 'test-bucket';
      const path = 'test-path/file.txt';
      const contentType = 'text/plain';
      const signedUrl = 'https://example.com/signed-upload-url';

      mockCreateSignedUploadUrl.mockResolvedValue({
        data: { signedUrl },
        error: null,
      });

      const result = await service.getSignedUploadUrl(
        bucket,
        path,
        contentType,
      );

      expect(mockFrom).toHaveBeenCalledWith(bucket);
      expect(mockCreateSignedUploadUrl).toHaveBeenCalledWith(path);
      expect(result).toBe(signedUrl);
    });

    it('should throw an error if createSignedUploadUrl fails', async () => {
      const bucket = 'test-bucket';
      const path = 'test-path/file.txt';
      const contentType = 'text/plain';
      const error = new Error('Failed to create signed upload URL');

      mockCreateSignedUploadUrl.mockResolvedValue({
        data: null,
        error,
      });

      await expect(
        service.getSignedUploadUrl(bucket, path, contentType),
      ).rejects.toThrow(error);
      expect(mockFrom).toHaveBeenCalledWith(bucket);
      expect(mockCreateSignedUploadUrl).toHaveBeenCalledWith(path);
    });
  });

  describe('getSignedDownloadUrl', () => {
    it('should return a signed download URL with default expiresIn', async () => {
      const bucket = 'test-bucket';
      const path = 'test-path/file.txt';
      const signedUrl = 'https://example.com/signed-download-url';

      mockCreateSignedUrl.mockResolvedValue({
        data: { signedUrl },
        error: null,
      });

      const result = await service.getSignedDownloadUrl(bucket, path);

      expect(mockFrom).toHaveBeenCalledWith(bucket);
      expect(mockCreateSignedUrl).toHaveBeenCalledWith(path, 3600);
      expect(result).toBe(signedUrl);
    });

    it('should return a signed download URL with custom expiresIn', async () => {
      const bucket = 'test-bucket';
      const path = 'test-path/file.txt';
      const expiresIn = 7200;
      const signedUrl = 'https://example.com/signed-download-url';

      mockCreateSignedUrl.mockResolvedValue({
        data: { signedUrl },
        error: null,
      });

      const result = await service.getSignedDownloadUrl(
        bucket,
        path,
        expiresIn,
      );

      expect(mockFrom).toHaveBeenCalledWith(bucket);
      expect(mockCreateSignedUrl).toHaveBeenCalledWith(path, expiresIn);
      expect(result).toBe(signedUrl);
    });

    it('should throw an error if createSignedUrl fails', async () => {
      const bucket = 'test-bucket';
      const path = 'test-path/file.txt';
      const error = new Error('Failed to create signed download URL');

      mockCreateSignedUrl.mockResolvedValue({
        data: null,
        error,
      });

      await expect(service.getSignedDownloadUrl(bucket, path)).rejects.toThrow(
        error,
      );
      expect(mockFrom).toHaveBeenCalledWith(bucket);
      expect(mockCreateSignedUrl).toHaveBeenCalledWith(path, 3600);
    });
  });

  describe('deleteFile', () => {
    it('should delete a file successfully', async () => {
      const bucket = 'test-bucket';
      const path = 'test-path/file.txt';

      mockRemove.mockResolvedValue({
        data: [{ name: path }],
        error: null,
      });

      await expect(service.deleteFile(bucket, path)).resolves.toBeUndefined();
      expect(mockFrom).toHaveBeenCalledWith(bucket);
      expect(mockRemove).toHaveBeenCalledWith([path]);
    });

    it('should throw an error if remove fails', async () => {
      const bucket = 'test-bucket';
      const path = 'test-path/file.txt';
      const error = new Error('Failed to delete file');

      mockRemove.mockResolvedValue({
        data: null,
        error,
      });

      await expect(service.deleteFile(bucket, path)).rejects.toThrow(error);
      expect(mockFrom).toHaveBeenCalledWith(bucket);
      expect(mockRemove).toHaveBeenCalledWith([path]);
    });
  });
});
