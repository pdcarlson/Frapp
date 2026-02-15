import { Test, TestingModule } from '@nestjs/testing';
import { PointsService } from './points.service';
import { POINT_REPOSITORY } from '../../domain/repositories/point.repository.interface';

describe('PointsService', () => {
  let service: PointsService;
  let pointRepo: {
    create: jest.Mock;
    getBalance: jest.Mock;
    getLeaderboard: jest.Mock;
  };

  const mockPointRepo = {
    create: jest.fn(),
    getBalance: jest.fn(),
    getLeaderboard: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PointsService,
        { provide: POINT_REPOSITORY, useValue: mockPointRepo },
      ],
    }).compile();

    service = module.get<PointsService>(PointsService);
    pointRepo = mockPointRepo;
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('awardPoints', () => {
    it('should call repo.create with correct data', async () => {
      const data = {
        userId: 'u1',
        chapterId: 'c1',
        amount: 10,
        category: 'ATTENDANCE',
        description: 'Testing',
      };

      await service.awardPoints(
        data.userId,
        data.chapterId,
        data.amount,
        data.category,
        data.description,
      );
      expect(pointRepo.create).toHaveBeenCalledWith(
        expect.objectContaining(data),
      );
    });
  });

  describe('getBalance', () => {
    it('should return balance from repo', async () => {
      pointRepo.getBalance.mockResolvedValue(100);
      const balance = await service.getBalance('u1');
      expect(balance).toBe(100);
    });
  });
});
