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

  const baseChapter: Chapter = {
    id: 'ch-1',
    name: 'Alpha Chapter',
    university: 'State University',
    stripe_customer_id: 'cus_123',
    subscription_status: 'incomplete',
    subscription_id: null,
    accent_color: '#2563EB',
    logo_path: null,
    donation_url: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    mockBillingProvider = {
      createCustomer: jest.fn(),
      createCheckoutSession: jest.fn(),
      createCustomerPortalSession: jest.fn(),
      getSubscriptionStatus: jest.fn(),
      cancelSubscription: jest.fn(),
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
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockRoleRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByIds: jest.fn(),
      findByChapterAndName: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockNotificationService = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyChapter: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: BILLING_PROVIDER, useValue: mockBillingProvider },
        { provide: CHAPTER_REPOSITORY, useValue: mockChapterRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
        { provide: NotificationService, useValue: mockNotificationService },
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

    it('should throw ServiceUnavailableException if creating Stripe customer fails', async () => {
      const chapterNoCustomer = {
        ...baseChapter,
        stripe_customer_id: null,
      };
      mockChapterRepo.findById.mockResolvedValue(chapterNoCustomer);
      const stripeError = new Error('Stripe is down');
      mockBillingProvider.createCustomer.mockRejectedValue(stripeError);
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
        stripeError.stack,
      );

      loggerErrorSpy.mockRestore();
    });

    it('should throw ServiceUnavailableException if updating chapter with new customer fails', async () => {
      const chapterNoCustomer = {
        ...baseChapter,
        stripe_customer_id: null,
      };
      mockChapterRepo.findById.mockResolvedValue(chapterNoCustomer);
      mockBillingProvider.createCustomer.mockResolvedValue('cus_new');
      const dbError = new Error('Database error');
      mockChapterRepo.update.mockRejectedValue(dbError);
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
        dbError.stack,
      );

      loggerErrorSpy.mockRestore();
    });

    it('should throw ServiceUnavailableException on Stripe failure', async () => {
      mockChapterRepo.findById.mockResolvedValue(baseChapter);
      const stripeError = new Error('Stripe is down');
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
        stripeError.stack,
      );

      loggerErrorSpy.mockRestore();
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
        subscription_status: 'active',
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
        subscription_status: 'active',
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
        subscription_status: 'active',
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(chapter);
      mockChapterRepo.update.mockResolvedValue({
        ...chapter,
        subscription_status: 'past_due',
      });

      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
        subscription_status: 'past_due',
      });
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
        subscription_status: 'active',
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(activeChapter);
      mockRoleRepo.findByChapterAndName.mockResolvedValue({
        id: 'role-pres',
        chapter_id: 'ch-1',
        name: 'President',
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
        subscription_status: 'active',
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(activeChapter);
      mockRoleRepo.findByChapterAndName.mockResolvedValue(null);

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
            metadata: { chapter_id: 'ch-1' },
            subscription: null,
            customer: null,
          },
        },
      };

      const chapter = {
        ...baseChapter,
        subscription_id: 'sub_existing',
        stripe_customer_id: 'cus_existing',
      };
      mockChapterRepo.findById.mockResolvedValue(chapter);
      mockChapterRepo.update.mockResolvedValue(chapter);

      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
        subscription_status: 'active',
        subscription_id: 'sub_existing',
        stripe_customer_id: 'cus_existing',
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
        subscription_status: 'active',
        subscription_id: 'sub_123',
      };
      mockChapterRepo.findBySubscriptionId.mockResolvedValue(activeChapter);
      mockChapterRepo.update.mockResolvedValue({
        ...activeChapter,
        subscription_status: 'canceled',
      });
      mockRoleRepo.findByChapterAndName.mockResolvedValue({
        id: 'role-pres',
        chapter_id: 'ch-1',
        name: 'President',
      });
      mockMemberRepo.findByChapter.mockResolvedValue([
        {
          id: 'member-pres',
          user_id: 'user-pres',
          chapter_id: 'ch-1',
          role_ids: ['role-pres'],
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
            metadata: { chapter_id: 'ch-missing' },
            subscription: 'sub_123',
          },
        },
      };
      mockChapterRepo.findById.mockResolvedValue(null);
      await service.handleWebhookEvent(event);
      expect(mockChapterRepo.update).not.toHaveBeenCalled();
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
            metadata: { chapter_id: 'ch-1' },
            subscription: 'sub_123',
            customer: 'cus_123',
          },
        },
      };

      mockChapterRepo.findById.mockResolvedValue(baseChapter);
      mockChapterRepo.update.mockResolvedValue({
        ...baseChapter,
        subscription_status: 'active',
        subscription_id: 'sub_123',
      });

      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
        subscription_status: 'active',
        subscription_id: 'sub_123',
        stripe_customer_id: 'cus_123',
      });
    });

    it('should skip duplicate events (idempotency)', async () => {
      const event: WebhookEvent = {
        id: 'evt_dup',
        type: 'checkout.session.completed',
        created: Date.now(),
        data: {
          object: {
            metadata: { chapter_id: 'ch-1' },
            subscription: 'sub_123',
            customer: 'cus_123',
          },
        },
      };

      mockChapterRepo.findById.mockResolvedValue(baseChapter);
      mockChapterRepo.update.mockResolvedValue({
        ...baseChapter,
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

      expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
        subscription_status: 'past_due',
      });
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
      });
    });

    it('should not update active chapter on invoice.paid', async () => {
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

      await service.handleWebhookEvent(event);

      expect(mockChapterRepo.update).not.toHaveBeenCalled();
    });

    it('should handle unknown event types gracefully', async () => {
      const event: WebhookEvent = {
        id: 'evt_unknown',
        type: 'payment_intent.succeeded',
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
      mockRoleRepo.findByChapterAndName.mockResolvedValue({
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
      mockRoleRepo.findByChapterAndName.mockResolvedValue({
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
