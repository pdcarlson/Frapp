/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingController } from './onboarding.controller';
import { ChapterOnboardingService } from '../../application/services/chapter-onboarding.service';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { RequestWithUser } from '../auth.types';

describe('OnboardingController', () => {
  let controller: OnboardingController;
  let onboardingService: jest.Mocked<ChapterOnboardingService>;

  const mockOnboardingService = {
    initiateOnboarding: jest.fn(),
  };

  const mockRequest = {
    user: {
      email: 'test@example.com',
      sub: 'user_123',
    },
  } as unknown as RequestWithUser;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OnboardingController],
      providers: [
        {
          provide: ChapterOnboardingService,
          useValue: mockOnboardingService,
        },
      ],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<OnboardingController>(OnboardingController);
    onboardingService = module.get(ChapterOnboardingService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('initiate', () => {
    it('should return checkout URL from service', async () => {
      const dto = { name: 'Sigma Chi', university: 'OSU' };
      onboardingService.initiateOnboarding.mockResolvedValue({
        checkoutUrl: 'https://stripe.com/pay',
      });

      const result = await controller.initiate(dto, mockRequest);

      expect(result).toEqual({ checkoutUrl: 'https://stripe.com/pay' });
      expect(onboardingService.initiateOnboarding).toHaveBeenCalledWith(
        dto,
        mockRequest.user.email,
      );
    });
  });
});
