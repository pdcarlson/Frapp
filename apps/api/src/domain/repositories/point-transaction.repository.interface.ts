import { PointTransaction } from '../entities/point-transaction.entity';

export const POINT_TRANSACTION_REPOSITORY = 'POINT_TRANSACTION_REPOSITORY';

export interface IPointTransactionRepository {
  create(data: Partial<PointTransaction>): Promise<PointTransaction>;
  findByUser(chapterId: string, userId: string): Promise<PointTransaction[]>;
  findByChapter(chapterId: string): Promise<PointTransaction[]>;
}
