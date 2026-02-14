import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClerkWebhookGuard } from './clerk-webhook.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Webhook } from 'svix';

jest.mock('svix');

describe('ClerkWebhookGuard', () => {
  let guard: ClerkWebhookGuard;
  let configService: ConfigService;

  const mockExecutionContext = {
    switchToHttp: jest.fn().mockReturnThis(),
    getRequest: jest.fn(),
  } as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClerkWebhookGuard,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'CLERK_WEBHOOK_SECRET') return 'test_secret';
              return null;
            }),
          },
        },
      ],
    }).compile();

    guard = module.get<ClerkWebhookGuard>(ClerkWebhookGuard);
    configService = module.get<ConfigService>(ConfigService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should allow access with valid svix headers and signature', async () => {
      const mockRequest = {
        headers: {
          'svix-id': 'id_123',
          'svix-timestamp': '123456789',
          'svix-signature': 'v1,signature',
        },
        body: { type: 'test' },
      };
      (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue(mockRequest);
      
      const verifySpy = jest.fn();
      (Webhook as jest.Mock).mockImplementation(() => ({
        verify: verifySpy,
      }));

      const result = await guard.canActivate(mockExecutionContext);
      expect(result).toBe(true);
      expect(verifySpy).toHaveBeenCalledWith(JSON.stringify(mockRequest.body), {
        'svix-id': 'id_123',
        'svix-timestamp': '123456789',
        'svix-signature': 'v1,signature',
      });
    });

    it('should deny access if headers are missing', async () => {
      const mockRequest = {
        headers: {},
        body: {},
      };
      (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue(mockRequest);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });

    it('should deny access if signature is invalid', async () => {
      const mockRequest = {
        headers: {
          'svix-id': 'id_123',
          'svix-timestamp': '123456789',
          'svix-signature': 'v1,invalid',
        },
        body: { type: 'test' },
      };
      (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue(mockRequest);

      (Webhook as jest.Mock).mockImplementation(() => ({
        verify: jest.fn(() => {
          throw new Error('Invalid signature');
        }),
      }));

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });
  });
});
