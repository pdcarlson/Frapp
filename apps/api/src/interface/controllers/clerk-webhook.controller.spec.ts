/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { ClerkWebhookController } from './clerk-webhook.controller';
import { ClerkWebhookGuard } from '../guards/clerk-webhook.guard';
import { ConfigService } from '@nestjs/config';
import { UserSyncService } from '../../application/services/user-sync.service';

describe('ClerkWebhookController', () => {
  let controller: ClerkWebhookController;
  let userSyncService: jest.Mocked<UserSyncService>;

  const mockGuard = {
    canActivate: jest.fn(() => true),
  };

  const mockUserSyncService = {
    handleUserCreated: jest.fn(),
    handleUserUpdated: jest.fn(),
    handleUserDeleted: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClerkWebhookController],
      providers: [
        {
          provide: ConfigService,
          useValue: { get: jest.fn() },
        },
        {
          provide: UserSyncService,
          useValue: mockUserSyncService,
        },
      ],
    })
      .overrideGuard(ClerkWebhookGuard)
      .useValue(mockGuard)
      .compile();

    controller = module.get<ClerkWebhookController>(ClerkWebhookController);
    userSyncService = module.get(UserSyncService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('handleWebhook', () => {
    it('should call handleUserCreated for user.created event', async () => {
      const payload = {
        data: { id: 'user_123' },
        object: 'event',
        type: 'user.created',
      };
      const result = await controller.handleWebhook(payload);
      expect(result).toEqual({ received: true });
      expect(userSyncService.handleUserCreated).toHaveBeenCalledWith(
        payload.data,
      );
    });

    it('should call handleUserUpdated for user.updated event', async () => {
      const payload = {
        data: { id: 'user_123' },
        object: 'event',
        type: 'user.updated',
      };
      await controller.handleWebhook(payload);
      expect(userSyncService.handleUserUpdated).toHaveBeenCalledWith(
        payload.data,
      );
    });

    it('should call handleUserDeleted for user.deleted event', async () => {
      const payload = {
        data: { id: 'user_123' },
        object: 'event',
        type: 'user.deleted',
      };
      await controller.handleWebhook(payload);
      expect(userSyncService.handleUserDeleted).toHaveBeenCalledWith(
        payload.data,
      );
    });
  });
});
