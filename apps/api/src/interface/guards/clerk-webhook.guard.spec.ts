import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ClerkWebhookGuard } from './clerk-webhook.guard';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Webhook } from 'svix';

jest.mock('svix');

describe('ClerkWebhookGuard', () => {
  let guard: ClerkWebhookGuard;

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
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should allow access with valid svix headers and signature', () => {
      const mockRequest = {
        headers: {
          'svix-id': 'id_123',
          'svix-timestamp': '123456789',
          'svix-signature': 'v1,signature',
        },
        body: { type: 'test' },
      };
      (
        mockExecutionContext.switchToHttp().getRequest as jest.Mock
      ).mockReturnValue(mockRequest);

      const verifySpy = jest.fn();
      (Webhook as jest.Mock).mockImplementation(() => ({
        verify: verifySpy,
      }));

      const result = guard.canActivate(mockExecutionContext);
      expect(result).toBe(true);
      expect(verifySpy).toHaveBeenCalledWith(JSON.stringify(mockRequest.body), {
        'svix-id': 'id_123',
        'svix-timestamp': '123456789',
        'svix-signature': 'v1,signature',
      });
    });

    it('should deny access if headers are missing', () => {
      const mockRequest = {
        headers: {},
        body: {},
      };
      (
        mockExecutionContext.switchToHttp().getRequest as jest.Mock
      ).mockReturnValue(mockRequest);

      expect(() => guard.canActivate(mockExecutionContext)).toThrow(
        UnauthorizedException,
      );
    });

    it('should deny access if signature is invalid', () => {
      const mockRequest = {
        headers: {
          'svix-id': 'id_123',
          'svix-timestamp': '123456789',
          'svix-signature': 'v1,invalid',
        },
        body: { type: 'test' },
      };
      (
        mockExecutionContext.switchToHttp().getRequest as jest.Mock
      ).mockReturnValue(mockRequest);

      (Webhook as jest.Mock).mockImplementation(() => ({
        verify: jest.fn(() => {
          throw new Error('Invalid signature');
        }),
      }));

      expect(() => guard.canActivate(mockExecutionContext)).toThrow(
        UnauthorizedException,
      );
    });

    it('should throw Error if secret is not configured', () => {
      const mockRequest = {
        headers: {
          'svix-id': 'id_123',
          'svix-timestamp': '123456789',
          'svix-signature': 'v1,signature',
        },
        body: { type: 'test' },
      };
      (
        mockExecutionContext.switchToHttp().getRequest as jest.Mock
      ).mockReturnValue(mockRequest);

      // Re-setup guard with missing secret
      const configServiceMock = {
        get: jest.fn().mockReturnValue(null),
      };
      const guardWithNoSecret = new ClerkWebhookGuard(configServiceMock as any);

      expect(() => guardWithNoSecret.canActivate(mockExecutionContext)).toThrow(
        'Webhook secret not configured',
      );
    });
  });
});
