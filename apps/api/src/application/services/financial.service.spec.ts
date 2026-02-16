/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { FinancialService } from './financial.service';
import { FINANCIAL_REPOSITORY } from '../../domain/repositories/financial.repository.interface';
import { BILLING_PROVIDER } from '../../domain/adapters/billing.interface';
import { NotFoundException, BadRequestException } from '@nestjs/common';

describe('FinancialService', () => {
  let service: FinancialService;

  const mockRepo = {
    createInvoice: jest.fn(),
    findInvoiceById: jest.fn(),
    updateInvoice: jest.fn(),
    createTransaction: jest.fn(),
    findInvoicesByUser: jest.fn(),
  };

  const mockBilling = {
    createInvoiceCheckout: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialService,
        { provide: FINANCIAL_REPOSITORY, useValue: mockRepo },
        { provide: BILLING_PROVIDER, useValue: mockBilling },
      ],
    }).compile();

    service = module.get<FinancialService>(FinancialService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createInvoice', () => {
    it('should create an OPEN invoice', async () => {
      const data = {
        userId: 'u1',
        chapterId: 'c1',
        amount: 5000,
        title: 'Dues',
        description: 'Fall',
        dueDate: new Date(),
      };
      mockRepo.createInvoice.mockResolvedValue({
        id: 'i1',
        ...data,
        status: 'OPEN',
      });

      const result = await service.createInvoice(data);
      expect(result.id).toBe('i1');
      expect(mockRepo.createInvoice).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'OPEN' }),
      );
    });
  });

  describe('generatePaymentLink', () => {
    it('should return checkout url for OPEN invoice', async () => {
      const invoice = {
        id: 'i1',
        amount: 5000,
        title: 'Dues',
        status: 'OPEN',
        userId: 'u1', // In a real app we'd fetch customerId from user
      };
      // Mock finding invoice
      mockRepo.findInvoiceById.mockResolvedValue(invoice);
      // Mock billing provider
      mockBilling.createInvoiceCheckout.mockResolvedValue('https://checkout');

      const url = await service.generatePaymentLink(
        'i1',
        'cus_123',
        'https://s',
        'https://c',
      );
      expect(url).toBe('https://checkout');
      expect(mockBilling.createInvoiceCheckout).toHaveBeenCalledWith(
        'cus_123',
        5000,
        'Dues',
        'https://s',
        'https://c',
        { invoiceId: 'i1' },
      );
    });

    it('should throw if invoice not found', async () => {
      mockRepo.findInvoiceById.mockResolvedValue(null);
      await expect(
        service.generatePaymentLink('i1', 'c', 's', 'c'),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw if invoice is already PAID', async () => {
      mockRepo.findInvoiceById.mockResolvedValue({ status: 'PAID' });
      await expect(
        service.generatePaymentLink('i1', 'c', 's', 'c'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('processPayment', () => {
    it('should update invoice and create transaction', async () => {
      const invoice = {
        id: 'i1',
        status: 'OPEN',
        amount: 5000,
        chapterId: 'c1',
      };
      mockRepo.findInvoiceById.mockResolvedValue(invoice);
      mockRepo.updateInvoice.mockResolvedValue({ ...invoice, status: 'PAID' });

      await service.processPayment('i1', 'pi_123');

      expect(mockRepo.updateInvoice).toHaveBeenCalledWith('i1', {
        status: 'PAID',
        paidAt: expect.any(Date),
        stripePaymentIntentId: 'pi_123',
      });
      expect(mockRepo.createTransaction).toHaveBeenCalledWith({
        chapterId: 'c1',
        invoiceId: 'i1',
        amount: 5000,
        type: 'PAYMENT',
        stripeChargeId: 'pi_123', // Simplified mapping
      });
    });

    it('should perform idempotent update if already PAID', async () => {
      const invoice = { id: 'i1', status: 'PAID', amount: 5000 };
      mockRepo.findInvoiceById.mockResolvedValue(invoice);

      await service.processPayment('i1', 'pi_123');

      expect(mockRepo.updateInvoice).not.toHaveBeenCalled();
      expect(mockRepo.createTransaction).not.toHaveBeenCalled();
    });
  });
});
