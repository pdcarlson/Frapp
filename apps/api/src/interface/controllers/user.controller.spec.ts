import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from '../../application/services/user.service';
import { UpdateUserDto, RequestAvatarUploadUrlDto } from '../dtos/user.dto';
import { UseGuards, UseInterceptors } from '@nestjs/common';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SystemPermissions } from '../../domain/constants/permissions';
import { ChapterGuard } from '../guards/chapter.guard';
import { AuthSyncInterceptor } from '../interceptors/auth-sync.interceptor';
import { User } from '../../domain/entities/user.entity';

describe('UserController', () => {
  let controller: UserController;
  let userService: jest.Mocked<Partial<UserService>>;

  beforeEach(async () => {
    userService = {
      findById: jest.fn(),
      update: jest.fn(),
      requestAvatarUploadUrl: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: userService,
        },
        {
          provide: 'SUPABASE_CLIENT',
          useValue: {},
        },
        {
          provide: 'AuthService',
          useValue: {},
        },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .overrideInterceptor(AuthSyncInterceptor)
      .useValue({ intercept: (context, next) => next.handle() })
      .compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Guards and Interceptors', () => {
    it('should have PermissionsGuard applied to the controller', () => {
      const guards = Reflect.getMetadata('__guards__', UserController);
      expect(guards).toBeDefined();
      expect(guards).toContain(PermissionsGuard);
    });

    it('should have empty permissions or specific permissions for getMe', () => {
      const permissions = Reflect.getMetadata('permissions', controller.getMe) || Reflect.getMetadata('permissions', UserController);
      expect(permissions).toEqual([]); // or whatever we define
    });

    it('should have empty permissions or specific permissions for updateMe', () => {
      const permissions = Reflect.getMetadata('permissions', controller.updateMe) || Reflect.getMetadata('permissions', UserController);
      expect(permissions).toEqual([]);
    });

    it('should have appropriate permissions for requestAvatarUploadUrl', () => {
      const permissions = Reflect.getMetadata('permissions', controller.requestAvatarUploadUrl);
      expect(permissions).toEqual([]);
    });
    it('should have SupabaseAuthGuard applied to the controller', () => {
      const guards = Reflect.getMetadata('__guards__', UserController);
      expect(guards).toBeDefined();
      expect(guards).toContain(SupabaseAuthGuard);
    });

    it('should have AuthSyncInterceptor applied to the controller', () => {
      const interceptors = Reflect.getMetadata('__interceptors__', UserController);
      expect(interceptors).toBeDefined();
      expect(interceptors).toContain(AuthSyncInterceptor);
    });

    it('should have ChapterGuard applied to requestAvatarUploadUrl', () => {
      const guards = Reflect.getMetadata('__guards__', controller.requestAvatarUploadUrl);
      expect(guards).toBeDefined();
      expect(guards).toContain(ChapterGuard);
    });
  });

  describe('getMe', () => {
    it('should return the current user profile', async () => {
      const userId = 'user-123';
      const expectedUser = { id: userId, email: 'test@example.com' } as User;
      userService.findById!.mockResolvedValue(expectedUser);

      const result = await controller.getMe(userId);

      expect(userService.findById).toHaveBeenCalledWith(userId);
      expect(result).toEqual(expectedUser);
    });
  });

  describe('updateMe', () => {
    it('should update the current user profile', async () => {
      const userId = 'user-123';
      const dto: UpdateUserDto = { display_name: 'New Name' };
      const expectedUser = { id: userId, display_name: 'New Name' } as User;
      userService.update!.mockResolvedValue(expectedUser);

      const result = await controller.updateMe(userId, dto);

      expect(userService.update).toHaveBeenCalledWith(userId, dto);
      expect(result).toEqual(expectedUser);
    });
  });

  describe('requestAvatarUploadUrl', () => {
    it('should request an avatar upload URL', async () => {
      const userId = 'user-123';
      const chapterId = 'chapter-456';
      const dto: RequestAvatarUploadUrlDto = {
        filename: 'avatar.png',
        content_type: 'image/png',
      };
      const expectedResponse = {
        signedUrl: 'https://example.com/upload',
        storagePath: 'avatars/avatar.png',
      };
      userService.requestAvatarUploadUrl!.mockResolvedValue(expectedResponse);

      const result = await controller.requestAvatarUploadUrl(userId, chapterId, dto);

      expect(userService.requestAvatarUploadUrl).toHaveBeenCalledWith(
        chapterId,
        userId,
        dto.filename,
        dto.content_type,
      );
      expect(result).toEqual(expectedResponse);
    });
  });
});
