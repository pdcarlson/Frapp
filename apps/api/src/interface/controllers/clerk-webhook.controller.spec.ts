import { Test, TestingModule } from '@nestjs/testing';
import { ClerkWebhookController } from './clerk-webhook.controller';
import { ClerkWebhookGuard } from '../guards/clerk-webhook.guard';
import { ConfigService } from '@nestjs/config';

describe('ClerkWebhookController', () => {
  let controller: ClerkWebhookController;

  const mockGuard = {
    canActivate: jest.fn(() => true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClerkWebhookController],
      providers: [
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
      ],
    })
      .overrideGuard(ClerkWebhookGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<ClerkWebhookController>(ClerkWebhookController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleWebhook', () => {
    it('should return received: true', async () => {
      const payload = {
        data: { id: 'user_123' },
        object: 'event',
        type: 'user.created',
      };
      const result = await controller.handleWebhook(payload);
      expect(result).toEqual({ received: true });
    });
  });
});
