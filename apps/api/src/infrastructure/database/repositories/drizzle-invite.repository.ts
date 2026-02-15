import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';
import { invites } from '../schema';
import { IInviteRepository } from '../../../domain/repositories/invite.repository.interface';
import { Invite } from '../../../domain/entities/invite.entity';
import { DRIZZLE_DB } from '../drizzle.provider';

@Injectable()
export class DrizzleInviteRepository implements IInviteRepository {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async create(data: {
    token: string;
    chapterId: string;
    role: string;
    expiresAt: Date;
    createdBy: string;
  }): Promise<Invite> {
    const [result] = await this.db.insert(invites).values(data).returning();
    return this.mapToDomain(result);
  }

  async findByToken(token: string): Promise<Invite | null> {
    const result = await this.db.query.invites.findFirst({
      where: eq(invites.token, token),
    });
    return result ? this.mapToDomain(result) : null;
  }

  async markAsUsed(id: string): Promise<void> {
    await this.db
      .update(invites)
      .set({ usedAt: new Date() })
      .where(eq(invites.id, id));
  }

  private mapToDomain(row: typeof invites.$inferSelect): Invite {
    return new Invite(
      row.id,
      row.token,
      row.chapterId,
      row.role,
      row.expiresAt,
      row.createdBy,
      row.usedAt,
      row.createdAt,
    );
  }
}
