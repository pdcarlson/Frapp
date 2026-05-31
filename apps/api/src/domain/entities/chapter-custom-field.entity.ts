/**
 * A chapter-defined custom member field (Settings → Fields), persisted to
 * `chapter_custom_fields`. The Fields tab manages these via dedicated CRUD
 * endpoints; the configured `visibility`/`sensitive` flags are enforced when
 * the member directory renders the field values (Chunk 09, tracked separately).
 */
export type CustomFieldType =
  | 'text'
  | 'number'
  | 'decimal'
  | 'phone'
  | 'select'
  | 'boolean';

export type CustomFieldVisibility = 'self' | 'chapter' | 'exec' | 'president';

/** Type-specific configuration stored in the `options` jsonb column. */
export interface CustomFieldOptions {
  /** A `select` field's option list. */
  choices?: string[];
  /** An optional length cap for `text` fields. */
  max_length?: number;
}

export interface ChapterCustomField {
  id: string;
  chapter_id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  visibility: CustomFieldVisibility;
  sensitive: boolean;
  options: CustomFieldOptions | null;
  sort: number;
  created_at: string;
  updated_at: string;
}
