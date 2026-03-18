import { Test, TestingModule } from '@nestjs/testing';
import { PointsController } from './points.controller';
import { PointsService } from '../../application/services/points.service';
import { ChapterGuard } from '../guards/chapter.guard';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';

describe('PointsController', () => {
  let controller: PointsController;
  let pointsService: jest.Mocked<PointsService>;

  beforeEach(async () => {
    // Mock PointsService
    const mockPointsService = {
      getUserSummary: jest.fn(),
      getLeaderboard: jest.fn(),
      adjustPoints: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PointsController],
      providers: [
        {
          provide: PointsService,
          useValue: mockPointsService,
        },
      ],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: jest.fn(() => true) })
      .compile();

    controller = module.get<PointsController>(PointsController);
    pointsService = module.get(PointsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getMe', () => {
    it('should return user summary with default window', async () => {
      const mockSummary = {
        transactions: [],
        balance: 100,
        window: 'all' as const,
      };
      pointsService.getUserSummary.mockResolvedValue(mockSummary);

      const result = await controller.getMe('chapter-1', 'user-1', {});

      expect(pointsService.getUserSummary).toHaveBeenCalledWith('chapter-1', 'user-1', 'all');
      expect(result).toEqual(mockSummary);
    });

    it('should return user summary with provided window', async () => {
      const mockSummary = {
        transactions: [],
        balance: 50,
        window: 'semester' as const,
      };
      pointsService.getUserSummary.mockResolvedValue(mockSummary);

      const result = await controller.getMe('chapter-1', 'user-1', { window: 'semester' });

      expect(pointsService.getUserSummary).toHaveBeenCalledWith('chapter-1', 'user-1', 'semester');
      expect(result).toEqual(mockSummary);
    });
  });

  describe('getLeaderboard', () => {
    it('should return leaderboard with default window', async () => {
      const mockLeaderboard = [{ user_id: 'user-1', total: 100 }];
      pointsService.getLeaderboard.mockResolvedValue(mockLeaderboard);

      const result = await controller.getLeaderboard('chapter-1', {});

      expect(pointsService.getLeaderboard).toHaveBeenCalledWith('chapter-1', 'all');
      expect(result).toEqual(mockLeaderboard);
    });

    it('should return leaderboard with provided window', async () => {
      const mockLeaderboard = [{ user_id: 'user-1', total: 50 }];
      pointsService.getLeaderboard.mockResolvedValue(mockLeaderboard);

      const result = await controller.getLeaderboard('chapter-1', { window: 'semester' });

      expect(pointsService.getLeaderboard).toHaveBeenCalledWith('chapter-1', 'semester');
      expect(result).toEqual(mockLeaderboard);
    });
  });

  describe('getMember', () => {
    it('should return member summary with default window', async () => {
      const mockSummary = {
        transactions: [],
        balance: 100,
        window: 'all' as const,
      };
      pointsService.getUserSummary.mockResolvedValue(mockSummary);

      const result = await controller.getMember('chapter-1', 'user-2', {});

      expect(pointsService.getUserSummary).toHaveBeenCalledWith('chapter-1', 'user-2', 'all');
      expect(result).toEqual(mockSummary);
    });

    it('should return member summary with provided window', async () => {
      const mockSummary = {
        transactions: [],
        balance: 50,
        window: 'semester' as const,
      };
      pointsService.getUserSummary.mockResolvedValue(mockSummary);

      const result = await controller.getMember('chapter-1', 'user-2', { window: 'semester' });

      expect(pointsService.getUserSummary).toHaveBeenCalledWith('chapter-1', 'user-2', 'semester');
      expect(result).toEqual(mockSummary);
    });
  });

  describe('adjust', () => {
    it('should call adjustPoints with mapped dto', async () => {
      const mockDto = {
        target_user_id: 'user-2',
        amount: 50,
        category: 'BONUS',
        reason: 'Great job',
      };
      const mockTransaction = {
        id: 'tx-1',
        chapter_id: 'chapter-1',
        user_id: 'user-2',
        amount: 50,
        category: 'BONUS',
        description: 'Great job',
        metadata: {},
        created_at: new Date().toISOString(),
      };

      pointsService.adjustPoints.mockResolvedValue(mockTransaction as any);

      const result = await controller.adjust('chapter-1', 'admin-1', mockDto as any);

      expect(pointsService.adjustPoints).toHaveBeenCalledWith({
        chapterId: 'chapter-1',
        targetUserId: 'user-2',
        adminUserId: 'admin-1',
        amount: 50,
        category: 'BONUS',
        reason: 'Great job',
      });
      expect(result).toEqual(mockTransaction);
    });
  });
});
