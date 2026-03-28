import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserController } from './user.controller';
import { UserService } from '../../application/services/user.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';
import { RequestAvatarUploadUrlDto, UpdateUserDto } from '../dtos/user.dto';

function mergeRouteGuards(
  ControllerClass: typeof UserController,
  handler: (...args: unknown[]) => unknown,
): unknown[] {
  const classGuards = Reflect.getMetadata('__guards__', ControllerClass) ?? [];
  const methodGuards = Reflect.getMetadata('__guards__', handler) ?? [];
  return [...classGuards, ...methodGuards];
}

function effectiveRequirePermissions(
  reflector: Reflector,
  ControllerClass: typeof UserController,
  handler: (...args: unknown[]) => unknown,
): unknown {
  return (
    reflector.get(PERMISSIONS_KEY, handler) ??
    reflector.get(PERMISSIONS_KEY, ControllerClass)
  );
}

describe('UserController', () => {
  let controller: UserController;
  let userService: jest.Mocked<UserService>;
  let reflector: Reflector;

  beforeEach(async () => {
    userService = {
      findById: jest.fn(),
      update: jest.fn(),
      requestAvatarUploadUrl: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: userService },
        Reflector,
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideInterceptor(AuthSyncInterceptor)
      .useValue({ intercept: (context: any, next: any) => next.handle() })
      .compile();

    controller = module.get<UserController>(UserController);
    reflector = module.get(Reflector);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Guards and Interceptors', () => {
    it('should have correct guards and interceptors applied', () => {
      const guards = Reflect.getMetadata('__guards__', UserController);
      expect(guards).toBeDefined();
      expect(guards).toContain(SupabaseAuthGuard);
      expect(guards).toContain(ChapterGuard);
      expect(guards).toContain(PermissionsGuard);

      const requiredPermissions = reflector.get(
        PERMISSIONS_KEY,
        UserController,
      );
      expect(requiredPermissions).toEqual([SystemPermissions.MEMBERS_VIEW]);

      const interceptors = Reflect.getMetadata(
        '__interceptors__',
        UserController,
      );
      expect(interceptors).toBeDefined();
      expect(interceptors).toContain(AuthSyncInterceptor);
    });

    it('requestAvatarUploadUrl should include PermissionsGuard and MEMBERS_VIEW metadata', () => {
      const guards = mergeRouteGuards(
        UserController,
        controller.requestAvatarUploadUrl,
      );
      expect(guards).toContain(SupabaseAuthGuard);
      expect(guards).toContain(ChapterGuard);
      expect(guards).toContain(PermissionsGuard);

      const requiredPermissions = effectiveRequirePermissions(
        reflector,
        UserController,
        controller.requestAvatarUploadUrl,
      );
      expect(requiredPermissions).toEqual([SystemPermissions.MEMBERS_VIEW]);
    });
  });

  describe('getMe', () => {
    it('should return the current user profile', async () => {
      const userId = 'user-123';
      const mockUser = { id: userId, full_name: 'Test User' } as any;
      userService.findById.mockResolvedValue(mockUser);

      const result = await controller.getMe(userId);

      expect(userService.findById).toHaveBeenCalledWith(userId);
      expect(result).toEqual(mockUser);
    });
  });

  describe('updateMe', () => {
    it('should update and return the current user profile', async () => {
      const userId = 'user-123';
      const dto: UpdateUserDto = { first_name: 'Updated' };
      const mockUpdatedUser = { id: userId, first_name: 'Updated' } as any;
      userService.update.mockResolvedValue(mockUpdatedUser);

      const result = await controller.updateMe(userId, dto);

      expect(userService.update).toHaveBeenCalledWith(userId, dto);
      expect(result).toEqual(mockUpdatedUser);
    });
  });

  describe('requestAvatarUploadUrl', () => {
    it('should return a signed upload URL', async () => {
      const userId = 'user-123';
      const chapterId = 'chapter-123';
      const dto: RequestAvatarUploadUrlDto = {
        filename: 'avatar.png',
        content_type: 'image/png',
      };
      const mockResult = { url: 'https://example.com/upload' };
      userService.requestAvatarUploadUrl.mockResolvedValue(mockResult);

      const result = await controller.requestAvatarUploadUrl(
        userId,
        chapterId,
        dto,
      );

      expect(userService.requestAvatarUploadUrl).toHaveBeenCalledWith(
        chapterId,
        userId,
        dto.filename,
        dto.content_type,
      );
      expect(result).toEqual(mockResult);
    });
  });
});
