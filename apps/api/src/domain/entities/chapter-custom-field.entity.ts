/**
 * A chapter-defined custom member field (Settings → Fields). The definition
 * lives in `chapter_custom_fields`; each member's value lives in
 * `member_custom_field_values`. `visibility` gates who may see a member's value
 * for this field and is enforced server-side when rendering the member
 * directory (spec/behavior/members.md → Custom Fields).
 */
export type CustomFieldType =
  | 'text'
  | 'number'
  | 'decimal'
  | 'phone'
  | 'select'
  | 'boolean';

export type CustomFieldVisibility = 'self' | 'chapter' | 'exec' | 'president';

export interface ChapterCustomField {
  id: string;
  chapter_id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  visibility: CustomFieldVisibility;
  sensitive: boolean;
  options: string[] | null;
  sort: number;
  created_at: string;
  updated_at: string;
}

/**
 * A member's value for a custom field, joined with the field definition and
 * already filtered to the fields the requesting viewer may see.
 */
export interface MemberCustomFieldValue {
  field_id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  visibility: CustomFieldVisibility;
  value: string | null;
}
