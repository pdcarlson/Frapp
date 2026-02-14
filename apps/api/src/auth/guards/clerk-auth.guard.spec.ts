import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { ClerkAuthGuard } from './clerk-auth.guard';
import { verifyToken } from '@clerk/backend';

// Mock verifyToken from @clerk/backend
jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
}));

describe('ClerkAuthGuard', () => {
  let guard: ClerkAuthGuard;
  let configService: ConfigService;

  const mockExecutionContext = {
    switchToHttp: jest.fn().mockReturnThis(),
    getRequest: jest.fn(),
  } as unknown as ExecutionContext;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClerkAuthGuard,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'CLERK_SECRET_KEY') return 'test_secret_key';
              if (key === 'CLERK_PUBLISHABLE_KEY') return 'test_publishable_key';
              return null;
            }),
          },
        },
      ],
    }).compile();

    guard = module.get<ClerkAuthGuard>(ClerkAuthGuard);
    configService = module.get<ConfigService>(ConfigService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  describe('canActivate', () => {
    it('should allow access with a valid token', async () => {
      const mockRequest = {
        headers: {
          authorization: 'Bearer valid_token',
        },
      };
      (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue(mockRequest);
      (verifyToken as jest.Mock).mockResolvedValue({ sub: 'user_123' });

      const result = await guard.canActivate(mockExecutionContext);
      expect(result).toBe(true);
      expect(verifyToken).toHaveBeenCalledWith('valid_token', expect.any(Object));
      // Verify request has user attached
      expect(mockRequest['user']).toEqual({ sub: 'user_123' });
    });

    it('should deny access if no authorization header is present', async () => {
      const mockRequest = {
        headers: {},
      };
      (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue(mockRequest);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });

    it('should deny access if authorization header is malformed', async () => {
      const mockRequest = {
        headers: {
          authorization: 'InvalidFormat',
        },
      };
      (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue(mockRequest);

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });

    it('should deny access if token is invalid', async () => {
      const mockRequest = {
        headers: {
          authorization: 'Bearer invalid_token',
        },
      };
      (mockExecutionContext.switchToHttp().getRequest as jest.Mock).mockReturnValue(mockRequest);
      (verifyToken as jest.Mock).mockRejectedValue(new Error('Invalid token'));

      await expect(guard.canActivate(mockExecutionContext)).rejects.toThrow(UnauthorizedException);
    });
  });
});
