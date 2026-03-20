import { Test, TestingModule } from '@nestjs/testing';
import { PointsController } from './points.controller';
import { PointsService } from '../../application/services/points.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SystemPermissions } from '../../domain/constants/permissions';
import { AdjustPointsDto, PointsWindowQueryDto } from '../dtos/points.dto';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

describe('PointsController', () => {
  let controller: PointsController;
  let pointsService: jest.Mocked<PointsService>;

  beforeEach(async () => {
    pointsService = {
      getUserSummary: jest.fn(),
      getLeaderboard: jest.fn(),
      adjustPoints: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PointsController],
      providers: [{ provide: PointsService, useValue: pointsService }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PointsController>(PointsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMe', () => {
    it('should get current user point summary with default window', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const query: PointsWindowQueryDto = {};
      const expectedResult = { total: 100 } as any;

      pointsService.getUserSummary.mockResolvedValue(expectedResult);

      const result = await controller.getMe(chapterId, userId, query);

      expect(pointsService.getUserSummary).toHaveBeenCalledWith(
        chapterId,
        userId,
        'all',
      );
      expect(result).toEqual(expectedResult);
    });

    it('should get current user point summary with specific window', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const query: PointsWindowQueryDto = { window: 'semester' };
      const expectedResult = { total: 50 } as any;

      pointsService.getUserSummary.mockResolvedValue(expectedResult);

      const result = await controller.getMe(chapterId, userId, query);

      expect(pointsService.getUserSummary).toHaveBeenCalledWith(
        chapterId,
        userId,
        'semester',
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getLeaderboard', () => {
    it('should get chapter leaderboard with default window', async () => {
      const chapterId = 'chapter-1';
      const query: PointsWindowQueryDto = {};
      const expectedResult = [] as any;

      pointsService.getLeaderboard.mockResolvedValue(expectedResult);

      const result = await controller.getLeaderboard(chapterId, query);

      expect(pointsService.getLeaderboard).toHaveBeenCalledWith(
        chapterId,
        'all',
      );
      expect(result).toEqual(expectedResult);
    });

    it('should get chapter leaderboard with specific window', async () => {
      const chapterId = 'chapter-1';
      const query: PointsWindowQueryDto = { window: 'month' };
      const expectedResult = [] as any;

      pointsService.getLeaderboard.mockResolvedValue(expectedResult);

      const result = await controller.getLeaderboard(chapterId, query);

      expect(pointsService.getLeaderboard).toHaveBeenCalledWith(
        chapterId,
        'month',
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('getMember', () => {
    it('should get point summary for a member with default window', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-2';
      const query: PointsWindowQueryDto = {};
      const expectedResult = { total: 200 } as any;

      pointsService.getUserSummary.mockResolvedValue(expectedResult);

      const result = await controller.getMember(chapterId, userId, query);

      expect(pointsService.getUserSummary).toHaveBeenCalledWith(
        chapterId,
        userId,
        'all',
      );
      expect(result).toEqual(expectedResult);
    });

    it('should get point summary for a member with specific window', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-2';
      const query: PointsWindowQueryDto = { window: 'semester' };
      const expectedResult = { total: 150 } as any;

      pointsService.getUserSummary.mockResolvedValue(expectedResult);

      const result = await controller.getMember(chapterId, userId, query);

      expect(pointsService.getUserSummary).toHaveBeenCalledWith(
        chapterId,
        userId,
        'semester',
      );
      expect(result).toEqual(expectedResult);
    });

    it('should require POINTS_VIEW_ALL permission', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.getMember,
      );
      expect(permissions).toEqual([SystemPermissions.POINTS_VIEW_ALL]);
    });
  });

  describe('adjust', () => {
    it('should manually adjust member points', async () => {
      const chapterId = 'chapter-1';
      const adminId = 'admin-1';
      const dto: AdjustPointsDto = {
        target_user_id: 'user-2',
        amount: 50,
        category: 'MANUAL',
        reason: 'Good work',
      };
      const expectedResult = { id: 'transaction-1' } as any;

      pointsService.adjustPoints.mockResolvedValue(expectedResult);

      const result = await controller.adjust(chapterId, adminId, dto);

      expect(pointsService.adjustPoints).toHaveBeenCalledWith({
        chapterId,
        targetUserId: dto.target_user_id,
        adminUserId: adminId,
        amount: dto.amount,
        category: dto.category,
        reason: dto.reason,
      });
      expect(result).toEqual(expectedResult);
    });

    it('should require POINTS_ADJUST permission', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.adjust,
      );
      expect(permissions).toEqual([SystemPermissions.POINTS_ADJUST]);
    });
  });
});
