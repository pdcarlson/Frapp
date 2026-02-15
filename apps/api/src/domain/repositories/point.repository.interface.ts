import { PointTransaction } from '../entities/point.entity';

export const POINT_REPOSITORY = 'POINT_REPOSITORY';

export interface IPointRepository {
  create(
    transaction: Omit<PointTransaction, 'id' | 'createdAt'>,
  ): Promise<PointTransaction>;
  getBalance(userId: string): Promise<number>;
  findByUser(userId: string): Promise<PointTransaction[]>;
  getLeaderboard(
    chapterId: string,
    limit?: number,
  ): Promise<{ userId: string; totalPoints: number }[]>;
}
