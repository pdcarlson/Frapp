import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { chapters } from '../schema';
import { IChapterRepository } from '../../../domain/repositories/chapter.repository.interface';
import { Chapter } from '../../../domain/entities/chapter.entity';
import { DRIZZLE_DB } from '../drizzle.provider';

@Injectable()
export class DrizzleChapterRepository implements IChapterRepository {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(data: {
    name: string;
    university?: string;
    clerkOrganizationId?: string;
    stripeCustomerId?: string;
    subscriptionStatus?: string;
    subscriptionId?: string;
  }): Promise<Chapter> {
    const [result] = await this.db.insert(chapters).values(data).returning();
    return this.mapToDomain(result);
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      university: string;
      subscriptionStatus: string;
      subscriptionId: string;
    }>,
  ): Promise<Chapter> {
    const [result] = await this.db
      .update(chapters)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(chapters.id, id))
      .returning();

    if (!result) {
      throw new Error(`Chapter with id ${id} not found`);
    }

    return this.mapToDomain(result);
  }

  async findByClerkOrganizationId(
    clerkOrganizationId: string,
  ): Promise<Chapter | null> {
    const result = await this.db.query.chapters.findFirst({
      where: eq(chapters.clerkOrganizationId, clerkOrganizationId),
    });
    return result ? this.mapToDomain(result) : null;
  }

  async findById(id: string): Promise<Chapter | null> {
    const result = await this.db.query.chapters.findFirst({
      where: eq(chapters.id, id),
    });
    return result ? this.mapToDomain(result) : null;
  }

  private mapToDomain(row: typeof chapters.$inferSelect): Chapter {
    return new Chapter(
      row.id,
      row.name,
      row.university,
      row.clerkOrganizationId,
      row.stripeCustomerId,
      row.subscriptionStatus,
      row.subscriptionId,
      row.createdAt,
      row.updatedAt,
    );
  }
}
