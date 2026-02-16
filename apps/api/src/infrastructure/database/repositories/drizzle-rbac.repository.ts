import { Inject, Injectable } from '@nestjs/common';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../schema';
import { DRIZZLE_DB } from '../drizzle.provider';
import { IRbacRepository } from '../../../domain/repositories/rbac.repository.interface';
import { Role } from '../../../domain/entities/rbac.entity';

@Injectable()
export class DrizzleRbacRepository implements IRbacRepository {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  async createRole(role: Omit<Role, 'id' | 'createdAt'>): Promise<Role> {
    const [result] = await this.db
      .insert(schema.roles)
      .values({
        chapterId: role.chapterId,
        name: role.name,
        permissions: role.permissions,
        isSystem: role.isSystem,
      })
      .returning();

    return this.mapRole(result);
  }

  async updateRole(id: string, updates: Partial<Role>): Promise<Role> {
    const [result] = await this.db
      .update(schema.roles)
      .set({ ...updates })
      .where(eq(schema.roles.id, id))
      .returning();

    return this.mapRole(result);
  }

  async deleteRole(id: string): Promise<void> {
    await this.db.delete(schema.roles).where(eq(schema.roles.id, id));
  }

  async findRoleById(id: string): Promise<Role | null> {
    const [result] = await this.db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.id, id))
      .limit(1);

    return result ? this.mapRole(result) : null;
  }

  async findRolesByChapter(chapterId: string): Promise<Role[]> {
    const results = await this.db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.chapterId, chapterId));

    return results.map(this.mapRole.bind(this));
  }

  async findRolesByIds(ids: string[]): Promise<Role[]> {
    if (ids.length === 0) return [];
    const results = await this.db
      .select()
      .from(schema.roles)
      .where(inArray(schema.roles.id, ids));

    return results.map(this.mapRole.bind(this));
  }

  private mapRole(row: typeof schema.roles.$inferSelect): Role {
    return new Role(
      row.id,
      row.chapterId,
      row.name,
      row.permissions,
      row.isSystem,
      row.createdAt,
    );
  }
}
