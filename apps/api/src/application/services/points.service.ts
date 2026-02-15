import { Inject, Injectable, Logger } from '@nestjs/common';
import { POINT_REPOSITORY } from '../../domain/repositories/point.repository.interface';
import type { IPointRepository } from '../../domain/repositories/point.repository.interface';
import { PointTransaction } from '../../domain/entities/point.entity';

@Injectable()
export class PointsService {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    @Inject(POINT_REPOSITORY)
    private readonly pointRepo: IPointRepository,
  ) {}

  async awardPoints(
    userId: string,
    chapterId: string,
    amount: number,
    category: string,
    description: string,
    metadata?: Record<string, unknown>,
  ): Promise<PointTransaction> {
    this.logger.log(
      `Awarding ${amount} points to user ${userId} in chapter ${chapterId} for ${category}`,
    );

    return this.pointRepo.create({
      userId,
      chapterId,
      amount,
      category,
      description,
      metadata: metadata || null,
    });
  }

  async getBalance(userId: string): Promise<number> {
    return this.pointRepo.getBalance(userId);
  }

  async getLeaderboard(chapterId: string, limit?: number) {
    return this.pointRepo.getLeaderboard(chapterId, limit);
  }

  async getTransactionHistory(userId: string): Promise<PointTransaction[]> {
    return this.pointRepo.findByUser(userId);
  }
}
