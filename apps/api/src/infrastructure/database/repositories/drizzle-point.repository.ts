import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, sum, desc, sql } from 'drizzle-orm';
import * as schema from '../schema';
import { DRIZZLE_DB } from '../drizzle.provider';
import { IPointRepository } from '../../../domain/repositories/point.repository.interface';
import { PointTransaction } from '../../../domain/entities/point.entity';

@Injectable()
export class DrizzlePointRepository implements IPointRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(
    transaction: Omit<PointTransaction, 'id' | 'createdAt'>,
  ): Promise<PointTransaction> {
    const [result] = await this.db
      .insert(schema.pointTransactions)
      .values({
        chapterId: transaction.chapterId,
        userId: transaction.userId,
        amount: transaction.amount,
        category: transaction.category,
        description: transaction.description,
        metadata: transaction.metadata,
      })
      .returning();

    return new PointTransaction(
      result.id,
      result.chapterId,
      result.userId,
      result.amount,
      result.category,
      result.description,
      result.metadata as Record<string, unknown> | null,
      result.createdAt,
    );
  }

  async getBalance(userId: string): Promise<number> {
    const [result] = await this.db
      .select({
        total: sum(schema.pointTransactions.amount),
      })
      .from(schema.pointTransactions)
      .where(eq(schema.pointTransactions.userId, userId));

    return Number(result?.total || 0);
  }

  async findByUser(userId: string): Promise<PointTransaction[]> {
    const results = await this.db
      .select()
      .from(schema.pointTransactions)
      .where(eq(schema.pointTransactions.userId, userId))
      .orderBy(desc(schema.pointTransactions.createdAt));

    return results.map(
      (r) =>
        new PointTransaction(
          r.id,
          r.chapterId,
          r.userId,
          r.amount,
          r.category,
          r.description,
          r.metadata as Record<string, unknown> | null,
          r.createdAt,
        ),
    );
  }

  async getLeaderboard(
    chapterId: string,
    limit: number = 10,
  ): Promise<{ userId: string; totalPoints: number }[]> {
    const results = await this.db
      .select({
        userId: schema.pointTransactions.userId,
        totalPoints: sql<number>`CAST(SUM(${schema.pointTransactions.amount}) AS INTEGER)`,
      })
      .from(schema.pointTransactions)
      .where(eq(schema.pointTransactions.chapterId, chapterId))
      .groupBy(schema.pointTransactions.userId)
      .orderBy(desc(sql`total_points`))
      .limit(limit);

    return results.map((r) => ({
      userId: r.userId,
      totalPoints: r.totalPoints,
    }));
  }
}
