import { Role } from '../entities/rbac.entity';

export const RBAC_REPOSITORY = 'RBAC_REPOSITORY';

export interface IRbacRepository {
  createRole(role: Omit<Role, 'id' | 'createdAt'>): Promise<Role>;
  updateRole(id: string, updates: Partial<Role>): Promise<Role>;
  deleteRole(id: string): Promise<void>;
  findRoleById(id: string): Promise<Role | null>;
  findRolesByChapter(chapterId: string): Promise<Role[]>;
  findRolesByIds(ids: string[]): Promise<Role[]>;
}
