import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { S3Service } from './s3.service';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

jest.mock('@aws-sdk/client-s3');
jest.mock('@aws-sdk/s3-request-presigner');

describe('S3Service', () => {
  let service: S3Service;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        S3Service,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'AWS_REGION') return 'us-east-1';
              if (key === 'AWS_ACCESS_KEY_ID') return 'test-key';
              if (key === 'AWS_SECRET_ACCESS_KEY') return 'test-secret';
              if (key === 'AWS_S3_BUCKET_NAME') return 'test-bucket';
              return null;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<S3Service>(S3Service);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUploadPresignedUrl', () => {
    it('should return a signed URL', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue(
        'https://presigned-url.com',
      );
      const url = await service.getUploadPresignedUrl(
        'test-key',
        'application/pdf',
      );
      expect(url).toBe('https://presigned-url.com');
      expect(getSignedUrl).toHaveBeenCalled();
    });
  });

  describe('getDownloadPresignedUrl', () => {
    it('should return a signed URL', async () => {
      (getSignedUrl as jest.Mock).mockResolvedValue(
        'https://presigned-url.com',
      );
      const url = await service.getDownloadPresignedUrl('test-key');
      expect(url).toBe('https://presigned-url.com');
      expect(getSignedUrl).toHaveBeenCalled();
    });
  });
});
