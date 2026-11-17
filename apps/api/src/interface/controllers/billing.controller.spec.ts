import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { BillingController } from './billing.controller';
import { BillingService } from '../../application/services/billing.service';
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

    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [BillingController],
      providers: [{ provide: BillingService, useValue: billingService }],
    }).compile();

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
        success_url: 'http://localhost:3000/settings?checkout=success',
        cancel_url: 'http://localhost:3000/settings?checkout=cancelled',
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
        success_url: 'http://localhost:3000/settings?checkout=success',
        cancel_url: 'http://localhost:3000/settings?checkout=cancelled',
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
        return_url: 'http://localhost:3000/settings?checkout=returned',
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
        return_url: 'http://localhost:3000/settings?checkout=returned',
      };
      billingService.createPortalSession.mockRejectedValue(new Error('Failed'));

      await expect(controller.createPortal(chapterId, dto)).rejects.toThrow(
        'Failed',
      );
    });
  });

  // Stripe sends the treasurer to these addresses after paying or leaving
  // the portal, so they must be the dashboard's own.
  it('refuses return addresses outside the dashboard', async () => {
    await expect(
      controller.createCheckout('chapter-123', {
        customer_email: 'treasurer@school.edu',
        success_url: 'https://example.com/success',
        cancel_url: 'http://localhost:3000/settings',
      }),
    ).rejects.toThrow('success_url must be a Frapp dashboard address.');
    await expect(
      controller.createPortal('chapter-123', {
        return_url: 'https://localhost:3000.example.com/settings',
      }),
    ).rejects.toThrow('return_url must be a Frapp dashboard address.');
    expect(billingService.createCheckoutSession).not.toHaveBeenCalled();
    expect(billingService.createPortalSession).not.toHaveBeenCalled();
  });

  it('refuses an off-dashboard cancel_url even when success_url is valid', async () => {
    await expect(
      controller.createCheckout('chapter-123', {
        customer_email: 'treasurer@school.edu',
        success_url: 'http://localhost:3000/settings?checkout=success',
        cancel_url: 'https://example.com/cancelled',
      }),
    ).rejects.toThrow('cancel_url must be a Frapp dashboard address.');
    expect(billingService.createCheckoutSession).not.toHaveBeenCalled();
  });
});
