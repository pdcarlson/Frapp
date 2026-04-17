import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from './permissions.guard';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;
  let mockFrom: jest.Mock;

  const mockHandler = jest.fn();
  const mockControllerClass = jest.fn();

  const mockExecutionContext = (member?: {
    role_ids: string[];
  }): ExecutionContext => {
    const request = { member };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => mockHandler,
      getClass: () => mockControllerClass,
    } as unknown as ExecutionContext;
  };

  const mockPermissionMetadata = (opts: {
    handlerRequire?: string[];
    classRequire?: string[];
    handlerAny?: string[];
    classAny?: string[];
  }) => {
    jest.spyOn(reflector, 'get').mockImplementation((key, target) => {
      if (key === PERMISSIONS_KEY) {
        if (target === mockHandler) return opts.handlerRequire;
        if (target === mockControllerClass) return opts.classRequire;
      }
      if (key === PERMISSIONS_ANY_KEY) {
        if (target === mockHandler) return opts.handlerAny;
        if (target === mockControllerClass) return opts.classAny;
      }
      return undefined;
    });
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
    mockPermissionMetadata({});
    const ctx = mockExecutionContext();
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('merges handler- and class-level @RequirePermissions (must satisfy all)', async () => {
    mockPermissionMetadata({
      handlerRequire: ['polls:view_all'],
      classRequire: ['members:view'],
    });
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({
          data: [{ permissions: ['polls:view_all'] }],
        }),
      }),
    });

    const ctx = mockExecutionContext({ role_ids: ['role-1'] });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows access when user has every merged @RequirePermissions', async () => {
    mockPermissionMetadata({
      handlerRequire: ['polls:view_all'],
      classRequire: ['members:view'],
    });
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({
          data: [{ permissions: ['polls:view_all', 'members:view'] }],
        }),
      }),
    });

    const ctx = mockExecutionContext({ role_ids: ['role-1'] });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('should throw ForbiddenException when member has no roles', async () => {
    mockPermissionMetadata({ handlerRequire: ['events:create'] });
    const ctx = mockExecutionContext({ role_ids: [] });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should allow access with wildcard permission', async () => {
    mockPermissionMetadata({ handlerRequire: ['events:create'] });
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
    mockPermissionMetadata({
      handlerRequire: ['events:create', 'events:update'],
    });
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
    mockPermissionMetadata({
      handlerRequire: ['events:create', 'billing:manage'],
    });
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
    mockPermissionMetadata({
      handlerRequire: ['events:create', 'billing:view', 'members:view'],
    });
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

  it('requires each @RequireAnyOfPermissions level when both handler and class set it', async () => {
    mockPermissionMetadata({
      classAny: ['roles:manage', 'billing:manage'],
      handlerAny: ['events:create', 'events:update'],
    });
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({
          data: [{ permissions: ['roles:manage', 'events:create'] }],
        }),
      }),
    });

    const ctx = mockExecutionContext({ role_ids: ['role-1'] });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('denies when only one of two any-of groups is satisfied', async () => {
    mockPermissionMetadata({
      classAny: ['roles:manage', 'billing:manage'],
      handlerAny: ['events:create', 'events:update'],
    });
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({
          data: [{ permissions: ['roles:manage'] }],
        }),
      }),
    });

    const ctx = mockExecutionContext({ role_ids: ['role-1'] });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
