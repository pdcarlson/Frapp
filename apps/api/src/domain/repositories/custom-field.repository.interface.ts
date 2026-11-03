import type {
  ChapterCustomField,
  CustomFieldVisibility,
} from '../entities/chapter-custom-field.entity';

export const CUSTOM_FIELD_REPOSITORY = 'CUSTOM_FIELD_REPOSITORY';

/**
 * Thrown by {@link ICustomFieldRepository.create} when the chapter already has
 * a field with the same `key` (the `(chapter_id, key)` unique index, raised as
 * `23505`).
 */
export class CustomFieldKeyConflictError extends Error {
  constructor() {
    super('A custom field with this key already exists in this chapter');
    this.name = 'CustomFieldKeyConflictError';
  }
}

/**
 * `chapter_custom_fields` and the `member_custom_field_values` read paths the
 * member directory and search use (Settings → Fields, spec/behavior/members.md).
 */
export interface ICustomFieldRepository {
  /** Every field in the chapter, ordered by `sort` then `created_at`. */
  findByChapter(chapterId: string): Promise<ChapterCustomField[]>;
  /**
   * The chapter's fields whose `visibility` is in `visibilities`, in the same
   * order as {@link findByChapter}.
   */
  findByVisibility(
    chapterId: string,
    visibilities: CustomFieldVisibility[],
  ): Promise<ChapterCustomField[]>;
  /** Id + visibility only, for the same filter as {@link findByVisibility}. */
  findIdsByVisibility(
    chapterId: string,
    visibilities: CustomFieldVisibility[],
  ): Promise<{ id: string; visibility: CustomFieldVisibility }[]>;
  /**
   * One field in the chapter, or `null`.
   *
   * Also `null` when the read fails: a PostgREST error is reported as a miss,
   * not thrown (#2459). That is the behavior this method inherited from
   * `CustomFieldService` and kept so moving it here stayed a pure refactor;
   * fixing #2459 means changing this method and {@link update}.
   */
  findById(id: string, chapterId: string): Promise<ChapterCustomField | null>;
  /** The highest `sort` in use in the chapter, or `null` when it has no fields. */
  findMaxSort(chapterId: string): Promise<number | null>;
  /** Throws {@link CustomFieldKeyConflictError} on a duplicate `key`. */
  create(data: Partial<ChapterCustomField>): Promise<ChapterCustomField>;
  /**
   * Insert an archetype's default fields for a new chapter (onboarding). A row
   * whose `(chapter_id, key)` already exists is skipped rather than overwritten
   * or failed, so re-running provisioning is a no-op — unlike {@link create},
   * where a duplicate is the officer's mistake and raises.
   */
  seedDefaults(rows: Partial<ChapterCustomField>[]): Promise<void>;
  /**
   * The updated row, or `null` when no row matched in the chapter. Like
   * {@link findById}, a failed write also returns `null` (#2459).
   */
  update(
    id: string,
    chapterId: string,
    patch: Partial<ChapterCustomField>,
  ): Promise<ChapterCustomField | null>;
  delete(id: string, chapterId: string): Promise<void>;
  /**
   * One member's values for `fieldIds`. The caller has already restricted
   * `fieldIds` to the chapter's fields the viewer may see, so this performs no
   * visibility check and no chapter filter of its own: a field id pins its
   * chapter, and the composite `(field_id, chapter_id)` foreign key keeps the
   * value row in it.
   */
  findValuesForMember(
    memberId: string,
    fieldIds: string[],
  ): Promise<{ field_id: string; value: string | null }[]>;
  /**
   * Every member's values for `fieldIds`, under the same contract as
   * {@link findValuesForMember}. An empty list returns `[]` without querying.
   */
  findValuesByFieldIds(
    fieldIds: string[],
  ): Promise<{ member_id: string; field_id: string; value: string | null }[]>;
}
