import { Role } from '../entities/role.entity';

export const ROLE_REPOSITORY = 'ROLE_REPOSITORY';

export interface IRoleRepository {
  findById(id: string): Promise<Role | null>;
  findByChapter(chapterId: string): Promise<Role[]>;
  findByIds(ids: string[]): Promise<Role[]>;
  findByChapterAndName(chapterId: string, name: string): Promise<Role | null>;
  create(data: Partial<Role>): Promise<Role>;
  createMany(data: Partial<Role>[]): Promise<Role[]>;
  update(id: string, data: Partial<Role>): Promise<Role>;
  delete(id: string): Promise<void>;
}
