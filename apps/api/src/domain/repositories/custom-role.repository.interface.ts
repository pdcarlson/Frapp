import type { ChapterCustomRole } from '../entities/chapter-custom-role.entity';

export const CUSTOM_ROLE_REPOSITORY = 'CUSTOM_ROLE_REPOSITORY';

/**
 * Thrown by {@link ICustomRoleRepository.create} when the chapter already has
 * a custom role with the same `key` (the `(chapter_id, key)` unique index,
 * raised as `23505`).
 */
export class CustomRoleKeyConflictError extends Error {
  constructor() {
    super('A custom role with this key already exists in this chapter');
    this.name = 'CustomRoleKeyConflictError';
  }
}

/** `chapter_custom_roles` (bridge model, spec/behavior/rbac.md). */
export interface ICustomRoleRepository {
  /** Every custom role in the chapter, ordered by `rank`. */
  findByChapter(chapterId: string): Promise<ChapterCustomRole[]>;
  /**
   * Rows for `ids` in `chapterId`. A stale or cross-chapter id matches no row.
   * An empty list returns `[]` without querying.
   */
  findByIds(ids: string[], chapterId: string): Promise<ChapterCustomRole[]>;
  /**
   * One custom role in the chapter, or `null`.
   *
   * Also `null` when the read fails: a PostgREST error is reported as a miss,
   * not thrown (#2459). That is the behavior this method inherited from
   * `CustomRoleService` and kept so moving it here stayed a pure refactor;
   * fixing #2459 means changing this method and {@link update}.
   */
  findById(id: string, chapterId: string): Promise<ChapterCustomRole | null>;
  /** Throws {@link CustomRoleKeyConflictError} on a duplicate `key`. */
  create(data: Partial<ChapterCustomRole>): Promise<ChapterCustomRole>;
  /**
   * The updated row, or `null` when no row matched in the chapter. Like
   * {@link findById}, a failed write also returns `null` (#2459).
   */
  update(
    id: string,
    chapterId: string,
    patch: Partial<ChapterCustomRole>,
  ): Promise<ChapterCustomRole | null>;
  delete(id: string, chapterId: string): Promise<void>;
}
