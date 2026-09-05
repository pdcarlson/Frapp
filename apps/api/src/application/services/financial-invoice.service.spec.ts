import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FinancialInvoiceService } from './financial-invoice.service';
import { FINANCIAL_INVOICE_REPOSITORY } from '#domain/repositories/financial-invoice.repository.interface';
import type { IFinancialInvoiceRepository } from '#domain/repositories/financial-invoice.repository.interface';
import { FINANCIAL_TRANSACTION_REPOSITORY } from '#domain/repositories/financial-transaction.repository.interface';
import type { IFinancialTransactionRepository } from '#domain/repositories/financial-transaction.repository.interface';
import { BILLING_PROVIDER } from '#domain/adapters/billing.interface';
import type { IBillingProvider } from '#domain/adapters/billing.interface';
import type { FinancialInvoice } from '#domain/entities/financial-invoice.entity';
import { NotificationService } from './notification.service';
import { ChapterWorkflowsService } from './chapter-workflows.service';

describe('FinancialInvoiceService', () => {
  let service: FinancialInvoiceService;
  let mockInvoiceRepo: jest.Mocked<IFinancialInvoiceRepository>;
  let mockTransactionRepo: jest.Mocked<IFinancialTransactionRepository>;
  let mockBillingProvider: jest.Mocked<IBillingProvider>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;
  let mockChapterWorkflows: jest.Mocked<
    Pick<ChapterWorkflowsService, 'getDuesGraceDays'>
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
      setPaymentIntentIfOpen: jest.fn(),
    };

    mockTransactionRepo = {
      findByChapter: jest.fn(),
      findByInvoice: jest.fn().mockResolvedValue([]),
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
      cancelPaymentIntent: jest.fn().mockResolvedValue(undefined),
      constructWebhookEvent: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    mockChapterWorkflows = {
      getDuesGraceDays: jest.fn().mockResolvedValue(0),
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
        { provide: ChapterWorkflowsService, useValue: mockChapterWorkflows },
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

    it('should transition OPEN to PAID through the atomic applyPayment CAS', async () => {
      const openInvoice = { ...baseInvoice, status: 'OPEN' as const };
      const paidInvoice = {
        ...openInvoice,
        status: 'PAID' as const,
        paid_at: '2026-09-10T00:00:00.000Z',
      };
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockInvoiceRepo.applyPayment.mockResolvedValue(paidInvoice);

      const result = await service.transitionStatus('inv-1', 'ch-1', 'PAID');

      // AC3: a manual PAID transition carries no Stripe intent/charge id — the
      // nulls are what express that, and the RPC inserts the ledger row.
      expect(mockInvoiceRepo.applyPayment).toHaveBeenCalledWith(
        'inv-1',
        'ch-1',
        null,
        null,
      );
      expect(mockInvoiceRepo.update).not.toHaveBeenCalled();
      // The RPC writes the ledger row inside the same transaction; the service
      // must not double-insert it.
      expect(mockTransactionRepo.create).not.toHaveBeenCalled();
      expect(result.status).toBe('PAID');
    });

    it('should reject a manual PAID when the CAS misses (paid or voided concurrently)', async () => {
      const openInvoice = { ...baseInvoice, status: 'OPEN' as const };
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockInvoiceRepo.applyPayment.mockResolvedValue(null);

      await expect(
        service.transitionStatus('inv-1', 'ch-1', 'PAID'),
      ).rejects.toThrow(
        'Invoice is no longer OPEN — it was paid or voided concurrently',
      );
      await expect(
        service.transitionStatus('inv-1', 'ch-1', 'PAID'),
      ).rejects.toThrow(BadRequestException);

      expect(mockTransactionRepo.create).not.toHaveBeenCalled();
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

    it('should cancel the stored PaymentIntent when voiding an OPEN invoice', async () => {
      const openInvoice = {
        ...baseInvoice,
        status: 'OPEN' as const,
        stripe_payment_intent_id: 'pi_outstanding',
      };
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockInvoiceRepo.update.mockResolvedValue({
        ...openInvoice,
        status: 'VOID',
      });

      const result = await service.transitionStatus('inv-1', 'ch-1', 'VOID');

      // Without this the member's already-open payment sheet stays confirmable
      // and can capture real money against a voided invoice.
      expect(mockBillingProvider.cancelPaymentIntent).toHaveBeenCalledWith(
        'pi_outstanding',
      );
      expect(result.status).toBe('VOID');
    });

    it('should not call the provider when voiding an invoice with no stored intent', async () => {
      const openInvoice = {
        ...baseInvoice,
        status: 'OPEN' as const,
        stripe_payment_intent_id: null,
      };
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockInvoiceRepo.update.mockResolvedValue({
        ...openInvoice,
        status: 'VOID',
      });

      await service.transitionStatus('inv-1', 'ch-1', 'VOID');

      expect(mockBillingProvider.cancelPaymentIntent).not.toHaveBeenCalled();
    });

    it('should still void when cancelling the PaymentIntent throws', async () => {
      const openInvoice = {
        ...baseInvoice,
        status: 'OPEN' as const,
        stripe_payment_intent_id: 'pi_outstanding',
      };
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockInvoiceRepo.update.mockResolvedValue({
        ...openInvoice,
        status: 'VOID',
      });
      mockBillingProvider.cancelPaymentIntent.mockRejectedValue(
        new Error('stripe is down'),
      );

      // Best effort: a provider outage must never block the admin's void.
      const result = await service.transitionStatus('inv-1', 'ch-1', 'VOID');

      expect(mockBillingProvider.cancelPaymentIntent).toHaveBeenCalledWith(
        'pi_outstanding',
      );
      expect(result.status).toBe('VOID');
    });

    it('should cancel the stored PaymentIntent when marking an OPEN invoice PAID by hand', async () => {
      const openInvoice = {
        ...baseInvoice,
        status: 'OPEN' as const,
        stripe_payment_intent_id: 'pi_outstanding',
      };
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockInvoiceRepo.applyPayment.mockResolvedValue({
        ...openInvoice,
        status: 'PAID',
        paid_at: '2026-09-10T00:00:00.000Z',
      });

      const result = await service.transitionStatus('inv-1', 'ch-1', 'PAID');

      // PAID is terminal too: the member may have a payment sheet already open
      // for this intent, and after the treasurer records a cash payment
      // confirming it would capture a second, duplicate charge.
      expect(mockBillingProvider.cancelPaymentIntent).toHaveBeenCalledWith(
        'pi_outstanding',
      );
      expect(result.status).toBe('PAID');
    });

    it('should still mark PAID when cancelling the PaymentIntent throws', async () => {
      const openInvoice = {
        ...baseInvoice,
        status: 'OPEN' as const,
        stripe_payment_intent_id: 'pi_outstanding',
      };
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockInvoiceRepo.applyPayment.mockResolvedValue({
        ...openInvoice,
        status: 'PAID',
        paid_at: '2026-09-10T00:00:00.000Z',
      });
      mockBillingProvider.cancelPaymentIntent.mockRejectedValue(
        new Error('stripe is down'),
      );

      // Best effort: the ledger row is already written, so a provider outage
      // must not turn a settled invoice into a 5xx.
      const result = await service.transitionStatus('inv-1', 'ch-1', 'PAID');

      expect(result.status).toBe('PAID');
    });

    it('should not call the provider on a manual PAID with no stored intent', async () => {
      const openInvoice = {
        ...baseInvoice,
        status: 'OPEN' as const,
        stripe_payment_intent_id: null,
      };
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockInvoiceRepo.applyPayment.mockResolvedValue({
        ...openInvoice,
        status: 'PAID',
        paid_at: '2026-09-10T00:00:00.000Z',
      });

      await service.transitionStatus('inv-1', 'ch-1', 'PAID');

      expect(mockBillingProvider.cancelPaymentIntent).not.toHaveBeenCalled();
    });

    it('should not cancel the stored intent when the manual PAID CAS misses', async () => {
      const openInvoice = {
        ...baseInvoice,
        status: 'OPEN' as const,
        stripe_payment_intent_id: 'pi_outstanding',
      };
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockInvoiceRepo.applyPayment.mockResolvedValue(null);

      await expect(
        service.transitionStatus('inv-1', 'ch-1', 'PAID'),
      ).rejects.toThrow(BadRequestException);

      // The transition never happened — killing a live intent here would strand
      // a member mid-payment on an invoice that is still OPEN.
      expect(mockBillingProvider.cancelPaymentIntent).not.toHaveBeenCalled();
    });

    it('should not cancel a stored intent when transitioning DRAFT to VOID', async () => {
      mockInvoiceRepo.findById.mockResolvedValue({
        ...baseInvoice,
        stripe_payment_intent_id: null,
      });
      mockInvoiceRepo.update.mockResolvedValue({
        ...baseInvoice,
        status: 'VOID',
      });

      await service.transitionStatus('inv-1', 'ch-1', 'VOID');

      expect(mockBillingProvider.cancelPaymentIntent).not.toHaveBeenCalled();
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
      mockInvoiceRepo.setPaymentIntentIfOpen.mockResolvedValue({
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
        // Two concurrent first attempts must collapse into ONE provider-side
        // intent rather than minting two separately chargeable ones.
        idempotencyKey: 'invoice-pay-inv-1-first',
      });
      // The stamp is conditional on the invoice still being OPEN — an
      // unconditional update could clobber a webhook-stamped id.
      expect(mockInvoiceRepo.setPaymentIntentIfOpen).toHaveBeenCalledWith(
        'inv-1',
        'ch-1',
        'pi_new_123',
      );
      expect(mockInvoiceRepo.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        client_secret: 'pi_new_123_secret',
        payment_intent_id: 'pi_new_123',
      });
    });

    it('should key the idempotency token on the stored intent id when re-minting', async () => {
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
      mockInvoiceRepo.setPaymentIntentIfOpen.mockResolvedValue({
        ...openInvoice,
        stripe_payment_intent_id: 'pi_fresh_2',
      });

      await service.createPaymentIntent('inv-1', 'ch-1', 'user-1');

      // Different stored id ⇒ different key, so the re-mint is not deduped
      // against the original (canceled) intent.
      expect(mockBillingProvider.createPaymentIntent).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'invoice-pay-inv-1-pi_canceled_1',
        }),
      );
    });

    it('should mint a fresh intent when the stored id no longer exists at the provider', async () => {
      mockInvoiceRepo.findById.mockResolvedValue({
        ...openInvoice,
        stripe_payment_intent_id: 'pi_gone_1',
      });
      // Null = resource_missing at the provider (key/account migration), which
      // is a "mint a fresh one" signal — not an outage.
      mockBillingProvider.getPaymentIntent.mockResolvedValue(null);
      mockBillingProvider.createPaymentIntent.mockResolvedValue({
        id: 'pi_fresh_3',
        status: 'requires_payment_method',
        clientSecret: 'pi_fresh_3_secret',
        latestChargeId: null,
      });
      mockInvoiceRepo.setPaymentIntentIfOpen.mockResolvedValue({
        ...openInvoice,
        stripe_payment_intent_id: 'pi_fresh_3',
      });

      const result = await service.createPaymentIntent(
        'inv-1',
        'ch-1',
        'user-1',
      );

      expect(mockBillingProvider.createPaymentIntent).toHaveBeenCalledTimes(1);
      expect(mockInvoiceRepo.setPaymentIntentIfOpen).toHaveBeenCalledWith(
        'inv-1',
        'ch-1',
        'pi_fresh_3',
      );
      expect(result).toEqual({
        client_secret: 'pi_fresh_3_secret',
        payment_intent_id: 'pi_fresh_3',
      });
    });

    it('should throw ConflictException when the conditional stamp misses and the invoice is now PAID', async () => {
      mockInvoiceRepo.findById
        .mockResolvedValueOnce(openInvoice)
        .mockResolvedValueOnce({
          ...openInvoice,
          status: 'PAID',
          paid_at: '2026-09-10T00:00:00.000Z',
        });
      mockBillingProvider.createPaymentIntent.mockResolvedValue({
        id: 'pi_new_123',
        status: 'requires_payment_method',
        clientSecret: 'pi_new_123_secret',
        latestChargeId: null,
      });
      // The webhook settled the invoice while the Stripe round-trip was in
      // flight, so the CAS refuses to stamp.
      mockInvoiceRepo.setPaymentIntentIfOpen.mockResolvedValue(null);

      await expect(
        service.createPaymentIntent('inv-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException when the conditional stamp misses and the invoice is now VOID', async () => {
      mockInvoiceRepo.findById
        .mockResolvedValueOnce(openInvoice)
        .mockResolvedValueOnce({ ...openInvoice, status: 'VOID' });
      mockBillingProvider.createPaymentIntent.mockResolvedValue({
        id: 'pi_new_123',
        status: 'requires_payment_method',
        clientSecret: 'pi_new_123_secret',
        latestChargeId: null,
      });
      mockInvoiceRepo.setPaymentIntentIfOpen.mockResolvedValue(null);

      await expect(
        service.createPaymentIntent('inv-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when the conditional stamp misses and the invoice vanished', async () => {
      mockInvoiceRepo.findById
        .mockResolvedValueOnce(openInvoice)
        .mockResolvedValueOnce(null);
      mockBillingProvider.createPaymentIntent.mockResolvedValue({
        id: 'pi_new_123',
        status: 'requires_payment_method',
        clientSecret: 'pi_new_123_secret',
        latestChargeId: null,
      });
      mockInvoiceRepo.setPaymentIntentIfOpen.mockResolvedValue(null);

      await expect(
        service.createPaymentIntent('inv-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
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
      mockInvoiceRepo.setPaymentIntentIfOpen.mockResolvedValue({
        ...openInvoice,
        stripe_payment_intent_id: 'pi_stored_1',
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
      // Reuse hands out a live client secret just like a fresh mint, so it must
      // run through the same still-OPEN re-check — the id it stamps is simply
      // the one already stored.
      expect(mockInvoiceRepo.setPaymentIntentIfOpen).toHaveBeenCalledWith(
        'inv-1',
        'ch-1',
        'pi_stored_1',
      );
      expect(mockInvoiceRepo.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        client_secret: 'pi_stored_1_secret',
        payment_intent_id: 'pi_stored_1',
      });
    });

    it('should throw ConflictException when reuse re-checks and the invoice is now PAID', async () => {
      mockInvoiceRepo.findById
        .mockResolvedValueOnce({
          ...openInvoice,
          stripe_payment_intent_id: 'pi_stored_1',
        })
        .mockResolvedValueOnce({
          ...openInvoice,
          status: 'PAID',
          paid_at: '2026-09-10T00:00:00.000Z',
          stripe_payment_intent_id: 'pi_stored_1',
        });
      mockBillingProvider.getPaymentIntent.mockResolvedValue({
        id: 'pi_stored_1',
        status: 'requires_payment_method',
        clientSecret: 'pi_stored_1_secret',
        latestChargeId: null,
      });
      // A cash payment settled the invoice while the retrieve round-tripped.
      mockInvoiceRepo.setPaymentIntentIfOpen.mockResolvedValue(null);

      await expect(
        service.createPaymentIntent('inv-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException when reuse re-checks and the invoice is now VOID', async () => {
      mockInvoiceRepo.findById
        .mockResolvedValueOnce({
          ...openInvoice,
          stripe_payment_intent_id: 'pi_stored_1',
        })
        .mockResolvedValueOnce({
          ...openInvoice,
          status: 'VOID',
          stripe_payment_intent_id: 'pi_stored_1',
        });
      mockBillingProvider.getPaymentIntent.mockResolvedValue({
        id: 'pi_stored_1',
        status: 'requires_payment_method',
        clientSecret: 'pi_stored_1_secret',
        latestChargeId: null,
      });
      mockInvoiceRepo.setPaymentIntentIfOpen.mockResolvedValue(null);

      // Handing back the stored secret here would let the member confirm a
      // payment against a voided invoice.
      await expect(
        service.createPaymentIntent('inv-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
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
      expect(mockInvoiceRepo.setPaymentIntentIfOpen).not.toHaveBeenCalled();
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
      mockInvoiceRepo.setPaymentIntentIfOpen.mockResolvedValue({
        ...openInvoice,
        stripe_payment_intent_id: 'pi_fresh_2',
      });

      const result = await service.createPaymentIntent(
        'inv-1',
        'ch-1',
        'user-1',
      );

      expect(mockBillingProvider.createPaymentIntent).toHaveBeenCalledTimes(1);
      expect(mockInvoiceRepo.setPaymentIntentIfOpen).toHaveBeenCalledWith(
        'inv-1',
        'ch-1',
        'pi_fresh_2',
      );
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
      const loggerErrorSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => {});

      await expect(
        service.createPaymentIntent('inv-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ServiceUnavailableException);

      // A genuine outage is the page-on-call case, so it keeps the ERROR log.
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Stripe PaymentIntent request failed'),
      );
      expect(mockInvoiceRepo.setPaymentIntentIfOpen).not.toHaveBeenCalled();

      loggerErrorSpy.mockRestore();
    });

    // Stripe answers a same-key request that is still in flight with an
    // idempotency conflict. Matched structurally (no Stripe SDK in the domain
    // layer), so a plain tagged Error is a faithful fixture.
    const idempotencyConflict = (type: string): Error =>
      Object.assign(
        new Error(
          'Keys for idempotent requests can only be used with the same parameters they were first used with.',
        ),
        { type },
      );

    it.each(['idempotency_error', 'StripeIdempotencyError'])(
      'should map a %s to ConflictException and log it as routine',
      async (type) => {
        mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
        mockBillingProvider.createPaymentIntent.mockRejectedValue(
          idempotencyConflict(type),
        );
        const loggerErrorSpy = jest
          .spyOn(service['logger'], 'error')
          .mockImplementation(() => {});
        const loggerLogSpy = jest
          .spyOn(service['logger'], 'log')
          .mockImplementation(() => {});

        const thrown: unknown = await service
          .createPaymentIntent('inv-1', 'ch-1', 'user-1')
          .then(() => null)
          .catch((error: unknown) => error);

        // The double-tap this key exists to collapse — a retryable 409, not the
        // 503 outage path, and not an ERROR that pages on-call.
        expect(thrown).toBeInstanceOf(ConflictException);
        expect((thrown as Error).message).toContain('already in progress');
        expect(loggerErrorSpy).not.toHaveBeenCalled();
        expect(loggerLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('another attempt is in flight'),
        );
        expect(mockInvoiceRepo.setPaymentIntentIfOpen).not.toHaveBeenCalled();

        loggerErrorSpy.mockRestore();
        loggerLogSpy.mockRestore();
      },
    );

    it('should still map a non-idempotency tagged provider error to 503', async () => {
      mockInvoiceRepo.findById.mockResolvedValue(openInvoice);
      mockBillingProvider.createPaymentIntent.mockRejectedValue(
        Object.assign(new Error('card service unavailable'), {
          type: 'api_error',
        }),
      );

      await expect(
        service.createPaymentIntent('inv-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ServiceUnavailableException);
    });

    it('should throw ServiceUnavailableException when retrieving the stored intent fails hard', async () => {
      mockInvoiceRepo.findById.mockResolvedValue({
        ...openInvoice,
        stripe_payment_intent_id: 'pi_stored_1',
      });
      mockBillingProvider.getPaymentIntent.mockRejectedValue(
        new Error('stripe is down'),
      );

      await expect(
        service.createPaymentIntent('inv-1', 'ch-1', 'user-1'),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(mockBillingProvider.createPaymentIntent).not.toHaveBeenCalled();
      expect(mockInvoiceRepo.setPaymentIntentIfOpen).not.toHaveBeenCalled();
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

    const ledgerRow = (chargeId: string | null) => ({
      id: 'txn-1',
      chapter_id: 'ch-1',
      invoice_id: 'inv-1',
      amount: 15000,
      type: 'PAYMENT' as const,
      stripe_charge_id: chargeId,
      created_at: '2026-09-10T00:00:00.000Z',
    });

    it('should silently no-op on duplicate delivery for an already PAID invoice', async () => {
      mockInvoiceRepo.applyPayment.mockResolvedValue(null);
      mockInvoiceRepo.findById.mockResolvedValue(paidInvoice);
      // True redelivery: this exact charge already has its ledger row.
      mockTransactionRepo.findByInvoice.mockResolvedValue([
        ledgerRow('ch_charge_1'),
      ]);
      const loggerWarnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => {});
      const loggerLogSpy = jest
        .spyOn(service['logger'], 'log')
        .mockImplementation(() => {});

      await expect(
        service.applyStripePaymentSuccess({
          invoiceId: 'inv-1',
          chapterId: 'ch-1',
          paymentIntentId: 'pi_1',
          chargeId: 'ch_charge_1',
        }),
      ).resolves.toBeUndefined();

      expect(mockTransactionRepo.findByInvoice).toHaveBeenCalledWith('inv-1');
      // Already ledgered ⇒ benign duplicate, not a reconciliation alarm.
      expect(loggerWarnSpy).not.toHaveBeenCalled();
      expect(loggerLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('duplicate delivery'),
      );
      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();

      loggerWarnSpy.mockRestore();
      loggerLogSpy.mockRestore();
    });

    it('should warn about an orphan charge when a second intent hits an already PAID invoice', async () => {
      mockInvoiceRepo.applyPayment.mockResolvedValue(null);
      mockInvoiceRepo.findById.mockResolvedValue(paidInvoice);
      // No ledger row carries this charge — real money moved with nothing
      // recorded against it.
      mockTransactionRepo.findByInvoice.mockResolvedValue([]);
      const loggerWarnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => {});

      await expect(
        service.applyStripePaymentSuccess({
          invoiceId: 'inv-1',
          chapterId: 'ch-1',
          paymentIntentId: 'pi_other',
          chargeId: 'ch_charge_other',
        }),
      ).resolves.toBeUndefined();

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('reconcile manually'),
      );
      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();

      loggerWarnSpy.mockRestore();
    });

    it('should warn as ambiguous on a charge-less miss, even from the settling intent', async () => {
      mockInvoiceRepo.applyPayment.mockResolvedValue(null);
      // Same intent that settled the invoice, and the event carries no
      // latest_charge (older API versions omit it). This LOOKS like an
      // ordinary redelivery, but a cash-marked PAID that raced a real card
      // capture is indistinguishable: the manual path writes a null-charge
      // ledger row and the RPC preserves the stored intent id. Money is
      // involved, so the ambiguity must be surfaced, not assumed benign.
      mockInvoiceRepo.findById.mockResolvedValue(paidInvoice);
      const loggerWarnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => {});
      const loggerLogSpy = jest
        .spyOn(service['logger'], 'log')
        .mockImplementation(() => {});

      await expect(
        service.applyStripePaymentSuccess({
          invoiceId: 'inv-1',
          chapterId: 'ch-1',
          paymentIntentId: 'pi_1',
          chargeId: null,
        }),
      ).resolves.toBeUndefined();

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('cannot be matched to the ledger'),
      );
      expect(loggerLogSpy).not.toHaveBeenCalled();
      // With no charge id there is nothing to match a ledger row against, so
      // the ledger scan is skipped entirely.
      expect(mockTransactionRepo.findByInvoice).not.toHaveBeenCalled();
      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();

      loggerWarnSpy.mockRestore();
      loggerLogSpy.mockRestore();
    });

    it('should warn on a charge-less success from an intent other than the one that settled the invoice', async () => {
      mockInvoiceRepo.applyPayment.mockResolvedValue(null);
      mockInvoiceRepo.findById.mockResolvedValue(paidInvoice); // settled by pi_1
      const loggerWarnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => {});

      await expect(
        service.applyStripePaymentSuccess({
          invoiceId: 'inv-1',
          chapterId: 'ch-1',
          paymentIntentId: 'pi_second',
          chargeId: null,
        }),
      ).resolves.toBeUndefined();

      // A different intent captured money against an invoice already settled by
      // pi_1 — an orphan charge with no ledger row, even without a charge id.
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('cannot be matched to the ledger'),
      );
      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();

      loggerWarnSpy.mockRestore();
    });

    it('should resolve without notifying when the invoice was voided', async () => {
      mockInvoiceRepo.applyPayment.mockResolvedValue(null);
      mockInvoiceRepo.findById.mockResolvedValue({
        ...baseInvoice,
        status: 'VOID',
      });
      mockTransactionRepo.findByInvoice.mockResolvedValue([]);
      const loggerWarnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => {});

      await expect(
        service.applyStripePaymentSuccess({
          invoiceId: 'inv-1',
          chapterId: 'ch-1',
          paymentIntentId: 'pi_1',
          chargeId: null,
        }),
      ).resolves.toBeUndefined();

      // A captured charge against a VOID invoice always needs a human.
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('VOID invoice inv-1'),
      );
      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();

      loggerWarnSpy.mockRestore();
    });

    it('should warn when the invoice is missing entirely on a CAS miss', async () => {
      mockInvoiceRepo.applyPayment.mockResolvedValue(null);
      mockInvoiceRepo.findById.mockResolvedValue(null);
      mockTransactionRepo.findByInvoice.mockResolvedValue([]);
      const loggerWarnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => {});

      await expect(
        service.applyStripePaymentSuccess({
          invoiceId: 'inv-1',
          chapterId: 'ch-1',
          paymentIntentId: 'pi_1',
          chargeId: 'ch_charge_1',
        }),
      ).resolves.toBeUndefined();

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing invoice inv-1'),
      );

      loggerWarnSpy.mockRestore();
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

      expect(mockInvoiceRepo.findOverdue).toHaveBeenCalledWith('ch-1', 0);
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('OPEN');
    });

    it('should pass the chapter dues grace period to the repository (wf_dues_grace enabled)', async () => {
      mockChapterWorkflows.getDuesGraceDays.mockResolvedValue(7);
      mockInvoiceRepo.findOverdue.mockResolvedValue([]);

      await service.findOverdue('ch-1');

      expect(mockChapterWorkflows.getDuesGraceDays).toHaveBeenCalledWith(
        'ch-1',
      );
      expect(mockInvoiceRepo.findOverdue).toHaveBeenCalledWith('ch-1', 7);
    });

    it('should apply no grace when wf_dues_grace is disabled', async () => {
      mockChapterWorkflows.getDuesGraceDays.mockResolvedValue(0);
      mockInvoiceRepo.findOverdue.mockResolvedValue([]);

      await service.findOverdue('ch-1');

      expect(mockInvoiceRepo.findOverdue).toHaveBeenCalledWith('ch-1', 0);
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
      mockInvoiceRepo.applyPayment.mockResolvedValue({
        ...openInvoice,
        status: 'PAID',
        paid_at: '2026-09-10T00:00:00.000Z',
      });

      await service.transitionStatus('inv-1', 'ch-1', 'PAID');

      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
    });
  });
});
