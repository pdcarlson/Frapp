import { RoleTier } from '../entities/role.entity';

export const ROLE_TIER_REPOSITORY = 'ROLE_TIER_REPOSITORY';

export interface IRoleTierRepository {
  /** The chapter's tiers, highest first. */
  findByChapter(chapterId: string): Promise<RoleTier[]>;
  createMany(data: Partial<RoleTier>[]): Promise<RoleTier[]>;
}
