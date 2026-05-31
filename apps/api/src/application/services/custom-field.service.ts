import { Inject, Injectable } from '@nestjs/common';
import { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type {
  ChapterCustomField,
  CustomFieldVisibility,
  MemberCustomFieldValue,
} from '../../domain/entities/chapter-custom-field.entity';

type DefsResponse = {
  data: ChapterCustomField[] | null;
  error: PostgrestError | null;
};
type ValuesResponse = {
  data: { field_id: string; value: string | null }[] | null;
  error: PostgrestError | null;
};

/**
 * Read access to `chapter_custom_fields` (definitions) and a member's values in
 * `member_custom_field_values`. Write CRUD for the definitions (Settings →
 * Fields, #539) lands separately; this service only reads. Visibility for member
 * values is enforced server-side here — values outside the viewer's allowed
 * visibility set are never fetched (spec/behavior/members.md → Custom Fields).
 */
@Injectable()
export class CustomFieldService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  /** List a chapter's custom-field definitions, ordered for display. */
  async findByChapter(chapterId: string): Promise<ChapterCustomField[]> {
    const { data, error }: DefsResponse = await this.supabase
      .from('chapter_custom_fields')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('sort', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Return a member's custom-field values, restricted to the fields whose
   * `visibility` is in `allowed`. Starting from the (already visibility-filtered)
   * definitions means out-of-tier and `sensitive` field values are never even
   * looked up, so they cannot leak into the response. Fields with no value set
   * for this member are returned with `value: null` so the directory can render
   * the full (visible) field set per chapter.
   */
  async findVisibleValuesForMember(
    chapterId: string,
    memberId: string,
    allowed: Set<CustomFieldVisibility>,
  ): Promise<MemberCustomFieldValue[]> {
    if (allowed.size === 0) return [];

    const { data: defs, error: defsError }: DefsResponse = await this.supabase
      .from('chapter_custom_fields')
      .select('*')
      .eq('chapter_id', chapterId)
      .in('visibility', Array.from(allowed))
      .order('sort', { ascending: true });
    if (defsError) throw defsError;
    if (!defs || defs.length === 0) return [];

    const { data: values, error: valuesError }: ValuesResponse =
      await this.supabase
        .from('member_custom_field_values')
        .select('field_id, value')
        .eq('member_id', memberId);
    if (valuesError) throw valuesError;

    const valueByFieldId = new Map(
      (values ?? []).map((row) => [row.field_id, row.value]),
    );

    return defs.map((def) => ({
      field_id: def.id,
      key: def.key,
      label: def.label,
      type: def.type,
      visibility: def.visibility,
      value: valueByFieldId.get(def.id) ?? null,
    }));
  }
}
