import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { FinancialInvoiceService } from './financial-invoice.service';
import { FINANCIAL_INVOICE_REPOSITORY } from '../../domain/repositories/financial-invoice.repository.interface';
import type { IFinancialInvoiceRepository } from '../../domain/repositories/financial-invoice.repository.interface';
import { FINANCIAL_TRANSACTION_REPOSITORY } from '../../domain/repositories/financial-transaction.repository.interface';
import type { IFinancialTransactionRepository } from '../../domain/repositories/financial-transaction.repository.interface';
import type { FinancialInvoice } from '../../domain/entities/financial-invoice.entity';

describe('FinancialInvoiceService', () => {
  let service: FinancialInvoiceService;
  let mockInvoiceRepo: jest.Mocked<IFinancialInvoiceRepository>;
  let mockTransactionRepo: jest.Mocked<IFinancialTransactionRepository>;

  const baseInvoice: FinancialInvoice = {
    id: 'inv-1',
    chapter_id: 'ch-1',
    user_id: 'user-1',
    title: 'Fall 2026 Dues',
    description: 'Semester dues payment',
    amount: 15000,
    status: 'DRAFT',
    due_date: '2026-09-15',
    paid_at: null,
    stripe_payment_intent_id: null,
    created_at: '2026-08-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    mockInvoiceRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByUser: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockTransactionRepo = {
      findByChapter: jest.fn(),
      findByInvoice: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialInvoiceService,
        {
          provide: FINANCIAL_INVOICE_REPOSITORY,
          useValue: mockInvoiceRepo,
        },
        {
          provide: FINANCIAL_TRANSACTION_REPOSITORY,
          useValue: mockTransactionRepo,
        },
      ],
    }).compile();

    service = module.get(FinancialInvoiceService);
  });

  describe('findById', () => {
    it('should return an invoice', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(baseInvoice);
      const result = await service.findById('inv-1', 'ch-1');
      expect(result).toEqual(baseInvoice);
    });

    it('should throw NotFoundException when invoice not found', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(null);
      await expect(service.findById('inv-x', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findByChapter', () => {
    it('should return all chapter invoices', async () => {
      mockInvoiceRepo.findByChapter.mockResolvedValue([baseInvoice]);
      const result = await service.findByChapter('ch-1');
      expect(result).toEqual([baseInvoice]);
    });
  });

  describe('findByUser', () => {
    it('should return invoices for a specific user', async () => {
      mockInvoiceRepo.findByUser.mockResolvedValue([baseInvoice]);
      const result = await service.findByUser('user-1', 'ch-1');
      expect(result).toEqual([baseInvoice]);
    });
  });

  describe('create', () => {
    it('should create a DRAFT invoice', async () => {
      mockInvoiceRepo.create.mockResolvedValue(baseInvoice);

      const result = await service.create({
        chapter_id: 'ch-1',
        user_id: 'user-1',
        title: 'Fall 2026 Dues',
        description: 'Semester dues payment',
        amount: 15000,
        due_date: '2026-09-15',
      });

      expect(mockInvoiceRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        user_id: 'user-1',
        title: 'Fall 2026 Dues',
        description: 'Semester dues payment',
        amount: 15000,
        status: 'DRAFT',
        due_date: '2026-09-15',
      });
      expect(result).toEqual(baseInvoice);
    });

    it('should reject zero or negative amounts', async () => {
      await expect(
        service.create({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          title: 'Bad Invoice',
          amount: 0,
          due_date: '2026-09-15',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.create({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          title: 'Bad Invoice',
          amount: -100,
          due_date: '2026-09-15',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid dates', async () => {
      await expect(
        service.create({
          chapter_id: 'ch-1',
          user_id: 'user-1',
          title: 'Bad Date',
          amount: 100,
          due_date: 'not-a-date',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('should update a DRAFT invoice', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(baseInvoice);
      mockInvoiceRepo.update.mockResolvedValue({
        ...baseInvoice,
        title: 'Updated Title',
      });

      const result = await service.update('inv-1', 'ch-1', {
        title: 'Updated Title',
      });

      expect(result.title).toBe('Updated Title');
    });

    it('should reject updates to non-DRAFT invoices', async () => {
      const openInvoice = { ...baseInvoice, status: 'OPEN' as const };
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);

      await expect(
        service.update('inv-1', 'ch-1', { title: 'New Title' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid amounts on update', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(baseInvoice);

      await expect(
        service.update('inv-1', 'ch-1', { amount: -50 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('transitionStatus', () => {
    it('should transition DRAFT to OPEN', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(baseInvoice);
      mockInvoiceRepo.update.mockResolvedValue({
        ...baseInvoice,
        status: 'OPEN',
      });

      const result = await service.transitionStatus('inv-1', 'ch-1', 'OPEN');
      expect(result.status).toBe('OPEN');
    });

    it('should transition DRAFT to VOID', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(baseInvoice);
      mockInvoiceRepo.update.mockResolvedValue({
        ...baseInvoice,
        status: 'VOID',
      });

      const result = await service.transitionStatus('inv-1', 'ch-1', 'VOID');
      expect(result.status).toBe('VOID');
    });

    it('should transition OPEN to PAID and create transaction', async () => {
      const openInvoice = { ...baseInvoice, status: 'OPEN' as const };
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockInvoiceRepo.update.mockResolvedValue({
        ...openInvoice,
        status: 'PAID',
        paid_at: '2026-09-10T00:00:00.000Z',
      });
      mockTransactionRepo.create.mockResolvedValue({
        id: 'txn-1',
        chapter_id: 'ch-1',
        invoice_id: 'inv-1',
        amount: 15000,
        type: 'PAYMENT',
        stripe_charge_id: null,
        created_at: '2026-09-10T00:00:00.000Z',
      });

      await service.transitionStatus('inv-1', 'ch-1', 'PAID');

      expect(mockTransactionRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        invoice_id: 'inv-1',
        amount: 15000,
        type: 'PAYMENT',
      });
    });

    it('should transition OPEN to VOID', async () => {
      const openInvoice = { ...baseInvoice, status: 'OPEN' as const };
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockInvoiceRepo.update.mockResolvedValue({
        ...openInvoice,
        status: 'VOID',
      });

      const result = await service.transitionStatus('inv-1', 'ch-1', 'VOID');
      expect(result.status).toBe('VOID');
      expect(mockTransactionRepo.create).not.toHaveBeenCalled();
    });

    it('should reject invalid transitions from PAID', async () => {
      const paidInvoice = {
        ...baseInvoice,
        status: 'PAID' as const,
        paid_at: '2026-09-10T00:00:00.000Z',
      };
      mockInvoiceRepo.findById.mockResolvedValue(paidInvoice);

      await expect(
        service.transitionStatus('inv-1', 'ch-1', 'VOID'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid transitions from VOID', async () => {
      const voidedInvoice = { ...baseInvoice, status: 'VOID' as const };
      mockInvoiceRepo.findById.mockResolvedValue(voidedInvoice);

      await expect(
        service.transitionStatus('inv-1', 'ch-1', 'OPEN'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject DRAFT to PAID (must go through OPEN first)', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(baseInvoice);

      await expect(
        service.transitionStatus('inv-1', 'ch-1', 'PAID'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getTransactions', () => {
    it('should return chapter financial transactions', async () => {
      mockTransactionRepo.findByChapter.mockResolvedValue([]);
      const result = await service.getTransactions('ch-1');
      expect(result).toEqual([]);
    });
  });

  describe('getInvoiceTransactions', () => {
    it('should return transactions for a specific invoice', async () => {
      mockTransactionRepo.findByInvoice.mockResolvedValue([]);
      const result = await service.getInvoiceTransactions('inv-1');
      expect(result).toEqual([]);
    });
  });
});
