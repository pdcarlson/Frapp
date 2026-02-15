import { Test, TestingModule } from '@nestjs/testing';
import { BackworkService } from './backwork.service';
import { BACKWORK_REPOSITORY } from '../../domain/repositories/backwork.repository.interface';
import { S3Service } from '../../infrastructure/storage/s3.service';
import { ConflictException } from '@nestjs/common';

describe('BackworkService', () => {
  let service: BackworkService;

  const mockBackworkRepo = {
    findCourseByCode: jest.fn(),
    createCourse: jest.fn(),
    findProfessorByName: jest.fn(),
    createProfessor: jest.fn(),
    createResource: jest.fn(),
    findResourceByHash: jest.fn(),
  };

  const mockS3Service = {
    getUploadPresignedUrl: jest.fn(),
    getDownloadPresignedUrl: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackworkService,
        { provide: BACKWORK_REPOSITORY, useValue: mockBackworkRepo },
        { provide: S3Service, useValue: mockS3Service },
      ],
    }).compile();

    service = module.get<BackworkService>(BackworkService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getUploadUrl', () => {
    it('should return a presigned URL and S3 key', async () => {
      mockS3Service.getUploadPresignedUrl.mockResolvedValue('https://s3.url');
      const result = await service.getUploadUrl(
        'chapter-1',
        'test.pdf',
        'application/pdf',
      );

      expect(result.uploadUrl).toBe('https://s3.url');
      expect(result.s3Key).toContain('chapters/chapter-1/backwork/');
    });
  });

  describe('createResource', () => {
    const dto = {
      chapterId: 'c1',
      uploaderId: 'u1',
      courseCode: 'CS101',
      courseName: 'Intro to CS',
      professorName: 'Smith',
      term: 'Fall 2024',
      title: 'Final Exam',
      s3Key: 'key',
      fileHash: 'hash',
      tags: ['exam'],
    };

    it('should throw ConflictException if resource already exists', async () => {
      mockBackworkRepo.findCourseByCode.mockResolvedValue({ id: 'course-1' });
      mockBackworkRepo.findResourceByHash.mockResolvedValue({ id: 'res-1' });

      await expect(service.createResource(dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should auto-vivify course and professor and create resource', async () => {
      mockBackworkRepo.findCourseByCode.mockResolvedValue(null);
      mockBackworkRepo.createCourse.mockResolvedValue({ id: 'course-new' });
      mockBackworkRepo.findProfessorByName.mockResolvedValue(null);
      mockBackworkRepo.createProfessor.mockResolvedValue({ id: 'prof-new' });
      mockBackworkRepo.findResourceByHash.mockResolvedValue(null);
      mockBackworkRepo.createResource.mockResolvedValue({ id: 'res-new' });

      const result = await service.createResource(dto);

      expect(mockBackworkRepo.createCourse).toHaveBeenCalledWith({
        chapterId: 'c1',
        code: 'CS101',
        name: 'Intro to CS',
      });
      expect(mockBackworkRepo.createProfessor).toHaveBeenCalledWith({
        chapterId: 'c1',
        name: 'Smith',
      });
      expect(result.id).toBe('res-new');
    });
  });
});
