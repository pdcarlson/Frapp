import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { BILLING_PROVIDER } from '../../domain/adapters/billing.interface';
import type {
  IBillingProvider,
  WebhookEvent,
} from '../../domain/adapters/billing.interface';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '../../domain/repositories/chapter.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import type { Chapter } from '../../domain/entities/chapter.entity';
import { NotificationService } from './notification.service';
import { FinancialInvoiceService } from './financial-invoice.service';

describe('BillingService', () => {
  it('should initialize successfully', () => {
    expect(service).toBeDefined();
  });

  let service: BillingService;
  let mockBillingProvider: jest.Mocked<IBillingProvider>;
  let mockChapterRepo: jest.Mocked<IChapterRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockRoleRepo: jest.Mocked<IRoleRepository>;
  let mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  >;
  let mockFinancialInvoiceService: jest.Mocked<
    Pick<FinancialInvoiceService, 'applyStripePaymentSuccess'>
  >;

  const baseChapter: Chapter = {
    id: 'ch-1',
    name: 'Alpha Chapter',
    university: 'State University',
    stripe_customer_id: 'cus_123',
    subscription_status: 'incomplete',
    subscription_id: null,
    past_due_since: null,
    last_stripe_webhook_at: null,
    accent_color: '#2563EB',
    logo_path: null,
    donation_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  // checkout.session.completed carries the chapter id in Stripe metadata and
  // feeds it straight to a uuid-typed column, so the handler drops anything
  // that is not a UUID — checkout fixtures must be real UUIDs to reach it.
  // (The subscription and invoice.paid handlers resolve the chapter by
  // subscription id instead, so their fixtures are unaffected.)
  const CHECKOUT_CHAPTER_ID = '44444444-4444-4444-8444-444444444444';
  const MISSING_CHAPTER_ID = '55555555-5555-4555-8555-555555555555';
  const checkoutChapter: Chapter = { ...baseChapter, id: CHECKOUT_CHAPTER_ID };

  beforeEach(async () => {
    mockBillingProvider = {
      createCustomer: jest.fn(),
      createCheckoutSession: jest.fn(),
      createCustomerPortalSession: jest.fn(),
      getSubscriptionStatus: jest.fn(),
      cancelSubscription: jest.fn(),
      createPaymentIntent: jest.fn(),
      getPaymentIntent: jest.fn(),
      cancelPaymentIntent: jest.fn(),
      constructWebhookEvent: jest.fn(),
    };

    mockChapterRepo = {
      findById: jest.fn(),
      findByStripeCustomerId: jest.fn(),
      findBySubscriptionId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUser: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      transferPresidencyAtomic: jest.fn(),
    };

    mockRoleRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByIds: jest.fn(),
      findByChapterAndName: jest.fn(),
      findByChapterAndSystemKey: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    mockFinancialInvoiceService = {
      applyStripePaymentSuccess: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: BILLING_PROVIDER, useValue: mockBillingProvider },
        { provide: CHAPTER_REPOSITORY, useValue: mockChapterRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
        { provide: NotificationService, useValue: mockNotificationService },
        {
          provide: FinancialInvoiceService,
          useValue: mockFinancialInvoiceService,
        },
      ],
    }).compile();

    service = module.get(BillingService);
  });

  describe('getChapterBillingStatus', () => {
    it('should return billing status for an existing chapter', async () => {
      mockChapterRepo.findById.mockResolvedValue(baseChapter);

      const result = await service.getChapterBillingStatus('ch-1');

      expect(mockChapterRepo.findById).toHaveBeenCalledWith('ch-1');
      expect(result).toEqual({
        subscription_status: 'incomplete',
        stripe_customer_id: 'cus_123',
        subscription_id: null,
      });
    });

    it('should throw NotFoundException when chapter does not exist', async () => {
      mockChapterRepo.findById.mockResolvedValue(null);

      await expect(
        service.getChapterBillingStatus('ch-missing'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('createCheckoutSession', () => {
    it('should create a checkout session for an incomplete chapter', async () => {
      mockChapterRepo.findById.mockResolvedValue(baseChapter);
      mockBillingProvider.createCheckoutSession.mockResolvedValue(
        'https://checkout.stripe.com/session123',
      );

      const result = await service.createCheckoutSession({
        chapterId: 'ch-1',
        customerEmail: 'admin@example.com',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      });

      expect(result).toBe('https://checkout.stripe.com/session123');
      expect(mockBillingProvider.createCheckoutSession).toHaveBeenCalledWith({
        chapterId: 'ch-1',
        customerEmail: 'admin@example.com',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      });
    });

    it('should create a Stripe customer if chapter has none', async () => {
      const chapterNoCustomer = {
        ...baseChapter,
        stripe_customer_id: null,
      };
      mockChapterRepo.findById.mockResolvedValue(chapterNoCustomer);
      mockBillingProvider.createCustomer.mockResolvedValue('cus_new');
      mockChapterRepo.update.mockResolvedValue({
        ...chapterNoCustomer,
        stripe_customer_id: 'cus_new',
      });
      mockBillingProvider.createCheckoutSession.mockResolvedValue(
        'https://checkout.stripe.com/session456',
      );

      await service.createCheckoutSession({
        chapterId: 'ch-1',
        customerEmail: 'admin@example.com',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      });

      expect(mockBillingProvider.createCustomer).toHaveBeenCalledWith(
        'admin@example.com',
        'Alpha Chapter',
      );
      expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
        stripe_customer_id: 'cus_new',
      });
    });

    it('should reject checkout for already-active chapters', async () => {
      const activeChapter = {
        ...baseChapter,
        subscription_status: 'active' as const,
      };
      mockChapterRepo.findById.mockResolvedValue(activeChapter);

      await expect(
        service.createCheckoutSession({
          chapterId: 'ch-1',
          customerEmail: 'admin@example.com',
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException for non-existent chapter', async () => {
      mockChapterRepo.findById.mockResolvedValue(null);

      await expect(
        service.createCheckoutSession({
          chapterId: 'ch-missing',
          customerEmail: 'admin@example.com',
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ServiceUnavailableException on Stripe failure', async () => {
      mockChapterRepo.findById.mockResolvedValue(baseChapter);
      mockBillingProvider.createCheckoutSession.mockRejectedValue(
        new Error('Stripe is down'),
      );

      await expect(
        service.createCheckoutSession({
          chapterId: 'ch-1',
          customerEmail: 'admin@example.com',
          successUrl: 'http://localhost:3000/success',
          cancelUrl: 'http://localhost:3000/cancel',
        }),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  it('should throw ServiceUnavailableException with non-Error object on Stripe failure', async () => {
    mockChapterRepo.findById.mockResolvedValue(baseChapter);
    const stripeError = 'Some string error';
    mockBillingProvider.createCheckoutSession.mockRejectedValue(stripeError);
    const loggerErrorSpy = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => {});

    await expect(
      service.createCheckoutSession({
        chapterId: 'ch-1',
        customerEmail: 'admin@example.com',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      }),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to create checkout session for chapter ch-1',
      stripeError,
    );

    loggerErrorSpy.mockRestore();
  });

  describe('createPortalSession', () => {
    it('should throw NotFoundException for non-existent chapter', async () => {
      mockChapterRepo.findById.mockResolvedValue(null);

      await expect(
        service.createPortalSession({
          chapterId: 'ch-missing',
          returnUrl: 'http://localhost:3000/billing',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create a portal session for a chapter with billing', async () => {
      mockChapterRepo.findById.mockResolvedValue(baseChapter);
      mockBillingProvider.createCustomerPortalSession.mockResolvedValue(
        'https://billing.stripe.com/portal123',
      );

      const result = await service.createPortalSession({
        chapterId: 'ch-1',
        returnUrl: 'http://localhost:3000/billing',
      });

      expect(result).toBe('https://billing.stripe.com/portal123');
      expect(
        mockBillingProvider.createCustomerPortalSession,
      ).toHaveBeenCalledWith({
        customerId: 'cus_123',
        returnUrl: 'http://localhost:3000/billing',
      });
    });

    it('should reject portal creation when chapter has no Stripe customer', async () => {
      const chapterNoCustomer = {
        ...baseChapter,
        stripe_customer_id: null,
      };
      mockChapterRepo.findById.mockResolvedValue(chapterNoCustomer);

      await expect(
        service.createPortalSession({
          chapterId: 'ch-1',
          returnUrl: 'http://localhost:3000/billing',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw ServiceUnavailableException on Stripe failure', async () => {
      mockChapterRepo.findById.mockResolvedValue(baseChapter);
      const stripeError = new Error('Stripe is down');
      mockBillingProvider.createCustomerPortalSession.mockRejectedValue(
        stripeError,
      );
      const loggerErrorSpy = jest
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => {});

      await expect(
        service.createPortalSession({
          chapterId: 'ch-1',
          returnUrl: 'http://localhost:3000/billing',
        }),
      ).rejects.toThrow(ServiceUnavailableException);

      expect(loggerErrorSpy).toHaveBeenCalledWith(
        'Failed to create portal session for chapter ch-1',
        stripeError.stack,
      );

      loggerErrorSpy.mockRestore();
    });
  });

  it('should throw ServiceUnavailableException with non-Error object on Stripe failure for portal session', async () => {
    mockChapterRepo.findById.mockResolvedValue(baseChapter);
    const stripeError = 'Some string error';
    mockBillingProvider.createCustomerPortalSession.mockRejectedValue(
      stripeError,
    );
    const loggerErrorSpy = jest
      .spyOn(service['logger'], 'error')
      .mockImplementation(() => {});

    await expect(
      service.createPortalSession({
        chapterId: 'ch-1',
        returnUrl: 'http://localhost:3000/billing',
      }),
    ).rejects.toThrow(ServiceUnavailableException);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to create portal session for chapter ch-1',
      stripeError,
    );

    loggerErrorSpy.mockRestore();
  });

  describe('handleWebhookEvent', () => {
    it('should fall back to unpaid if unknown status is received', async () => {
      const result = service['mapStripeStatus']('some_weird_status');
      expect(result).toBeNull();
    });

    it('should fall back to unpaid if incomplete status is received', async () => {
      const event = {
        id: 'evt_sub_incomplete',
        type: 'customer.subscription.updated',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
            status: 'incomplete',
          },
        },
      };

      const chapter = {
        ...baseChapter,
        subscription_status: 'active' as const,
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(chapter);
      mockChapterRepo.update.mockResolvedValue({
        ...chapter,
        subscription_status: 'incomplete',
      });

      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
        subscription_status: 'incomplete',
        past_due_since: null,
        last_stripe_webhook_at: new Date(event.created * 1000).toISOString(),
      });
    });

    it('should map incomplete_expired to canceled', async () => {
      const event = {
        id: 'evt_sub_incomplete_expired',
        type: 'customer.subscription.updated',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
            status: 'incomplete_expired',
          },
        },
      };

      const chapter = {
        ...baseChapter,
        subscription_status: 'active' as const,
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(chapter);
      mockChapterRepo.update.mockResolvedValue({
        ...chapter,
        subscription_status: 'canceled',
      });

      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
        subscription_status: 'canceled',
        past_due_since: null,
        last_stripe_webhook_at: new Date(event.created * 1000).toISOString(),
      });
    });

    it('should map unpaid to past_due', async () => {
      const event = {
        id: 'evt_sub_unpaid',
        type: 'customer.subscription.updated',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
            status: 'unpaid',
          },
        },
      };

      const chapter = {
        ...baseChapter,
        subscription_status: 'active' as const,
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(chapter);
      mockChapterRepo.update.mockResolvedValue({
        ...chapter,
        subscription_status: 'past_due',
      });

      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({
          subscription_status: 'past_due',
          past_due_since: expect.any(String),
          last_stripe_webhook_at: expect.any(String),
        }),
      );
    });

    it('should ignore notification if president member is not found', async () => {
      const event = {
        id: 'evt_no_pres_member',
        type: 'customer.subscription.deleted',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
          },
        },
      };

      const activeChapter = {
        ...baseChapter,
        subscription_status: 'active' as const,
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(activeChapter);
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue({
        id: 'role-pres',
        chapter_id: 'ch-1',
        name: 'President',
        permissions: [],
        is_system: true,
        display_order: 0,
        color: null,
        created_at: '2024-01-01',
      });
      mockMemberRepo.findByChapter.mockResolvedValue([]);

      await service.handleWebhookEvent(event);
      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('should ignore notification if president role is not found', async () => {
      const event = {
        id: 'evt_no_pres_role',
        type: 'customer.subscription.deleted',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
          },
        },
      };

      const activeChapter = {
        ...baseChapter,
        subscription_status: 'active' as const,
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(activeChapter);
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(null);

      await service.handleWebhookEvent(event);
      expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
    });

    it('should ignore customer.subscription.deleted for non-existent chapter', async () => {
      const event = {
        id: 'evt_sub_del_no_chap',
        type: 'customer.subscription.deleted',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
          },
        },
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(null);
      await service.handleWebhookEvent(event);
      expect(mockChapterRepo.update).not.toHaveBeenCalled();
    });

    it('should ignore invoice.paid for missing subscription', async () => {
      const event = {
        id: 'evt_inv_no_sub',
        type: 'invoice.paid',
        created: Date.now(),
        data: {
          object: {},
        },
      };
      await service.handleWebhookEvent(event);
      expect(mockChapterRepo.update).not.toHaveBeenCalled();
    });

    it('should ignore invoice.paid for non-existent chapter', async () => {
      const event = {
        id: 'evt_inv_no_chap',
        type: 'invoice.paid',
        created: Date.now(),
        data: {
          object: {
            subscription: 'sub_123',
          },
        },
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(null);
      await service.handleWebhookEvent(event);
      expect(mockChapterRepo.update).not.toHaveBeenCalled();
    });

    it('should fall back to chapter properties if session properties are null', async () => {
      const event = {
        id: 'evt_null_properties',
        type: 'checkout.session.completed',
        created: Date.now(),
        data: {
          object: {
            metadata: { chapter_id: CHECKOUT_CHAPTER_ID },
            subscription: null,
            customer: null,
          },
        },
      };

      const chapter = {
        ...checkoutChapter,
        subscription_id: 'sub_existing',
        stripe_customer_id: 'cus_existing',
      };
      mockChapterRepo.findById.mockResolvedValue(chapter);
      mockChapterRepo.update.mockResolvedValue(chapter);

      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).toHaveBeenCalledWith(CHECKOUT_CHAPTER_ID, {
        subscription_status: 'active',
        subscription_id: 'sub_existing',
        stripe_customer_id: 'cus_existing',
        last_stripe_webhook_at: new Date(event.created * 1000).toISOString(),
      });
    });

    it('should ignore notification error', async () => {
      const event = {
        id: 'evt_sub_del_notify_err',
        type: 'customer.subscription.deleted',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
          },
        },
      };

      const activeChapter = {
        ...baseChapter,
        subscription_status: 'active' as const,
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(activeChapter);
      mockChapterRepo.update.mockResolvedValue({
        ...activeChapter,
        subscription_status: 'canceled',
      });
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue({
        id: 'role-pres',
        chapter_id: 'ch-1',
        name: 'President',
        permissions: [],
        is_system: true,
        display_order: 0,
        color: null,
        created_at: '2024-01-01',
      });
      mockMemberRepo.findByChapter.mockResolvedValue([
        {
          id: 'member-pres',
          user_id: 'user-pres',
          chapter_id: 'ch-1',
          role_ids: ['role-pres'],
          custom_role_ids: [],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ]);
      mockNotificationService.notifyUser.mockRejectedValue(
        new Error('Notification failed'),
      );

      const loggerWarnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => {});

      await service.handleWebhookEvent(event);

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Failed to notify president for chapter ch-1',
      );

      loggerWarnSpy.mockRestore();
    });

    it('should ignore checkout.session.completed for non-existent chapter', async () => {
      const event = {
        id: 'evt_no_chapter_exist',
        type: 'checkout.session.completed',
        created: Date.now(),
        data: {
          object: {
            metadata: { chapter_id: MISSING_CHAPTER_ID },
            subscription: 'sub_123',
          },
        },
      };
      mockChapterRepo.findById.mockResolvedValue(null);
      await service.handleWebhookEvent(event);
      // A well-formed id that simply isn't ours: the lookup still runs, unlike
      // the non-UUID guard below which returns before touching the repository.
      expect(mockChapterRepo.findById).toHaveBeenCalledWith(MISSING_CHAPTER_ID);
      expect(mockChapterRepo.update).not.toHaveBeenCalled();
    });

    it('should ignore a checkout session whose chapter_id is not a UUID', async () => {
      const loggerWarnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => {});

      // Another integration on the same Stripe account can attach arbitrary
      // metadata; forwarding it into the uuid-typed chapter lookup would
      // 22P02 → 500 → Stripe retries the event for days.
      await expect(
        service.handleWebhookEvent({
          id: 'evt_checkout_non_uuid',
          type: 'checkout.session.completed',
          created: Date.now(),
          data: {
            object: {
              metadata: { chapter_id: 'ch-1' },
              subscription: 'sub_123',
              customer: 'cus_123',
            },
          },
        }),
      ).resolves.not.toThrow();

      expect(mockChapterRepo.findById).not.toHaveBeenCalled();
      expect(mockChapterRepo.update).not.toHaveBeenCalled();
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('non-UUID chapter_id'),
      );

      loggerWarnSpy.mockRestore();
    });

    it('should ignore customer.subscription.updated missing subscription id', async () => {
      const event = {
        id: 'evt_sub_missing_id',
        type: 'customer.subscription.updated',
        created: Date.now(),
        data: {
          object: {
            status: 'active',
          },
        },
      };
      await service.handleWebhookEvent(event);
      expect(mockChapterRepo.update).not.toHaveBeenCalled();
    });

    it('should ignore customer.subscription.updated missing subscription status', async () => {
      const event = {
        id: 'evt_sub_missing_status',
        type: 'customer.subscription.updated',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
          },
        },
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(baseChapter);
      await service.handleWebhookEvent(event);
      expect(mockChapterRepo.update).not.toHaveBeenCalled();
    });

    it('should ignore customer.subscription.updated with unknown Stripe status', async () => {
      const event = {
        id: 'evt_sub_unknown_status',
        type: 'customer.subscription.updated',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
            status: 'unknown_status',
          },
        },
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(baseChapter);
      await service.handleWebhookEvent(event);
      expect(mockChapterRepo.update).not.toHaveBeenCalled();
    });

    it('should ignore customer.subscription.deleted missing subscription id', async () => {
      const event = {
        id: 'evt_sub_del_missing_id',
        type: 'customer.subscription.deleted',
        created: Date.now(),
        data: {
          object: {},
        },
      };
      await service.handleWebhookEvent(event);
      expect(mockChapterRepo.update).not.toHaveBeenCalled();
    });

    it('should activate chapter on checkout.session.completed', async () => {
      const event: WebhookEvent = {
        id: 'evt_1',
        type: 'checkout.session.completed',
        created: Date.now(),
        data: {
          object: {
            metadata: { chapter_id: CHECKOUT_CHAPTER_ID },
            subscription: 'sub_123',
            customer: 'cus_123',
          },
        },
      };

      mockChapterRepo.findById.mockResolvedValue(checkoutChapter);
      mockChapterRepo.update.mockResolvedValue({
        ...checkoutChapter,
        subscription_status: 'active',
        subscription_id: 'sub_123',
      });

      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).toHaveBeenCalledWith(CHECKOUT_CHAPTER_ID, {
        subscription_status: 'active',
        subscription_id: 'sub_123',
        stripe_customer_id: 'cus_123',
        last_stripe_webhook_at: new Date(event.created * 1000).toISOString(),
      });
    });

    it('should skip duplicate events (idempotency)', async () => {
      const event: WebhookEvent = {
        id: 'evt_dup',
        type: 'checkout.session.completed',
        created: Date.now(),
        data: {
          object: {
            metadata: { chapter_id: CHECKOUT_CHAPTER_ID },
            subscription: 'sub_123',
            customer: 'cus_123',
          },
        },
      };

      mockChapterRepo.findById.mockResolvedValue(checkoutChapter);
      mockChapterRepo.update.mockResolvedValue({
        ...checkoutChapter,
        subscription_status: 'active',
      });

      await service.handleWebhookEvent(event);
      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).toHaveBeenCalledTimes(1);
    });

    it('should handle checkout with missing chapter_id gracefully', async () => {
      const event: WebhookEvent = {
        id: 'evt_no_chapter',
        type: 'checkout.session.completed',
        created: Date.now(),
        data: {
          object: {
            metadata: {},
            subscription: 'sub_123',
          },
        },
      };

      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).not.toHaveBeenCalled();
    });

    it('should update subscription status on customer.subscription.updated', async () => {
      const event: WebhookEvent = {
        id: 'evt_sub_update',
        type: 'customer.subscription.updated',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
            status: 'past_due',
          },
        },
      };

      const activeChapter = {
        ...baseChapter,
        subscription_status: 'active' as const,
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(activeChapter);
      mockChapterRepo.update.mockResolvedValue({
        ...activeChapter,
        subscription_status: 'past_due',
      });

      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({
          subscription_status: 'past_due',
          past_due_since: expect.any(String),
          last_stripe_webhook_at: expect.any(String),
        }),
      );
    });

    it('should cancel chapter on customer.subscription.deleted', async () => {
      const event: WebhookEvent = {
        id: 'evt_sub_delete',
        type: 'customer.subscription.deleted',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
          },
        },
      };

      const activeChapter = {
        ...baseChapter,
        subscription_status: 'active' as const,
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(activeChapter);
      mockChapterRepo.update.mockResolvedValue({
        ...activeChapter,
        subscription_status: 'canceled',
      });

      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
        subscription_status: 'canceled',
        past_due_since: null,
        last_stripe_webhook_at: new Date(event.created * 1000).toISOString(),
      });
    });

    it('should reactivate past_due chapter on invoice.paid', async () => {
      const event: WebhookEvent = {
        id: 'evt_invoice_paid',
        type: 'invoice.paid',
        created: Date.now(),
        data: {
          object: {
            subscription: 'sub_123',
          },
        },
      };

      const pastDueChapter = {
        ...baseChapter,
        subscription_status: 'past_due' as const,
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(pastDueChapter);
      mockChapterRepo.update.mockResolvedValue({
        ...pastDueChapter,
        subscription_status: 'active',
      });

      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
        subscription_status: 'active',
        past_due_since: null,
        last_stripe_webhook_at: new Date(event.created * 1000).toISOString(),
      });
    });

    it('advances the mark without changing status on invoice.paid for an active chapter', async () => {
      const event: WebhookEvent = {
        id: 'evt_invoice_paid_active',
        type: 'invoice.paid',
        created: Date.now(),
        data: {
          object: {
            subscription: 'sub_123',
          },
        },
      };

      const activeChapter = {
        ...baseChapter,
        subscription_status: 'active' as const,
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(activeChapter);
      mockChapterRepo.update.mockResolvedValue(activeChapter);

      await service.handleWebhookEvent(event);

      // FRA-242: a renewal payment advances the ordering mark but leaves status.
      expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
        last_stripe_webhook_at: new Date(event.created * 1000).toISOString(),
      });
    });

    describe('past_due grace clock (FRA-109)', () => {
      // Stripe event.created is Unix *seconds*; the grace clock anchors to it.
      const CREATED_SECONDS = Math.floor(
        Date.parse('2026-06-02T12:00:00.000Z') / 1000,
      );
      const pastDueEvent = (id: string): WebhookEvent => ({
        id,
        type: 'customer.subscription.updated',
        created: CREATED_SECONDS,
        data: { object: { id: 'sub_123', status: 'past_due' } },
      });

      it('stamps past_due_since from event.created on the active -> past_due transition', async () => {
        const activeChapter = {
          ...baseChapter,
          subscription_status: 'active' as const,
          subscription_id: 'sub_123',
        };
        mockChapterRepo.findBySubscriptionId.mockResolvedValue(activeChapter);
        mockChapterRepo.update.mockResolvedValue(activeChapter);

        await service.handleWebhookEvent(pastDueEvent('evt_pd_stamp'));

        expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
          subscription_status: 'past_due',
          // Anchored to event.created (seconds), not processing time.
          past_due_since: new Date(CREATED_SECONDS * 1000).toISOString(),
          last_stripe_webhook_at: new Date(
            CREATED_SECONDS * 1000,
          ).toISOString(),
        });
      });

      it('does not reset past_due_since on a repeated past_due event', async () => {
        const pastDueChapter = {
          ...baseChapter,
          subscription_status: 'past_due' as const,
          subscription_id: 'sub_123',
          past_due_since: '2026-05-30T12:00:00.000Z',
        };
        mockChapterRepo.findBySubscriptionId.mockResolvedValue(pastDueChapter);
        mockChapterRepo.update.mockResolvedValue(pastDueChapter);

        await service.handleWebhookEvent(pastDueEvent('evt_pd_repeat'));

        // No past_due_since key in the payload -> the grace clock is untouched,
        // but the ordering high-water mark still advances (FRA-242).
        expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
          subscription_status: 'past_due',
          last_stripe_webhook_at: new Date(
            CREATED_SECONDS * 1000,
          ).toISOString(),
        });
      });

      it('clears past_due_since when recovering to active via subscription.updated', async () => {
        const event: WebhookEvent = {
          id: 'evt_pd_recover',
          type: 'customer.subscription.updated',
          created: Date.now(),
          data: { object: { id: 'sub_123', status: 'active' } },
        };
        const pastDueChapter = {
          ...baseChapter,
          subscription_status: 'past_due' as const,
          subscription_id: 'sub_123',
          past_due_since: '2026-05-30T12:00:00.000Z',
        };
        mockChapterRepo.findBySubscriptionId.mockResolvedValue(pastDueChapter);
        mockChapterRepo.update.mockResolvedValue(pastDueChapter);

        await service.handleWebhookEvent(event);

        expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
          subscription_status: 'active',
          past_due_since: null,
          last_stripe_webhook_at: new Date(event.created * 1000).toISOString(),
        });
      });
    });

    describe('timestamp-aware webhook ordering (FRA-242)', () => {
      // Stripe event.created is Unix *seconds*; T_OLD precedes T_NEW.
      const T_OLD = Math.floor(Date.parse('2026-06-01T12:00:00.000Z') / 1000);
      const T_NEW = Math.floor(Date.parse('2026-06-02T12:00:00.000Z') / 1000);
      const OLD_ISO = new Date(T_OLD * 1000).toISOString();
      const NEW_ISO = new Date(T_NEW * 1000).toISOString();

      const subUpdated = (status: string, created: number): WebhookEvent => ({
        id: `evt_upd_${status}_${created}`,
        type: 'customer.subscription.updated',
        created,
        data: { object: { id: 'sub_123', status } },
      });

      const presidentRole = {
        id: 'role-pres',
        chapter_id: 'ch-1',
        name: 'President',
        permissions: [],
        is_system: true,
        display_order: 0,
        color: null,
        created_at: '2024-01-01',
      };
      const presidentMember = {
        id: 'member-pres',
        user_id: 'user-pres',
        chapter_id: 'ch-1',
        role_ids: ['role-pres'],
        custom_role_ids: [],
        has_completed_onboarding: true,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      it('ignores a customer.subscription.updated older than the high-water mark', async () => {
        const chapter = {
          ...baseChapter,
          subscription_status: 'active' as const,
          subscription_id: 'sub_123',
          last_stripe_webhook_at: NEW_ISO,
        };
        mockChapterRepo.findBySubscriptionId.mockResolvedValue(chapter);

        await service.handleWebhookEvent(subUpdated('canceled', T_OLD));

        expect(mockChapterRepo.update).not.toHaveBeenCalled();
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('applies a newer customer.subscription.updated and advances the mark', async () => {
        const chapter = {
          ...baseChapter,
          subscription_status: 'active' as const,
          subscription_id: 'sub_123',
          last_stripe_webhook_at: OLD_ISO,
        };
        mockChapterRepo.findBySubscriptionId.mockResolvedValue(chapter);
        mockChapterRepo.update.mockResolvedValue(chapter);
        mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(presidentRole);
        mockMemberRepo.findByChapter.mockResolvedValue([presidentMember]);

        await service.handleWebhookEvent(subUpdated('past_due', T_NEW));

        expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
          subscription_status: 'past_due',
          past_due_since: NEW_ISO,
          last_stripe_webhook_at: NEW_ISO,
        });
        expect(mockNotificationService.notifyUser).toHaveBeenCalledTimes(1);
      });

      it('applies the first subscription webhook when no mark is set yet', async () => {
        const chapter = {
          ...baseChapter,
          subscription_status: 'active' as const,
          subscription_id: 'sub_123',
          last_stripe_webhook_at: null,
        };
        mockChapterRepo.findBySubscriptionId.mockResolvedValue(chapter);
        mockChapterRepo.update.mockResolvedValue(chapter);

        await service.handleWebhookEvent(subUpdated('canceled', T_NEW));

        expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
          subscription_status: 'canceled',
          past_due_since: null,
          last_stripe_webhook_at: NEW_ISO,
        });
      });

      it('advances the mark but does not notify when status is unchanged (AC #4)', async () => {
        const chapter = {
          ...baseChapter,
          subscription_status: 'past_due' as const,
          subscription_id: 'sub_123',
          past_due_since: OLD_ISO,
          last_stripe_webhook_at: OLD_ISO,
        };
        mockChapterRepo.findBySubscriptionId.mockResolvedValue(chapter);
        mockChapterRepo.update.mockResolvedValue(chapter);
        // Mock a reachable president so the no-notify assertion below actually
        // exercises the statusChanged gate (not just a missing-role early return).
        mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(presidentRole);
        mockMemberRepo.findByChapter.mockResolvedValue([presidentMember]);

        await service.handleWebhookEvent(subUpdated('past_due', T_NEW));

        // Still past_due: the grace clock is untouched and the president is not
        // re-notified — only the ordering mark moves forward.
        expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
          subscription_status: 'past_due',
          last_stripe_webhook_at: NEW_ISO,
        });
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('ignores a customer.subscription.deleted older than the high-water mark', async () => {
        const chapter = {
          ...baseChapter,
          subscription_status: 'active' as const,
          subscription_id: 'sub_123',
          last_stripe_webhook_at: NEW_ISO,
        };
        mockChapterRepo.findBySubscriptionId.mockResolvedValue(chapter);

        await service.handleWebhookEvent({
          id: 'evt_del_stale',
          type: 'customer.subscription.deleted',
          created: T_OLD,
          data: { object: { id: 'sub_123' } },
        });

        expect(mockChapterRepo.update).not.toHaveBeenCalled();
        expect(mockNotificationService.notifyUser).not.toHaveBeenCalled();
      });

      it('ignores a stale invoice.paid so it cannot reactivate a newer state', async () => {
        const chapter = {
          ...baseChapter,
          subscription_status: 'past_due' as const,
          subscription_id: 'sub_123',
          last_stripe_webhook_at: NEW_ISO,
        };
        mockChapterRepo.findBySubscriptionId.mockResolvedValue(chapter);

        await service.handleWebhookEvent({
          id: 'evt_inv_stale',
          type: 'invoice.paid',
          created: T_OLD,
          data: { object: { subscription: 'sub_123' } },
        });

        expect(mockChapterRepo.update).not.toHaveBeenCalled();
      });

      it('advances the high-water mark on checkout.session.completed', async () => {
        const chapter = { ...checkoutChapter, last_stripe_webhook_at: null };
        mockChapterRepo.findById.mockResolvedValue(chapter);
        mockChapterRepo.update.mockResolvedValue(chapter);

        await service.handleWebhookEvent({
          id: 'evt_checkout_mark',
          type: 'checkout.session.completed',
          created: T_NEW,
          data: {
            object: {
              metadata: { chapter_id: CHECKOUT_CHAPTER_ID },
              subscription: 'sub_123',
              customer: 'cus_123',
            },
          },
        });

        expect(mockChapterRepo.update).toHaveBeenCalledWith(
          CHECKOUT_CHAPTER_ID,
          {
            subscription_status: 'active',
            subscription_id: 'sub_123',
            stripe_customer_id: 'cus_123',
            last_stripe_webhook_at: NEW_ISO,
          },
        );
      });

      it('ignores a checkout.session.completed older than the high-water mark', async () => {
        const chapter = {
          ...checkoutChapter,
          subscription_status: 'past_due' as const,
          subscription_id: 'sub_123',
          last_stripe_webhook_at: NEW_ISO,
        };
        mockChapterRepo.findById.mockResolvedValue(chapter);

        await service.handleWebhookEvent({
          id: 'evt_checkout_stale',
          type: 'checkout.session.completed',
          created: T_OLD,
          data: {
            object: {
              metadata: { chapter_id: CHECKOUT_CHAPTER_ID },
              subscription: 'sub_123',
              customer: 'cus_123',
            },
          },
        });

        // A redelivered/late checkout must not re-activate a chapter Stripe has
        // since moved past — the drop path of the checkout guard.
        expect(mockChapterRepo.update).not.toHaveBeenCalled();
      });

      it('drops a later-delivered, earlier-created dunning event after a renewal advanced the mark', async () => {
        const activeChapter = {
          ...baseChapter,
          subscription_status: 'active' as const,
          subscription_id: 'sub_123',
          last_stripe_webhook_at: null,
        };
        // The renewal payment advances the mark to T_NEW; the next lookup sees it.
        const afterRenewal = {
          ...activeChapter,
          last_stripe_webhook_at: NEW_ISO,
        };
        mockChapterRepo.findBySubscriptionId
          .mockResolvedValueOnce(activeChapter)
          .mockResolvedValueOnce(afterRenewal);
        mockChapterRepo.update.mockResolvedValue(activeChapter);

        // 1) renewal invoice.paid at T_NEW advances the mark without changing status.
        await service.handleWebhookEvent({
          id: 'evt_inv_renewal',
          type: 'invoice.paid',
          created: T_NEW,
          data: { object: { subscription: 'sub_123' } },
        });
        expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
          last_stripe_webhook_at: NEW_ISO,
        });

        // 2) a past_due event CREATED before the payment but delivered after it
        //    must be dropped — this is the guarantee the renewal mark-advance buys.
        mockChapterRepo.update.mockClear();
        await service.handleWebhookEvent(subUpdated('past_due', T_OLD));
        expect(mockChapterRepo.update).not.toHaveBeenCalled();
      });
    });

    describe('payment_intent.succeeded dispatch (FRA-15)', () => {
      // The RPC params are uuid-typed, so the dispatcher only forwards metadata
      // that actually parses as a UUID — fixtures must be real UUIDs.
      const INVOICE_ID = '11111111-1111-4111-8111-111111111111';
      const CHAPTER_ID = '22222222-2222-4222-8222-222222222222';

      const paymentIntentEvent = (
        id: string,
        object: Record<string, unknown>,
      ): WebhookEvent => ({
        id,
        type: 'payment_intent.succeeded',
        created: Date.now(),
        data: { object },
      });

      it('applies the member payment with a string latest_charge', async () => {
        await service.handleWebhookEvent(
          paymentIntentEvent('evt_pi_string_charge', {
            id: 'pi_1',
            metadata: { invoice_id: INVOICE_ID, chapter_id: CHAPTER_ID },
            latest_charge: 'ch_123',
          }),
        );

        expect(
          mockFinancialInvoiceService.applyStripePaymentSuccess,
        ).toHaveBeenCalledWith({
          invoiceId: INVOICE_ID,
          chapterId: CHAPTER_ID,
          paymentIntentId: 'pi_1',
          chargeId: 'ch_123',
        });
      });

      it('normalizes an expanded latest_charge object to its id', async () => {
        await service.handleWebhookEvent(
          paymentIntentEvent('evt_pi_object_charge', {
            id: 'pi_1',
            metadata: { invoice_id: INVOICE_ID, chapter_id: CHAPTER_ID },
            latest_charge: { id: 'ch_456' },
          }),
        );

        expect(
          mockFinancialInvoiceService.applyStripePaymentSuccess,
        ).toHaveBeenCalledWith({
          invoiceId: INVOICE_ID,
          chapterId: CHAPTER_ID,
          paymentIntentId: 'pi_1',
          chargeId: 'ch_456',
        });
      });

      it('passes a null chargeId when latest_charge is null or absent', async () => {
        await service.handleWebhookEvent(
          paymentIntentEvent('evt_pi_null_charge', {
            id: 'pi_1',
            metadata: { invoice_id: INVOICE_ID, chapter_id: CHAPTER_ID },
            latest_charge: null,
          }),
        );
        await service.handleWebhookEvent(
          paymentIntentEvent('evt_pi_absent_charge', {
            id: 'pi_1',
            metadata: { invoice_id: INVOICE_ID, chapter_id: CHAPTER_ID },
          }),
        );

        expect(
          mockFinancialInvoiceService.applyStripePaymentSuccess,
        ).toHaveBeenCalledTimes(2);
        expect(
          mockFinancialInvoiceService.applyStripePaymentSuccess,
        ).toHaveBeenNthCalledWith(1, {
          invoiceId: INVOICE_ID,
          chapterId: CHAPTER_ID,
          paymentIntentId: 'pi_1',
          chargeId: null,
        });
        expect(
          mockFinancialInvoiceService.applyStripePaymentSuccess,
        ).toHaveBeenNthCalledWith(2, {
          invoiceId: INVOICE_ID,
          chapterId: CHAPTER_ID,
          paymentIntentId: 'pi_1',
          chargeId: null,
        });
      });

      it('ignores an intent missing invoice_id metadata without throwing', async () => {
        await expect(
          service.handleWebhookEvent(
            paymentIntentEvent('evt_pi_no_invoice_id', {
              id: 'pi_1',
              metadata: { chapter_id: CHAPTER_ID },
              latest_charge: 'ch_123',
            }),
          ),
        ).resolves.not.toThrow();

        expect(
          mockFinancialInvoiceService.applyStripePaymentSuccess,
        ).not.toHaveBeenCalled();
      });

      it('ignores an intent missing chapter_id metadata without throwing', async () => {
        await expect(
          service.handleWebhookEvent(
            paymentIntentEvent('evt_pi_no_chapter_id', {
              id: 'pi_1',
              metadata: { invoice_id: INVOICE_ID },
              latest_charge: 'ch_123',
            }),
          ),
        ).resolves.not.toThrow();

        expect(
          mockFinancialInvoiceService.applyStripePaymentSuccess,
        ).not.toHaveBeenCalled();
      });

      it('ignores a foreign intent whose invoice_id is not a UUID', async () => {
        const loggerWarnSpy = jest
          .spyOn(service['logger'], 'warn')
          .mockImplementation(() => {});

        // Another integration on the same Stripe account can carry arbitrary
        // metadata; forwarding it into the uuid-typed RPC would 22P02 → 500 →
        // Stripe retries for days.
        await expect(
          service.handleWebhookEvent(
            paymentIntentEvent('evt_pi_non_uuid_invoice', {
              id: 'pi_foreign',
              metadata: { invoice_id: 'inv-1', chapter_id: CHAPTER_ID },
              latest_charge: 'ch_123',
            }),
          ),
        ).resolves.not.toThrow();

        expect(
          mockFinancialInvoiceService.applyStripePaymentSuccess,
        ).not.toHaveBeenCalled();
        expect(loggerWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('non-UUID invoice metadata'),
        );

        loggerWarnSpy.mockRestore();
      });

      it('ignores a foreign intent whose chapter_id is not a UUID', async () => {
        const loggerWarnSpy = jest
          .spyOn(service['logger'], 'warn')
          .mockImplementation(() => {});

        await expect(
          service.handleWebhookEvent(
            paymentIntentEvent('evt_pi_non_uuid_chapter', {
              id: 'pi_foreign',
              metadata: { invoice_id: INVOICE_ID, chapter_id: 'ch-1' },
              latest_charge: 'ch_123',
            }),
          ),
        ).resolves.not.toThrow();

        expect(
          mockFinancialInvoiceService.applyStripePaymentSuccess,
        ).not.toHaveBeenCalled();
        expect(loggerWarnSpy).toHaveBeenCalled();

        loggerWarnSpy.mockRestore();
      });

      it('skips a duplicate delivery of the same event id (idempotency)', async () => {
        const event = paymentIntentEvent('evt_pi_dup', {
          id: 'pi_1',
          metadata: { invoice_id: INVOICE_ID, chapter_id: CHAPTER_ID },
          latest_charge: 'ch_123',
        });

        await service.handleWebhookEvent(event);
        await service.handleWebhookEvent(event);

        expect(
          mockFinancialInvoiceService.applyStripePaymentSuccess,
        ).toHaveBeenCalledTimes(1);
      });
    });

    it('should handle unknown event types gracefully', async () => {
      const event: WebhookEvent = {
        id: 'evt_unknown',
        type: 'charge.refunded',
        created: Date.now(),
        data: { object: {} },
      };

      await expect(service.handleWebhookEvent(event)).resolves.not.toThrow();
    });

    it('should handle subscription update for unknown subscription gracefully', async () => {
      const event: WebhookEvent = {
        id: 'evt_orphan_sub',
        type: 'customer.subscription.updated',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_orphan',
            status: 'active',
          },
        },
      };

      mockChapterRepo.findBySubscriptionId.mockResolvedValue(null);

      await expect(service.handleWebhookEvent(event)).resolves.not.toThrow();
      expect(mockChapterRepo.update).not.toHaveBeenCalled();
    });

    it('should notify chapter president on subscription status change', async () => {
      const event: WebhookEvent = {
        id: 'evt_sub_update_notify',
        type: 'customer.subscription.updated',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
            status: 'past_due',
          },
        },
      };

      const activeChapter = {
        ...baseChapter,
        subscription_status: 'active' as const,
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(activeChapter);
      mockChapterRepo.update.mockResolvedValue({
        ...activeChapter,
        subscription_status: 'past_due',
      });
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue({
        id: 'role-pres',
        chapter_id: 'ch-1',
        name: 'President',
        permissions: [],
        is_system: true,
        display_order: 0,
        color: null,
        created_at: '2024-01-01',
      });
      mockMemberRepo.findByChapter.mockResolvedValue([
        {
          id: 'member-pres',
          user_id: 'user-pres',
          chapter_id: 'ch-1',
          role_ids: ['role-pres'],
          custom_role_ids: [],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ]);

      await service.handleWebhookEvent(event);

      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-pres',
        'ch-1',
        expect.objectContaining({
          title: 'Subscription Status Changed',
          priority: 'URGENT',
          category: 'billing',
        }),
      );
    });

    it('should handle errors when notifying chapter president', async () => {
      const event: WebhookEvent = {
        id: 'evt_sub_update_notify_error',
        type: 'customer.subscription.updated',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
            status: 'past_due',
          },
        },
      };

      const activeChapter = {
        ...baseChapter,
        subscription_status: 'active' as const,
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(activeChapter);
      mockChapterRepo.update.mockResolvedValue({
        ...activeChapter,
        subscription_status: 'past_due',
      });
      mockRoleRepo.findByChapterAndSystemKey.mockRejectedValue(
        new Error('Database error'),
      );

      const loggerWarnSpy = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => {});

      await service.handleWebhookEvent(event);

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Failed to notify president for chapter ch-1',
      );

      loggerWarnSpy.mockRestore();
    });

    it('should notify chapter president on subscription deletion', async () => {
      const event: WebhookEvent = {
        id: 'evt_sub_delete_notify',
        type: 'customer.subscription.deleted',
        created: Date.now(),
        data: {
          object: {
            id: 'sub_123',
          },
        },
      };

      const activeChapter = {
        ...baseChapter,
        subscription_status: 'active' as const,
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(activeChapter);
      mockChapterRepo.update.mockResolvedValue({
        ...activeChapter,
        subscription_status: 'canceled',
      });
      mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue({
        id: 'role-pres',
        chapter_id: 'ch-1',
        name: 'President',
        permissions: [],
        is_system: true,
        display_order: 0,
        color: null,
        created_at: '2024-01-01',
      });
      mockMemberRepo.findByChapter.mockResolvedValue([
        {
          id: 'member-pres',
          user_id: 'user-pres',
          chapter_id: 'ch-1',
          role_ids: ['role-pres'],
          custom_role_ids: [],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ]);

      await service.handleWebhookEvent(event);

      expect(mockNotificationService.notifyUser).toHaveBeenCalledWith(
        'user-pres',
        'ch-1',
        expect.objectContaining({
          title: 'Subscription Status Changed',
          priority: 'URGENT',
          category: 'billing',
        }),
      );
    });
  });
});
