import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from '../../application/services/user.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { AuthSyncGuard } from '../guards/auth-sync.guard';
import { RequestAvatarUploadUrlDto, UpdateUserDto } from '../dtos/user.dto';

describe('UserController', () => {
  let controller: UserController;
  let userService: jest.Mocked<UserService>;

  beforeEach(async () => {
    userService = {
      findById: jest.fn(),
      update: jest.fn(),
      requestAvatarUploadUrl: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: userService }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AuthSyncGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Guards', () => {
    it('should have correct guards applied', () => {
      const guards = Reflect.getMetadata('__guards__', UserController);
      expect(guards).toBeDefined();
      expect(guards).toContain(SupabaseAuthGuard);
      expect(guards).toContain(AuthSyncGuard);
    });

    it('requestAvatarUploadUrl should have ChapterGuard applied', () => {
      const guards = Reflect.getMetadata('__guards__', controller.requestAvatarUploadUrl);
      expect(guards).toBeDefined();
      expect(guards).toContain(ChapterGuard);
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

      const result = await controller.requestAvatarUploadUrl(userId, chapterId, dto);

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
