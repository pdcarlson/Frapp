import { RoleTier } from '../entities/role.entity';

export const ROLE_TIER_REPOSITORY = 'ROLE_TIER_REPOSITORY';

export interface IRoleTierRepository {
  /** The chapter's tiers, highest first. */
  findByChapter(chapterId: string): Promise<RoleTier[]>;
  createMany(data: Partial<RoleTier>[]): Promise<RoleTier[]>;
  /** `null` when the chapter already has a tier of that name. */
  create(data: Partial<RoleTier>): Promise<RoleTier | null>;
  /**
   * `null` when the new name is taken in the chapter; `undefined` when the
   * tier is not in the chapter (deleted a moment ago).
   */
  update(
    id: string,
    chapterId: string,
    data: Pick<Partial<RoleTier>, 'name' | 'permissions' | 'mentionable'>,
  ): Promise<RoleTier | null | undefined>;
  /**
   * Every tier of the chapter, in `ids` order, positions 1 to n. `'stale'`
   * when `ids` is not exactly the chapter's tiers or its order no longer
   * starts with `fixedIds` (`reorder_role_tiers`). `'below_everyone'` when
   * the order puts a tier holding the New Member or Alumni role above the
   * Everyone role's tier (#4548).
   */
  reorder(
    chapterId: string,
    ids: string[],
    fixedIds: string[],
  ): Promise<RoleTier[] | 'stale' | 'below_everyone'>;
  /**
   * `'has_roles'` when a role still sits in the tier, and `'missing'` when no
   * row matched (a concurrent delete got there first).
   */
  delete(
    id: string,
    chapterId: string,
  ): Promise<'deleted' | 'missing' | 'has_roles'>;
}
