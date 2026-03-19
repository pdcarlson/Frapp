import { Test, TestingModule } from '@nestjs/testing';
import { BackworkController } from './backwork.controller';
import { BackworkService } from '../../application/services/backwork.service';
import {
  RequestBackworkUploadUrlDto,
  ConfirmBackworkUploadDto,
  UpdateDepartmentDto,
} from '../dtos/backwork.dto';

describe('BackworkController', () => {
  let controller: BackworkController;
  let service: BackworkService;

  const mockBackworkService = {
    requestUploadUrl: jest.fn(),
    confirmUpload: jest.fn(),
    findByChapter: jest.fn(),
    getDepartments: jest.fn(),
    updateDepartment: jest.fn(),
    getProfessors: jest.fn(),
    findById: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BackworkController],
      providers: [
        {
          provide: BackworkService,
          useValue: mockBackworkService,
        },
        {
          provide: 'SUPABASE_CLIENT',
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<BackworkController>(BackworkController);
    service = module.get<BackworkService>(BackworkService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('requestUploadUrl', () => {
    it('should call backworkService.requestUploadUrl with correct parameters', async () => {
      const chapterId = 'chapter-123';
      const dto: RequestBackworkUploadUrlDto = {
        filename: 'test.pdf',
        content_type: 'application/pdf',
      };
      const expectedResult = { url: 'http://test.url' };
      mockBackworkService.requestUploadUrl.mockResolvedValue(expectedResult);

      const result = await controller.requestUploadUrl(chapterId, dto);

      expect(service.requestUploadUrl).toHaveBeenCalledWith({
        chapterId,
        filename: dto.filename,
        contentType: dto.content_type,
      });
      expect(result).toEqual(expectedResult);
    });
  });

  describe('confirmUpload', () => {
    it('should call backworkService.confirmUpload with correct parameters', async () => {
      const chapterId = 'chapter-123';
      const userId = 'user-123';
      const dto: ConfirmBackworkUploadDto = {
        storage_path: 'path/to/file',
        file_hash: 'hash',
        title: 'Test File',
      };
      const expectedResult = { id: 'file-123' };
      mockBackworkService.confirmUpload.mockResolvedValue(expectedResult);

      const result = await controller.confirmUpload(chapterId, userId, dto);

      expect(service.confirmUpload).toHaveBeenCalledWith({
        chapter_id: chapterId,
        uploader_id: userId,
        ...dto,
      });
      expect(result).toEqual(expectedResult);
    });
  });

  describe('list', () => {
    it('should call backworkService.findByChapter with correct parameters', async () => {
      const chapterId = 'chapter-123';
      const expectedResult = [{ id: 'file-123' }];
      mockBackworkService.findByChapter.mockResolvedValue(expectedResult);

      const result = await controller.list(
        chapterId,
        'dept-1',
        'prof-1',
        'CS101',
        2023,
        'Fall',
        'Exam',
        'Blank Copy',
        'test query',
      );

      expect(service.findByChapter).toHaveBeenCalledWith(chapterId, {
        department_id: 'dept-1',
        professor_id: 'prof-1',
        course_number: 'CS101',
        year: 2023,
        semester: 'Fall',
        assignment_type: 'Exam',
        document_variant: 'Blank Copy',
        search: 'test query',
      });
      expect(result).toEqual(expectedResult);
    });

    it('should call backworkService.findByChapter with undefined for omitted parameters', async () => {
      const chapterId = 'chapter-123';
      const expectedResult = [{ id: 'file-123' }];
      mockBackworkService.findByChapter.mockResolvedValue(expectedResult);

      const result = await controller.list(chapterId);

      expect(service.findByChapter).toHaveBeenCalledWith(chapterId, {
        department_id: undefined,
        professor_id: undefined,
        course_number: undefined,
        year: undefined,
        semester: undefined,
        assignment_type: undefined,
        document_variant: undefined,
        search: undefined,
      });
      expect(result).toEqual(expectedResult);
    });
  });

  describe('listDepartments', () => {
    it('should call backworkService.getDepartments with correct parameters', async () => {
      const chapterId = 'chapter-123';
      const expectedResult = [{ id: 'dept-1' }];
      mockBackworkService.getDepartments.mockResolvedValue(expectedResult);

      const result = await controller.listDepartments(chapterId);

      expect(service.getDepartments).toHaveBeenCalledWith(chapterId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('updateDepartment', () => {
    it('should call backworkService.updateDepartment with correct parameters', async () => {
      const id = 'dept-1';
      const dto: UpdateDepartmentDto = { name: 'Computer Science' };
      const expectedResult = { id: 'dept-1', name: 'Computer Science' };
      mockBackworkService.updateDepartment.mockResolvedValue(expectedResult);

      const result = await controller.updateDepartment(id, dto);

      expect(service.updateDepartment).toHaveBeenCalledWith(id, dto);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('listProfessors', () => {
    it('should call backworkService.getProfessors with correct parameters', async () => {
      const chapterId = 'chapter-123';
      const expectedResult = [{ id: 'prof-1' }];
      mockBackworkService.getProfessors.mockResolvedValue(expectedResult);

      const result = await controller.listProfessors(chapterId);

      expect(service.getProfessors).toHaveBeenCalledWith(chapterId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getOne', () => {
    it('should call backworkService.findById with correct parameters', async () => {
      const chapterId = 'chapter-123';
      const id = 'file-123';
      const expectedResult = { id: 'file-123' };
      mockBackworkService.findById.mockResolvedValue(expectedResult);

      const result = await controller.getOne(chapterId, id);

      expect(service.findById).toHaveBeenCalledWith(id, chapterId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('delete', () => {
    it('should call backworkService.delete with correct parameters', async () => {
      const chapterId = 'chapter-123';
      const id = 'file-123';
      mockBackworkService.delete.mockResolvedValue(undefined);

      const result = await controller.delete(chapterId, id);

      expect(service.delete).toHaveBeenCalledWith(id, chapterId);
      expect(result).toEqual({ success: true });
    });
  });
});
