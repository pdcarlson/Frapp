import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { users } from '../schema';
import { IUserRepository } from '../../../domain/repositories/user.repository.interface';
import { User } from '../../../domain/entities/user.entity';
import { DRIZZLE_DB } from '../drizzle.provider';

@Injectable()
export class DrizzleUserRepository implements IUserRepository {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(data: { clerkId: string; email: string }): Promise<User> {
    const [result] = await this.db.insert(users).values(data).returning();
    return this.mapToDomain(result);
  }

  async update(clerkId: string, data: Partial<{ email: string }>): Promise<User> {
    const [result] = await this.db
      .update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.clerkId, clerkId))
      .returning();
    
    if (!result) {
      throw new Error(`User with clerkId ${clerkId} not found`);
    }
    
    return this.mapToDomain(result);
  }

  async delete(clerkId: string): Promise<void> {
    await this.db.delete(users).where(eq(users.clerkId, clerkId));
  }

  async findByClerkId(clerkId: string): Promise<User | null> {
    const result = await this.db.query.users.findFirst({
      where: eq(users.clerkId, clerkId),
    });
    
    return result ? this.mapToDomain(result) : null;
  }

  private mapToDomain(row: typeof users.$inferSelect): User {
    return new User(
      row.id,
      row.clerkId,
      row.email,
      row.createdAt,
      row.updatedAt,
    );
  }
}
