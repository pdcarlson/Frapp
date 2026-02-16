import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, and } from 'drizzle-orm';
import * as schema from '../schema';
import { members } from '../schema';
import { IMemberRepository } from '../../../domain/repositories/member.repository.interface';
import { Member } from '../../../domain/entities/member.entity';
import { DRIZZLE_DB } from '../drizzle.provider';

@Injectable()
export class DrizzleMemberRepository implements IMemberRepository {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(data: {
    userId: string;
    chapterId: string;
    roleIds?: string[];
  }): Promise<Member> {
    const [result] = await this.db.insert(members).values(data).returning();
    return this.mapToDomain(result);
  }

  async findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<Member | null> {
    const result = await this.db.query.members.findFirst({
      where: and(eq(members.userId, userId), eq(members.chapterId, chapterId)),
    });
    return result ? this.mapToDomain(result) : null;
  }

  async findById(id: string): Promise<Member | null> {
    const result = await this.db.query.members.findFirst({
      where: eq(members.id, id),
    });
    return result ? this.mapToDomain(result) : null;
  }

  async findByChapter(chapterId: string): Promise<Member[]> {
    const results = await this.db.query.members.findMany({
      where: eq(members.chapterId, chapterId),
    });
    return results.map(this.mapToDomain.bind(this));
  }

  async updateRoles(id: string, roleIds: string[]): Promise<Member> {
    const [result] = await this.db
      .update(members)
      .set({ roleIds, updatedAt: new Date() })
      .where(eq(members.id, id))
      .returning();

    if (!result) {
      throw new Error(`Member with id ${id} not found`);
    }

    return this.mapToDomain(result);
  }

  private mapToDomain(row: typeof members.$inferSelect): Member {
    return new Member(
      row.id,
      row.userId,
      row.chapterId,
      row.roleIds,
      row.createdAt,
      row.updatedAt,
    );
  }
}
