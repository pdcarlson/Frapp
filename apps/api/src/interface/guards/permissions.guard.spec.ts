import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from './permissions.guard';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;
  let mockFrom: jest.Mock;

  const mockExecutionContext = (member?: { role_ids: string[] }): ExecutionContext => {
    const request = { member };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  };

  beforeEach(async () => {
    mockFrom = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        Reflector,
        {
          provide: SUPABASE_CLIENT,
          useValue: { from: mockFrom },
        },
      ],
    }).compile();

    guard = module.get(PermissionsGuard);
    reflector = module.get(Reflector);
  });

  it('should allow access when no permissions are required', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = mockExecutionContext();
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('should throw ForbiddenException when member has no roles', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['events:create']);
    const ctx = mockExecutionContext({ role_ids: [] });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should allow access with wildcard permission', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['events:create']);
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({
          data: [{ permissions: ['*'] }],
        }),
      }),
    });

    const ctx = mockExecutionContext({ role_ids: ['role-1'] });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('should allow access when user has all required permissions', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['events:create', 'events:update']);
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({
          data: [
            { permissions: ['events:create', 'members:view'] },
            { permissions: ['events:update'] },
          ],
        }),
      }),
    });

    const ctx = mockExecutionContext({ role_ids: ['role-1', 'role-2'] });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('should deny access when user is missing required permissions', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['events:create', 'billing:manage']);
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({
          data: [{ permissions: ['events:create'] }],
        }),
      }),
    });

    const ctx = mockExecutionContext({ role_ids: ['role-1'] });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should aggregate permissions from multiple roles', async () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue(['events:create', 'billing:view', 'members:view']);
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({
          data: [
            { permissions: ['events:create'] },
            { permissions: ['billing:view', 'members:view'] },
          ],
        }),
      }),
    });

    const ctx = mockExecutionContext({ role_ids: ['role-1', 'role-2'] });
    expect(await guard.canActivate(ctx)).toBe(true);
  });
});
