import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FinancialInvoiceService } from './financial-invoice.service';
import { FINANCIAL_INVOICE_REPOSITORY } from '../../domain/repositories/financial-invoice.repository.interface';
import type { IFinancialInvoiceRepository } from '../../domain/repositories/financial-invoice.repository.interface';
import { FINANCIAL_TRANSACTION_REPOSITORY } from '../../domain/repositories/financial-transaction.repository.interface';
import type { IFinancialTransactionRepository } from '../../domain/repositories/financial-transaction.repository.interface';
import { BILLING_PROVIDER } from '../../domain/adapters/billing.interface';
import type { IBillingProvider } from '../../domain/adapters/billing.interface';
import type { FinancialInvoice } from '../../domain/entities/financial-invoice.entity';
import { NotificationService } from './notification.service';

describe('FinancialInvoiceService', () => {
  let service: FinancialInvoiceService;
  let mockInvoiceRepo: jest.Mocked<IFinancialInvoiceRepository>;
  let mockTransactionRepo: jest.Mocked<IFinancialTransactionRepository>;
  let mockBillingProvider: jest.Mocked<IBillingProvider>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;

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
      findOverdue: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      applyPayment: jest.fn(),
    };

    mockTransactionRepo = {
      findByChapter: jest.fn(),
      findByInvoice: jest.fn(),
      create: jest.fn(),
    };

    mockBillingProvider = {
      createCustomer: jest.fn(),
      createCheckoutSession: jest.fn(),
      createCustomerPortalSession: jest.fn(),
      getSubscriptionStatus: jest.fn(),
      cancelSubscription: jest.fn(),
      createPaymentIntent: jest.fn(),
      getPaymentIntent: jest.fn(),
      constructWebhookEvent: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
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
        { provide: BILLING_PROVIDER, useValue: mockBillingProvider },
        { provide: NotificationService, useValue: mockNotificationService },
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
      // AC3: manual PAID transitions never attach a Stripe charge id.
      const createArg = mockTransactionRepo.create.mock.calls[0][0];
      expect(createArg.stripe_charge_id).toBeUndefined();
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

  describe('createPaymentIntent', () => {
    const openInvoice: FinancialInvoice = {
      ...baseInvoice,
      status: 'OPEN',
    };

    it('should create a new PaymentIntent for an OPEN invoice owned by the caller', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockBillingProvider.createPaymentIntent.mockResolvedValue({
        id: 'pi_new_123',
        status: 'requires_payment_method',
        clientSecret: 'pi_new_123_secret',
        latestChargeId: null,
      });
      mockInvoiceRepo.update.mockResolvedValue({
        ...openInvoice,
        stripe_payment_intent_id: 'pi_new_123',
      });

      const result = await service.createPaymentIntent(
        'inv-1',
        'ch-1',
        'user-1',
      );

      expect(mockBillingProvider.createPaymentIntent).toHaveBeenCalledWith({
        amount: 15000,
        currency: 'usd',
        metadata: {
          invoice_id: 'inv-1',
          chapter_id: 'ch-1',
          user_id: 'user-1',
        },
      });
      expect(mockInvoiceRepo.update).toHaveBeenCalledWith('inv-1', 'ch-1', {
        stripe_payment_intent_id: 'pi_new_123',
      });
      expect(result).toEqual({
        client_secret: 'pi_new_123_secret',
        payment_intent_id: 'pi_new_123',
      });
    });

    it('should reject payment attempts by a non-owner without touching the provider', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);

      await expect(
        service.createPaymentIntent('inv-1', 'ch-1', 'user-other'),
      ).rejects.toThrow(ForbiddenException);

      expect(mockBillingProvider.createPaymentIntent).not.toHaveBeenCalled();
      expect(mockBillingProvider.getPaymentIntent).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the invoice is not in the chapter', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(null);

      await expect(
        service.createPaymentIntent('inv-1', 'ch-other', 'user-1'),
      ).rejects.toThrow(NotFoundException);

      expect(mockBillingProvider.createPaymentIntent).not.toHaveBeenCalled();
    });

    it('should reject DRAFT invoices', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(baseInvoice);

      await expect(
        service.createPaymentIntent('inv-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);

      expect(mockBillingProvider.createPaymentIntent).not.toHaveBeenCalled();
    });

    it('should reject PAID invoices', async () => {
      mockInvoiceRepo.findById.mockResolvedValue({
        ...baseInvoice,
        status: 'PAID',
        paid_at: '2026-09-10T00:00:00.000Z',
      });

      await expect(
        service.createPaymentIntent('inv-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);

      expect(mockBillingProvider.createPaymentIntent).not.toHaveBeenCalled();
    });

    it('should reuse a stored PaymentIntent that is still confirmable', async () => {
      mockInvoiceRepo.findById.mockResolvedValue({
        ...openInvoice,
        stripe_payment_intent_id: 'pi_stored_1',
      });
      mockBillingProvider.getPaymentIntent.mockResolvedValue({
        id: 'pi_stored_1',
        status: 'requires_payment_method',
        clientSecret: 'pi_stored_1_secret',
        latestChargeId: null,
      });

      const result = await service.createPaymentIntent(
        'inv-1',
        'ch-1',
        'user-1',
      );

      expect(mockBillingProvider.getPaymentIntent).toHaveBeenCalledWith(
        'pi_stored_1',
      );
      expect(mockBillingProvider.createPaymentIntent).not.toHaveBeenCalled();
      expect(mockInvoiceRepo.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        client_secret: 'pi_stored_1_secret',
        payment_intent_id: 'pi_stored_1',
      });
    });

    it('should throw ConflictException when the stored PaymentIntent already succeeded', async () => {
      mockInvoiceRepo.findById.mockResolvedValue({
        ...openInvoice,
        stripe_payment_intent_id: 'pi_done_1',
      });
      mockBillingProvider.getPaymentIntent.mockResolvedValue({
        id: 'pi_done_1',
        status: 'succeeded',
        clientSecret: 'pi_done_1_secret',
        latestChargeId: 'ch_1',
      });

      await expect(
        service.createPaymentIntent('inv-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ConflictException);

      expect(mockBillingProvider.createPaymentIntent).not.toHaveBeenCalled();
      expect(mockInvoiceRepo.update).not.toHaveBeenCalled();
    });

    it('should mint a fresh PaymentIntent when the stored one was canceled', async () => {
      mockInvoiceRepo.findById.mockResolvedValue({
        ...openInvoice,
        stripe_payment_intent_id: 'pi_canceled_1',
      });
      mockBillingProvider.getPaymentIntent.mockResolvedValue({
        id: 'pi_canceled_1',
        status: 'canceled',
        clientSecret: null,
        latestChargeId: null,
      });
      mockBillingProvider.createPaymentIntent.mockResolvedValue({
        id: 'pi_fresh_2',
        status: 'requires_payment_method',
        clientSecret: 'pi_fresh_2_secret',
        latestChargeId: null,
      });
      mockInvoiceRepo.update.mockResolvedValue({
        ...openInvoice,
        stripe_payment_intent_id: 'pi_fresh_2',
      });

      const result = await service.createPaymentIntent(
        'inv-1',
        'ch-1',
        'user-1',
      );

      expect(mockBillingProvider.createPaymentIntent).toHaveBeenCalledTimes(1);
      expect(mockInvoiceRepo.update).toHaveBeenCalledWith('inv-1', 'ch-1', {
        stripe_payment_intent_id: 'pi_fresh_2',
      });
      expect(result).toEqual({
        client_secret: 'pi_fresh_2_secret',
        payment_intent_id: 'pi_fresh_2',
      });
    });

    it('should throw ServiceUnavailableException when the provider fails', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockBillingProvider.createPaymentIntent.mockRejectedValue(
        new Error('stripe is down'),
      );

      await expect(
        service.createPaymentIntent('inv-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(mockInvoiceRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('applyStripePaymentSuccess', () => {
    const paidInvoice: FinancialInvoice = {
      ...baseInvoice,
      status: 'PAID',
      paid_at: '2026-09-10T00:00:00.000Z',
      stripe_payment_intent_id: 'pi_1',
    };

    it('should apply the payment and notify the invoice owner', async () => {
      mockInvoiceRepo.applyPayment.mockResolvedValue(paidInvoice);

      await service.applyStripePaymentSuccess({
        invoiceId: 'inv-1',
        chapterId: 'ch-1',
        paymentIntentId: 'pi_1',
        chargeId: 'ch_charge_1',
      });

      expect(mockInvoiceRepo.applyPayment).toHaveBeenCalledWith(
        'inv-1',
        'ch-1',
        'pi_1',
        'ch_charge_1',
      );
      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        expect.objectContaining({
          category: 'billing',
          title: 'Payment received',
        }),
      );
    });

    it('should silently no-op on duplicate delivery for an already PAID invoice', async () => {
      mockInvoiceRepo.applyPayment.mockResolvedValue(null);
      mockInvoiceRepo.findById.mockResolvedValue(paidInvoice);

      await expect(
        service.applyStripePaymentSuccess({
          invoiceId: 'inv-1',
          chapterId: 'ch-1',
          paymentIntentId: 'pi_1',
          chargeId: 'ch_charge_1',
        }),
      ).resolves.toBeUndefined();

      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('should resolve without notifying when the invoice was voided', async () => {
      mockInvoiceRepo.applyPayment.mockResolvedValue(null);
      mockInvoiceRepo.findById.mockResolvedValue({
        ...baseInvoice,
        status: 'VOID',
      });

      await expect(
        service.applyStripePaymentSuccess({
          invoiceId: 'inv-1',
          chapterId: 'ch-1',
          paymentIntentId: 'pi_1',
          chargeId: null,
        }),
      ).resolves.toBeUndefined();

      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('should swallow notification failures', async () => {
      mockInvoiceRepo.applyPayment.mockResolvedValue(paidInvoice);
      mockNotificationService.notifyUser.mockRejectedValue(
        new Error('push provider down'),
      );

      await expect(
        service.applyStripePaymentSuccess({
          invoiceId: 'inv-1',
          chapterId: 'ch-1',
          paymentIntentId: 'pi_1',
          chargeId: 'ch_charge_1',
        }),
      ).resolves.toBeUndefined();
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
      mockInvoiceRepo.findById.mockResolvedValue(baseInvoice);
      mockTransactionRepo.findByInvoice.mockResolvedValue([]);
      const result = await service.getInvoiceTransactions('inv-1', 'ch-1');
      expect(mockInvoiceRepo.findById).toHaveBeenCalledWith('inv-1', 'ch-1');
      expect(result).toEqual([]);
    });

    it('should throw if invoice does not belong to chapter', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(null);
      await expect(
        service.getInvoiceTransactions('inv-1', 'ch-other'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOverdue', () => {
    it('should return overdue invoices from repository', async () => {
      const overdueInvoice: FinancialInvoice = {
        ...baseInvoice,
        id: 'inv-overdue',
        status: 'OPEN',
        due_date: '2026-01-01',
      };
      mockInvoiceRepo.findOverdue.mockResolvedValue([overdueInvoice]);

      const result = await service.findOverdue('ch-1');

      expect(mockInvoiceRepo.findOverdue).toHaveBeenCalledWith('ch-1');
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('OPEN');
    });

    it('should exclude PAID and VOID invoices (handled by repository)', async () => {
      mockInvoiceRepo.findOverdue.mockResolvedValue([]);

      const result = await service.findOverdue('ch-1');

      expect(result).toEqual([]);
    });
  });

  describe('notifications', () => {
    it('should notify user when invoice transitions from DRAFT to OPEN', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(baseInvoice);
      mockInvoiceRepo.update.mockResolvedValue({
        ...baseInvoice,
        status: 'OPEN',
      });

      await service.transitionStatus('inv-1', 'ch-1', 'OPEN');

      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
        expect.objectContaining({
          title: 'New Invoice',
          priority: 'NORMAL',
          category: 'billing',
        }),
      );
    });

    it('should not notify on non DRAFT→OPEN transitions', async () => {
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

      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
    });
  });
});
