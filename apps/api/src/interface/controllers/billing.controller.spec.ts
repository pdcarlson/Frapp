import { Test, TestingModule } from '@nestjs/testing';
import { BillingController } from './billing.controller';
import { BillingService } from '../../application/services/billing.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { CreateCheckoutDto, CreatePortalDto } from '../dtos/billing.dto';

describe('BillingController', () => {
  let controller: BillingController;
  let billingService: jest.Mocked<BillingService>;

  beforeEach(async () => {
    billingService = {
      getChapterBillingStatus: jest.fn(),
      createCheckoutSession: jest.fn(),
      createPortalSession: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillingController],
      providers: [{ provide: BillingService, useValue: billingService }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<BillingController>(BillingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getStatus', () => {
    it('should return billing status for a chapter', async () => {
      const chapterId = 'chapter-123';
      const mockStatus = {
        subscription_status: 'active',
        stripe_customer_id: 'cus_123',
        subscription_id: 'sub_123',
      } as any;
      billingService.getChapterBillingStatus.mockResolvedValue(mockStatus);

      const result = await controller.getStatus(chapterId);

      expect(billingService.getChapterBillingStatus).toHaveBeenCalledWith(
        chapterId,
      );
      expect(result).toBe(mockStatus);
    });

    it('should throw when billing service fails', async () => {
      const chapterId = 'chapter-123';
      billingService.getChapterBillingStatus.mockRejectedValue(
        new Error('Failed'),
      );

      await expect(controller.getStatus(chapterId)).rejects.toThrow('Failed');
    });
  });

  describe('createCheckout', () => {
    it('should create a checkout session and return the URL', async () => {
      const chapterId = 'chapter-123';
      const dto: CreateCheckoutDto = {
        customer_email: 'test@example.com',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      };
      const mockUrl = 'https://stripe.com/checkout/123';
      billingService.createCheckoutSession.mockResolvedValue(mockUrl);

      const result = await controller.createCheckout(chapterId, dto);

      expect(billingService.createCheckoutSession).toHaveBeenCalledWith({
        chapterId,
        customerEmail: dto.customer_email,
        successUrl: dto.success_url,
        cancelUrl: dto.cancel_url,
      });
      expect(result).toEqual({ url: mockUrl });
    });

    it('should throw when billing service fails', async () => {
      const chapterId = 'chapter-123';
      const dto: CreateCheckoutDto = {
        customer_email: 'test@example.com',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      };
      billingService.createCheckoutSession.mockRejectedValue(
        new Error('Failed'),
      );

      await expect(controller.createCheckout(chapterId, dto)).rejects.toThrow(
        'Failed',
      );
    });
  });

  describe('createPortal', () => {
    it('should create a portal session and return the URL', async () => {
      const chapterId = 'chapter-123';
      const dto: CreatePortalDto = {
        return_url: 'https://example.com/return',
      };
      const mockUrl = 'https://stripe.com/portal/123';
      billingService.createPortalSession.mockResolvedValue(mockUrl);

      const result = await controller.createPortal(chapterId, dto);

      expect(billingService.createPortalSession).toHaveBeenCalledWith({
        chapterId,
        returnUrl: dto.return_url,
      });
      expect(result).toEqual({ url: mockUrl });
    });

    it('should throw when billing service fails', async () => {
      const chapterId = 'chapter-123';
      const dto: CreatePortalDto = {
        return_url: 'https://example.com/return',
      };
      billingService.createPortalSession.mockRejectedValue(new Error('Failed'));

      await expect(controller.createPortal(chapterId, dto)).rejects.toThrow(
        'Failed',
      );
    });
  });
});
