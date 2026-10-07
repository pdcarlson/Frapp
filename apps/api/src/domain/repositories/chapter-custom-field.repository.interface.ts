import type { ChapterCustomField } from '../entities/chapter-custom-field.entity';

export const CHAPTER_CUSTOM_FIELD_REPOSITORY =
  'CHAPTER_CUSTOM_FIELD_REPOSITORY';

/** `chapter_custom_fields`, the Settings → Fields definitions. */
export interface IChapterCustomFieldRepository {
  /**
   * Insert the archetype's default fields for a new chapter. A row whose
   * `(chapter_id, key)` already exists is skipped rather than overwritten or
   * failed, so re-running provisioning is a no-op.
   */
  seedDefaults(rows: Partial<ChapterCustomField>[]): Promise<void>;
}
