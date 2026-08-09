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

/**
 * A member's value for a custom field, joined with the field definition and
 * already filtered to the fields the requesting viewer may see (Chunk 09 — the
 * member directory renders these, enforcing `visibility` server-side).
 *
 * This is a **read projection**, not a table row — see
 * `MemberCustomFieldValueRow` below for the persisted shape.
 */
export interface MemberCustomFieldValue {
  field_id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  visibility: CustomFieldVisibility;
  value: string | null;
}

/**
 * The persisted row in `member_custom_field_values`
 * (`20260531120000_member_custom_field_values.sql`).
 *
 * Distinct from the `MemberCustomFieldValue` projection above, which carries
 * the joined field definition instead of the storage columns.
 *
 * `chapter_id` is redundant with the member's own chapter, but deliberately
 * so: it participates in both composite foreign keys
 * (`(member_id, chapter_id)` and `(field_id, chapter_id)`), which is what
 * closes the cross-chapter pairing hole at the database level.
 */
export interface MemberCustomFieldValueRow {
  id: string;
  chapter_id: string;
  member_id: string;
  field_id: string;
  value: string | null;
  created_at: string;
  updated_at: string;
}
