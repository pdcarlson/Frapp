/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard';
import { RbacService } from '../../application/services/rbac.service';
import { UserService } from '../../application/services/user.service';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;
  let rbacService: {
    getPermissionsForUser: jest.Mock;
  };
  let userService: {
    findByClerkId: jest.Mock;
  };

  beforeEach(async () => {
    const mockRbacService = {
      getPermissionsForUser: jest.fn(),
    };
    const mockUserService = {
      findByClerkId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        {
          provide: Reflector,
          useValue: {
            getAllAndOverride: jest.fn(),
          },
        },
        {
          provide: RbacService,
          useValue: mockRbacService,
        },
        {
          provide: UserService,
          useValue: mockUserService,
        },
      ],
    }).compile();

    guard = module.get<PermissionsGuard>(PermissionsGuard);
    reflector = module.get<Reflector>(Reflector);
    rbacService = mockRbacService;
    userService = mockUserService;
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('should return true if no permissions are required', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([]);
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as any;

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should allow access if user has all required permissions', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['p1', 'p2']);
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { sub: 'clerk_1' },
          headers: { 'x-chapter-id': 'c1' },
          internalUserId: 'u1',
        }),
      }),
    } as any;

    rbacService.getPermissionsForUser.mockResolvedValue(
      new Set(['p1', 'p2', 'p3']),
    );

    const result = await guard.canActivate(context);
    expect(result).toBe(true);
  });

  it('should throw ForbiddenException if user lacks required permissions', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['p1', 'p2']);
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { sub: 'clerk_1' },
          headers: { 'x-chapter-id': 'c1' },
          internalUserId: 'u1',
        }),
      }),
    } as any;

    rbacService.getPermissionsForUser.mockResolvedValue(new Set(['p1']));

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should use UserService if internalUserId is missing from request', async () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(['p1']);
    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { sub: 'clerk_1' },
          headers: { 'x-chapter-id': 'c1' },
          // internalUserId is missing
        }),
      }),
    } as any;

    userService.findByClerkId.mockResolvedValue({ id: 'u1' });
    rbacService.getPermissionsForUser.mockResolvedValue(new Set(['p1']));

    const result = await guard.canActivate(context);
    expect(userService.findByClerkId).toHaveBeenCalledWith('clerk_1');
    expect(result).toBe(true);
  });
});
