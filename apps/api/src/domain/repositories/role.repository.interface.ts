import { Role } from '../entities/role.entity';

export const ROLE_REPOSITORY = 'ROLE_REPOSITORY';

export interface IRoleRepository {
  findById(id: string): Promise<Role | null>;
  findByChapter(chapterId: string): Promise<Role[]>;
  /** Pass `chapterId` to drop ids that belong to another chapter's roles. */
  findByIds(ids: string[], chapterId?: string): Promise<Role[]>;
  findByChapterAndName(chapterId: string, name: string): Promise<Role | null>;
  /**
   * Resolve a seeded system role by its rename-proof `system_key`. Prefer this
   * over {@link findByChapterAndName} for any lookup that drives authorization
   * or lifecycle behavior — `name` is a display label a chapter may change.
   */
  findByChapterAndSystemKey(
    chapterId: string,
    systemKey: string,
  ): Promise<Role | null>;
  create(data: Partial<Role>): Promise<Role>;
  createMany(data: Partial<Role>[]): Promise<Role[]>;
  update(id: string, data: Partial<Role>): Promise<Role>;
  delete(id: string): Promise<void>;
}
