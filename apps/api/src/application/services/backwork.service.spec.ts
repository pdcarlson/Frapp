import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { MAX_UPLOAD_BYTES } from '@repo/validation';
import { BackworkService } from './backwork.service';
import {
  BACKWORK_RESOURCE_REPOSITORY,
  BACKWORK_DEPARTMENT_REPOSITORY,
  BACKWORK_PROFESSOR_REPOSITORY,
} from '#domain/repositories/backwork.repository.interface';
import type {
  IBackworkResourceRepository,
  IBackworkDepartmentRepository,
  IBackworkProfessorRepository,
} from '#domain/repositories/backwork.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import type { IStorageProvider } from '#domain/adapters/storage.interface';
import type {
  BackworkResource,
  BackworkDepartment,
  BackworkProfessor,
} from '#domain/entities/backwork.entity';

describe('BackworkService', () => {
  let service: BackworkService;
  let mockResourceRepo: jest.Mocked<IBackworkResourceRepository>;
  let mockDepartmentRepo: jest.Mocked<IBackworkDepartmentRepository>;
  let mockProfessorRepo: jest.Mocked<IBackworkProfessorRepository>;
  let mockStorageProvider: jest.Mocked<IStorageProvider>;

  const baseDepartment: BackworkDepartment = {
    id: 'dept-1',
    chapter_id: 'ch-1',
    code: 'CS',
    name: 'Computer Science',
    created_at: '2026-01-01T00:00:00.000Z',
  };

  const baseProfessor: BackworkProfessor = {
    id: 'prof-1',
    chapter_id: 'ch-1',
    name: 'Dr. Smith',
    created_at: '2026-01-01T00:00:00.000Z',
  };

  const baseResource: BackworkResource = {
    id: 'res-1',
    chapter_id: 'ch-1',
    department_id: 'dept-1',
    course_number: '101',
    professor_id: 'prof-1',
    uploader_id: 'user-1',
    title: 'Midterm 1 Fall 2025',
    year: 2025,
    semester: 'Fall',
    assignment_type: 'Midterm',
    assignment_number: 1,
    document_variant: 'Student Copy',
    storage_path: 'chapters/ch-1/backwork/res-1/midterm1.pdf',
    file_hash: 'abc123hash',
    is_redacted: false,
    tags: ['midterm', 'cs101'],
    created_at: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    mockResourceRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByFileHash: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      countByDepartment: jest.fn(),
      countByProfessor: jest.fn(),
      reassignDepartment: jest.fn(),
      reassignProfessor: jest.fn(),
    };

    mockDepartmentRepo = {
      findByChapter: jest.fn(),
      findByCode: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockProfessorRepo = {
      findByChapter: jest.fn(),
      findByName: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockStorageProvider = {
      getSignedUploadUrl: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
      getSignedDownloadUrls: jest.fn().mockResolvedValue({}),
      uploadFile: jest.fn(),
      downloadFile: jest.fn(),
      deleteFile: jest.fn(),
      listFiles: jest.fn(),
      listObjects: jest.fn().mockResolvedValue([]),
      listFolders: jest.fn().mockResolvedValue([]),
      deleteFiles: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BackworkService,
        {
          provide: BACKWORK_RESOURCE_REPOSITORY,
          useValue: mockResourceRepo,
        },
        {
          provide: BACKWORK_DEPARTMENT_REPOSITORY,
          useValue: mockDepartmentRepo,
        },
        {
          provide: BACKWORK_PROFESSOR_REPOSITORY,
          useValue: mockProfessorRepo,
        },
        { provide: STORAGE_PROVIDER, useValue: mockStorageProvider },
      ],
    }).compile();

    service = module.get(BackworkService);
  });

  describe('requestUploadUrl', () => {
    it('should return a signed upload URL and storage path', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://storage.supabase.co/upload/signed',
      );

      const result = await service.requestUploadUrl({
        chapterId: 'ch-1',
        filename: 'midterm1.pdf',
        contentType: 'application/pdf',
      });

      expect(result.signedUrl).toBe(
        'https://storage.supabase.co/upload/signed',
      );
      expect(result.storagePath).toContain('chapters/ch-1/backwork/');
      expect(result.storagePath).toContain('midterm1.pdf');
      expect(result.resourceId).toBeDefined();
    });
    it('should throw BadRequestException for disallowed extensions', async () => {
      await expect(
        service.requestUploadUrl({
          chapterId: 'ch-1',
          filename: 'malicious.exe',
          contentType: 'application/pdf', // Even with a valid content type
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for disallowed content types', async () => {
      await expect(
        service.requestUploadUrl({
          chapterId: 'ch-1',
          filename: 'valid.pdf',
          contentType: 'application/x-msdownload',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts image/gif (same document kind as chapter files and chat)', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://storage.supabase.co/upload/signed',
      );

      const result = await service.requestUploadUrl({
        chapterId: 'ch-1',
        filename: 'notes.gif',
        contentType: 'image/gif',
      });

      expect(result.signedUrl).toBe(
        'https://storage.supabase.co/upload/signed',
      );
      expect(mockStorageProvider.getSignedUploadUrl).toHaveBeenCalledWith(
        'backwork',
        expect.stringContaining('notes.gif'),
        'image/gif',
      );
    });

    it('accepts a declared size at exactly the upload ceiling', async () => {
      mockStorageProvider.getSignedUploadUrl.mockResolvedValue(
        'https://storage.supabase.co/upload/signed',
      );

      const result = await service.requestUploadUrl({
        chapterId: 'ch-1',
        filename: 'midterm1.pdf',
        contentType: 'application/pdf',
        sizeBytes: MAX_UPLOAD_BYTES,
      });

      expect(result.signedUrl).toBeDefined();
    });

    it('throws BadRequestException for a declared size one byte over the upload ceiling', async () => {
      await expect(
        service.requestUploadUrl({
          chapterId: 'ch-1',
          filename: 'midterm1.pdf',
          contentType: 'application/pdf',
          sizeBytes: MAX_UPLOAD_BYTES + 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('confirmUpload', () => {
    it('should create a resource with full metadata', async () => {
      mockResourceRepo.findByFileHash.mockResolvedValue(null);
      mockDepartmentRepo.findByCode.mockResolvedValue(baseDepartment);
      mockProfessorRepo.findByName.mockResolvedValue(baseProfessor);
      mockResourceRepo.create.mockResolvedValue(baseResource);

      const result = await service.confirmUpload({
        chapter_id: 'ch-1',
        uploader_id: 'user-1',
        storage_path: 'chapters/ch-1/backwork/res-1/midterm1.pdf',
        file_hash: 'abc123hash',
        title: 'Midterm 1 Fall 2025',
        department_code: 'CS',
        course_number: '101',
        professor_name: 'Dr. Smith',
        year: 2025,
        semester: 'Fall',
        assignment_type: 'Midterm',
        assignment_number: 1,
        document_variant: 'Student Copy',
        tags: ['midterm', 'cs101'],
      });

      expect(result).toEqual(baseResource);
      expect(mockResourceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          chapter_id: 'ch-1',
          department_id: 'dept-1',
          professor_id: 'prof-1',
          file_hash: 'abc123hash',
        }),
      );
    });

    it('should create resource with minimal metadata (file only)', async () => {
      mockResourceRepo.findByFileHash.mockResolvedValue(null);
      mockResourceRepo.create.mockResolvedValue({
        ...baseResource,
        department_id: null,
        professor_id: null,
        title: null,
      });

      await service.confirmUpload({
        chapter_id: 'ch-1',
        uploader_id: 'user-1',
        storage_path: 'chapters/ch-1/backwork/res-1/file.pdf',
        file_hash: 'newhash',
      });

      expect(mockResourceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          department_id: null,
          professor_id: null,
          title: null,
          tags: [],
        }),
      );
    });

    it('should reject duplicate file hash (409 Conflict)', async () => {
      mockResourceRepo.findByFileHash.mockResolvedValue(baseResource);

      await expect(
        service.confirmUpload({
          chapter_id: 'ch-1',
          uploader_id: 'user-1',
          storage_path: 'chapters/ch-1/backwork/res-2/same.pdf',
          file_hash: 'abc123hash',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it.each([
      'chapters/ch-1/backwork/../../../branding/chapters/ch-2/branding/logo.png',
      'chapters/ch-1/backwork/%2e%2e/%2e%2e/branding/chapters/ch-2/logo.png',
      'chapters/ch-1/backwork/p%/%2e%2e/branding/chapters/ch-2/logo.png',
      'chapters/ch-1/backwork/.\t./branding/chapters/ch-2/logo.png',
    ])(
      'rejects a prefix-passing traversal in storage_path (%p)',
      async (storagePath) => {
        // The startsWith check accepts all of these. Persisting one would let
        // GET /backwork/:id mint a service-role-signed URL to an arbitrary
        // object in any bucket, since the value is echoed back to storage.
        await expect(
          service.confirmUpload({
            chapter_id: 'ch-1',
            uploader_id: 'user-1',
            storage_path: storagePath,
            file_hash: 'newhash',
          }),
        ).rejects.toThrow(BadRequestException);
        expect(mockResourceRepo.create).not.toHaveBeenCalled();
      },
    );

    it('should reject a storage_path outside the chapter (cross-chapter)', async () => {
      await expect(
        service.confirmUpload({
          chapter_id: 'ch-1',
          uploader_id: 'user-1',
          storage_path: 'chapters/other-ch/backwork/res-1/leak.pdf',
          file_hash: 'newhash',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockResourceRepo.findByFileHash).not.toHaveBeenCalled();
      expect(mockResourceRepo.create).not.toHaveBeenCalled();
    });

    it('should reject a storage_path from another module (wrong-module)', async () => {
      await expect(
        service.confirmUpload({
          chapter_id: 'ch-1',
          uploader_id: 'user-1',
          storage_path: 'chapters/ch-1/documents/doc-1/leak.pdf',
          file_hash: 'newhash',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockResourceRepo.create).not.toHaveBeenCalled();
    });

    it('should auto-vivify a new department', async () => {
      mockResourceRepo.findByFileHash.mockResolvedValue(null);
      mockDepartmentRepo.findByCode.mockResolvedValue(null);
      const newDept: BackworkDepartment = {
        id: 'dept-new',
        chapter_id: 'ch-1',
        code: 'MATH',
        name: null,
        created_at: '2026-01-01T00:00:00.000Z',
      };
      mockDepartmentRepo.create.mockResolvedValue(newDept);
      mockResourceRepo.create.mockResolvedValue({
        ...baseResource,
        department_id: 'dept-new',
      });

      await service.confirmUpload({
        chapter_id: 'ch-1',
        uploader_id: 'user-1',
        storage_path: 'chapters/ch-1/backwork/res-1/file.pdf',
        file_hash: 'uniquehash1',
        department_code: 'MATH',
      });

      expect(mockDepartmentRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        code: 'MATH',
      });
      expect(mockResourceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ department_id: 'dept-new' }),
      );
    });

    it('should auto-vivify a new professor', async () => {
      mockResourceRepo.findByFileHash.mockResolvedValue(null);
      mockProfessorRepo.findByName.mockResolvedValue(null);
      const newProf: BackworkProfessor = {
        id: 'prof-new',
        chapter_id: 'ch-1',
        name: 'Dr. Jones',
        created_at: '2026-01-01T00:00:00.000Z',
      };
      mockProfessorRepo.create.mockResolvedValue(newProf);
      mockResourceRepo.create.mockResolvedValue({
        ...baseResource,
        professor_id: 'prof-new',
      });

      await service.confirmUpload({
        chapter_id: 'ch-1',
        uploader_id: 'user-1',
        storage_path: 'chapters/ch-1/backwork/res-1/file.pdf',
        file_hash: 'uniquehash2',
        professor_name: 'Dr. Jones',
      });

      expect(mockProfessorRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        name: 'Dr. Jones',
      });
      expect(mockResourceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ professor_id: 'prof-new' }),
      );
    });

    it('should reuse existing department (no auto-vivification)', async () => {
      mockResourceRepo.findByFileHash.mockResolvedValue(null);
      mockDepartmentRepo.findByCode.mockResolvedValue(baseDepartment);
      mockResourceRepo.create.mockResolvedValue(baseResource);

      await service.confirmUpload({
        chapter_id: 'ch-1',
        uploader_id: 'user-1',
        storage_path: 'chapters/ch-1/backwork/res-3/file.pdf',
        file_hash: 'uniquehash3',
        department_code: 'CS',
      });

      expect(mockDepartmentRepo.create).not.toHaveBeenCalled();
      expect(mockResourceRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ department_id: 'dept-1' }),
      );
    });
  });

  describe('findById', () => {
    it('should return resource with download URL', async () => {
      mockResourceRepo.findById.mockResolvedValue(baseResource);
      mockStorageProvider.getSignedDownloadUrl.mockResolvedValue(
        'https://storage.supabase.co/download/signed',
      );

      const result = await service.findById('res-1', 'ch-1');

      expect(result.downloadUrl).toBe(
        'https://storage.supabase.co/download/signed',
      );
      expect(result.id).toBe('res-1');
    });

    it('should throw NotFoundException when resource not found', async () => {
      mockResourceRepo.findById.mockResolvedValue(null);

      await expect(service.findById('res-x', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByChapter', () => {
    it('should return resources with filters', async () => {
      mockResourceRepo.findByChapter.mockResolvedValue([baseResource]);

      const result = await service.findByChapter('ch-1', {
        department_id: 'dept-1',
        semester: 'Fall',
      });

      expect(mockResourceRepo.findByChapter).toHaveBeenCalledWith('ch-1', {
        department_id: 'dept-1',
        semester: 'Fall',
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('delete', () => {
    it('should delete resource and storage file', async () => {
      mockResourceRepo.findById.mockResolvedValue(baseResource);
      mockStorageProvider.deleteFile.mockResolvedValue();
      mockResourceRepo.delete.mockResolvedValue();

      await service.delete('res-1', 'ch-1');

      expect(mockStorageProvider.deleteFile).toHaveBeenCalledWith(
        'backwork',
        baseResource.storage_path,
      );
      expect(mockResourceRepo.delete).toHaveBeenCalledWith('res-1', 'ch-1');
    });

    it('should throw NotFoundException when resource not found', async () => {
      mockResourceRepo.findById.mockResolvedValue(null);

      await expect(service.delete('res-x', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getDepartments', () => {
    it('should return chapter departments', async () => {
      mockDepartmentRepo.findByChapter.mockResolvedValue([baseDepartment]);
      const result = await service.getDepartments('ch-1');
      expect(result).toEqual([baseDepartment]);
    });
  });

  describe('updateDepartment', () => {
    it('should update department name', async () => {
      mockDepartmentRepo.update.mockResolvedValue({
        ...baseDepartment,
        name: 'Computer Science Updated',
      });

      const result = await service.updateDepartment('dept-1', 'ch-1', {
        name: 'Computer Science Updated',
      });

      expect(mockDepartmentRepo.update).toHaveBeenCalledWith('dept-1', 'ch-1', {
        name: 'Computer Science Updated',
      });
      expect(result.name).toBe('Computer Science Updated');
    });

    it('should not update a department owned by another chapter (404)', async () => {
      // The chapter-scoped update matched no row, so nothing was written.
      mockDepartmentRepo.update.mockResolvedValue(null);

      await expect(
        service.updateDepartment('dept-other-chapter', 'ch-1', {
          name: 'Hijacked',
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockDepartmentRepo.update).toHaveBeenCalledWith(
        'dept-other-chapter',
        'ch-1',
        { name: 'Hijacked' },
      );
    });
  });

  describe('getProfessors', () => {
    it('should return chapter professors', async () => {
      mockProfessorRepo.findByChapter.mockResolvedValue([baseProfessor]);
      const result = await service.getProfessors('ch-1');
      expect(result).toEqual([baseProfessor]);
    });
  });

  describe('updateProfessor', () => {
    it('should update professor name', async () => {
      mockProfessorRepo.update.mockResolvedValue({
        ...baseProfessor,
        name: 'Dr. Jones',
      });

      const result = await service.updateProfessor('prof-1', 'ch-1', {
        name: 'Dr. Jones',
      });

      expect(mockProfessorRepo.update).toHaveBeenCalledWith('prof-1', 'ch-1', {
        name: 'Dr. Jones',
      });
      expect(result.name).toBe('Dr. Jones');
    });

    it('should not update a professor owned by another chapter (404)', async () => {
      mockProfessorRepo.update.mockResolvedValue(null);

      await expect(
        service.updateProfessor('prof-other-chapter', 'ch-1', {
          name: 'Hijacked',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteDepartment', () => {
    it('deletes a department with no referencing resources', async () => {
      mockDepartmentRepo.findById.mockResolvedValue(baseDepartment);
      mockResourceRepo.countByDepartment.mockResolvedValue(0);
      mockDepartmentRepo.delete.mockResolvedValue();

      await service.deleteDepartment('dept-1', 'ch-1');

      expect(mockResourceRepo.countByDepartment).toHaveBeenCalledWith(
        'ch-1',
        'dept-1',
      );
      expect(mockDepartmentRepo.delete).toHaveBeenCalledWith('dept-1', 'ch-1');
    });

    it('blocks deletion while resources still reference the department', async () => {
      mockDepartmentRepo.findById.mockResolvedValue(baseDepartment);
      mockResourceRepo.countByDepartment.mockResolvedValue(3);

      await expect(service.deleteDepartment('dept-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockDepartmentRepo.delete).not.toHaveBeenCalled();
    });

    // Regression: a chapter-scoped `.eq('id', id).eq('chapter_id', chapterId)`
    // delete of a nonexistent or cross-chapter id matches zero rows, and
    // PostgREST does not treat that as an error — so without this existence
    // check the request would have silently "succeeded" with a 200 instead
    // of the 404 every other mutation in this file returns for the same case.
    it('404s rather than silently no-opping on a nonexistent or cross-chapter id', async () => {
      mockDepartmentRepo.findById.mockResolvedValue(null);

      await expect(
        service.deleteDepartment('dept-other-chapter', 'ch-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockResourceRepo.countByDepartment).not.toHaveBeenCalled();
      expect(mockDepartmentRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('deleteProfessor', () => {
    it('deletes a professor with no referencing resources', async () => {
      mockProfessorRepo.findById.mockResolvedValue(baseProfessor);
      mockResourceRepo.countByProfessor.mockResolvedValue(0);
      mockProfessorRepo.delete.mockResolvedValue();

      await service.deleteProfessor('prof-1', 'ch-1');

      expect(mockProfessorRepo.delete).toHaveBeenCalledWith('prof-1', 'ch-1');
    });

    it('blocks deletion while resources still reference the professor', async () => {
      mockProfessorRepo.findById.mockResolvedValue(baseProfessor);
      mockResourceRepo.countByProfessor.mockResolvedValue(1);

      await expect(service.deleteProfessor('prof-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockProfessorRepo.delete).not.toHaveBeenCalled();
    });

    it('404s rather than silently no-opping on a nonexistent or cross-chapter id', async () => {
      mockProfessorRepo.findById.mockResolvedValue(null);

      await expect(
        service.deleteProfessor('prof-other-chapter', 'ch-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockResourceRepo.countByProfessor).not.toHaveBeenCalled();
      expect(mockProfessorRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('mergeDepartments', () => {
    const other: BackworkDepartment = {
      ...baseDepartment,
      id: 'dept-2',
      code: 'MATH',
    };

    it('reassigns referencing resources then deletes the source', async () => {
      mockDepartmentRepo.findById.mockImplementation(async (id) =>
        id === 'dept-1' ? baseDepartment : id === 'dept-2' ? other : null,
      );
      mockResourceRepo.reassignDepartment.mockResolvedValue(4);
      mockDepartmentRepo.delete.mockResolvedValue();

      const result = await service.mergeDepartments('dept-1', 'dept-2', 'ch-1');

      expect(mockResourceRepo.reassignDepartment).toHaveBeenCalledWith(
        'ch-1',
        'dept-1',
        'dept-2',
      );
      expect(mockDepartmentRepo.delete).toHaveBeenCalledWith('dept-1', 'ch-1');
      expect(result).toEqual({ reassigned: 4 });
    });

    it('rejects merging a department into itself', async () => {
      await expect(
        service.mergeDepartments('dept-1', 'dept-1', 'ch-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockDepartmentRepo.findById).not.toHaveBeenCalled();
    });

    it('404s when the source or target is not in this chapter', async () => {
      mockDepartmentRepo.findById.mockResolvedValue(null);

      await expect(
        service.mergeDepartments('dept-1', 'dept-other-chapter', 'ch-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockResourceRepo.reassignDepartment).not.toHaveBeenCalled();
      expect(mockDepartmentRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('mergeProfessors', () => {
    const other: BackworkProfessor = {
      ...baseProfessor,
      id: 'prof-2',
      name: 'Dr. Jones',
    };

    it('reassigns referencing resources then deletes the source', async () => {
      mockProfessorRepo.findById.mockImplementation(async (id) =>
        id === 'prof-1' ? baseProfessor : id === 'prof-2' ? other : null,
      );
      mockResourceRepo.reassignProfessor.mockResolvedValue(2);
      mockProfessorRepo.delete.mockResolvedValue();

      const result = await service.mergeProfessors('prof-1', 'prof-2', 'ch-1');

      expect(mockResourceRepo.reassignProfessor).toHaveBeenCalledWith(
        'ch-1',
        'prof-1',
        'prof-2',
      );
      expect(mockProfessorRepo.delete).toHaveBeenCalledWith('prof-1', 'ch-1');
      expect(result).toEqual({ reassigned: 2 });
    });

    it('rejects merging a professor into itself', async () => {
      await expect(
        service.mergeProfessors('prof-1', 'prof-1', 'ch-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s when the source or target is not in this chapter', async () => {
      mockProfessorRepo.findById.mockResolvedValue(null);

      await expect(
        service.mergeProfessors('prof-1', 'prof-other-chapter', 'ch-1'),
      ).rejects.toThrow(NotFoundException);
      expect(mockResourceRepo.reassignProfessor).not.toHaveBeenCalled();
      expect(mockProfessorRepo.delete).not.toHaveBeenCalled();
    });
  });
});
