import { Test, TestingModule } from '@nestjs/testing';
import { FinancialInvoiceController } from './financial-invoice.controller';
import { FinancialInvoiceService } from '../../application/services/financial-invoice.service';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import {
  CreateFinancialInvoiceDto,
  UpdateFinancialInvoiceDto,
  TransitionInvoiceStatusDto,
} from '../dtos/financial-invoice.dto';
import { Reflector } from '@nestjs/core';
import { SystemPermissions } from '../../domain/constants/permissions';
import { RequirePermissions } from '../decorators/permissions.decorator';

describe('FinancialInvoiceController', () => {
  let controller: FinancialInvoiceController;
  let service: jest.Mocked<Partial<FinancialInvoiceService>>;
  let rbacService: jest.Mocked<Pick<RbacService, 'memberHasAnyPermission'>>;

  beforeEach(async () => {
    rbacService = {
      memberHasAnyPermission: jest.fn(),
    };
    service = {
      findByUser: jest.fn(),
      findByChapter: jest.fn(),
      findOverdue: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      transitionStatus: jest.fn(),
      getInvoiceTransactions: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FinancialInvoiceController],
      providers: [
        {
          provide: FinancialInvoiceService,
          useValue: service,
        },
        { provide: RbacService, useValue: rbacService },
        {
          provide: 'SUPABASE_CLIENT',
          useValue: {},
        },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get<FinancialInvoiceController>(
      FinancialInvoiceController,
    );
    rbacService.memberHasAnyPermission.mockResolvedValue(false);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('list', () => {
    it('should call findByUser for another user when caller has billing view', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const filterUserId = 'user-2';
      const mockResult = [{ id: 'invoice-1' }];
      rbacService.memberHasAnyPermission.mockResolvedValue(true);
      service.findByUser.mockResolvedValue(mockResult as any);

      const result = await controller.list(chapterId, userId, filterUserId);

      expect(service.findByUser).toHaveBeenCalledWith(filterUserId, chapterId);
      expect(result).toBe(mockResult);
    });

    it('should call findByUser for self when caller lacks billing view', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const mockResult = [{ id: 'invoice-1' }];
      rbacService.memberHasAnyPermission.mockResolvedValue(false);
      service.findByUser.mockResolvedValue(mockResult as any);

      const result = await controller.list(chapterId, userId);

      expect(service.findByUser).toHaveBeenCalledWith(userId, chapterId);
      expect(result).toBe(mockResult);
    });

    it('should call findByChapter when caller has billing view', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const mockResult = [{ id: 'invoice-1' }];
      rbacService.memberHasAnyPermission.mockResolvedValue(true);
      service.findByChapter.mockResolvedValue(mockResult as any);

      const result = await controller.list(chapterId, userId);

      expect(service.findByChapter).toHaveBeenCalledWith(chapterId);
      expect(result).toBe(mockResult);
    });
  });

  describe('listOverdue', () => {
    it('should call findOverdue', async () => {
      const chapterId = 'chapter-1';
      const mockResult = [{ id: 'invoice-1' }];
      service.findOverdue.mockResolvedValue(mockResult as any);

      const result = await controller.listOverdue(chapterId);

      expect(service.findOverdue).toHaveBeenCalledWith(chapterId);
      expect(result).toBe(mockResult);
    });

    it('should have correct permissions metadata', () => {
      const target = controller.listOverdue;
      const metadata = Reflect.getMetadata('permissions', target);
      expect(metadata).toEqual([SystemPermissions.BILLING_VIEW]);
    });
  });

  describe('getOne', () => {
    it('should return invoice for owner', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const id = 'invoice-1';
      const mockResult = { id: 'invoice-1', user_id: userId };
      service.findById.mockResolvedValue(mockResult as any);
      rbacService.memberHasAnyPermission.mockResolvedValue(false);

      const result = await controller.getOne(chapterId, userId, id);

      expect(service.findById).toHaveBeenCalledWith(id, chapterId);
      expect(result).toBe(mockResult);
    });

    it('should return invoice for billing viewer when not owner', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const id = 'invoice-1';
      const mockResult = { id: 'invoice-1', user_id: 'user-2' };
      service.findById.mockResolvedValue(mockResult as any);
      rbacService.memberHasAnyPermission.mockResolvedValue(true);

      const result = await controller.getOne(chapterId, userId, id);

      expect(result).toBe(mockResult);
    });
  });

  describe('create', () => {
    it('should call create on service', async () => {
      const chapterId = 'chapter-1';
      const dto: CreateFinancialInvoiceDto = {
        user_id: 'user-1',
        title: 'Fall 2026 Dues',
        amount: 15000,
        due_date: '2026-10-01T00:00:00Z',
      };
      const mockResult = { id: 'invoice-1', ...dto, chapter_id: chapterId };
      service.create.mockResolvedValue(mockResult as any);

      const result = await controller.create(chapterId, dto);

      expect(service.create).toHaveBeenCalledWith({
        chapter_id: chapterId,
        ...dto,
      });
      expect(result).toBe(mockResult);
    });

    it('should have correct permissions metadata', () => {
      const target = controller.create;
      const metadata = Reflect.getMetadata('permissions', target);
      expect(metadata).toEqual([SystemPermissions.BILLING_MANAGE]);
    });
  });

  describe('update', () => {
    it('should call update on service', async () => {
      const chapterId = 'chapter-1';
      const id = 'invoice-1';
      const dto: UpdateFinancialInvoiceDto = {
        title: 'Updated Dues',
      };
      const mockResult = { id, title: dto.title };
      service.update.mockResolvedValue(mockResult as any);

      const result = await controller.update(chapterId, id, dto);

      expect(service.update).toHaveBeenCalledWith(id, chapterId, dto);
      expect(result).toBe(mockResult);
    });

    it('should have correct permissions metadata', () => {
      const target = controller.update;
      const metadata = Reflect.getMetadata('permissions', target);
      expect(metadata).toEqual([SystemPermissions.BILLING_MANAGE]);
    });
  });

  describe('transitionStatus', () => {
    it('should call transitionStatus on service', async () => {
      const chapterId = 'chapter-1';
      const id = 'invoice-1';
      const dto: TransitionInvoiceStatusDto = {
        status: 'PAID',
      };
      const mockResult = { id, status: dto.status };
      service.transitionStatus.mockResolvedValue(mockResult as any);

      const result = await controller.transitionStatus(chapterId, id, dto);

      expect(service.transitionStatus).toHaveBeenCalledWith(
        id,
        chapterId,
        dto.status,
      );
      expect(result).toBe(mockResult);
    });

    it('should have correct permissions metadata', () => {
      const target = controller.transitionStatus;
      const metadata = Reflect.getMetadata('permissions', target);
      expect(metadata).toEqual([SystemPermissions.BILLING_MANAGE]);
    });
  });

  describe('getInvoiceTransactions', () => {
    it('should call getInvoiceTransactions on service', async () => {
      const chapterId = 'chapter-1';
      const id = 'invoice-1';
      const mockResult = [{ id: 'tx-1' }];
      service.getInvoiceTransactions.mockResolvedValue(mockResult as any);

      const result = await controller.getInvoiceTransactions(chapterId, id);

      expect(service.getInvoiceTransactions).toHaveBeenCalledWith(
        id,
        chapterId,
      );
      expect(result).toBe(mockResult);
    });

    it('should have correct permissions metadata', () => {
      const target = controller.getInvoiceTransactions;
      const metadata = Reflect.getMetadata('permissions', target);
      expect(metadata).toEqual([SystemPermissions.BILLING_VIEW]);
    });
  });
});
