import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PostgrestError } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type {
  FrappSupabaseClient,
  TablesInsert,
  TablesUpdate,
} from '../../infrastructure/supabase/database.types';
import type {
  ChapterCustomField,
  CustomFieldVisibility,
  MemberCustomFieldValue,
} from '#domain/entities/chapter-custom-field.entity';
import type {
  CreateCustomFieldDto,
  UpdateCustomFieldDto,
} from '../../interface/dtos/custom-field.dto';

// Postgres unique-violation SQLSTATE (raised when (chapter_id, key) collides).
const UNIQUE_VIOLATION = '23505';

/** Shape of a Supabase row response after the (untyped) query builder. */
type RowResponse = {
  data: ChapterCustomField | null;
  error: PostgrestError | null;
};
type ListResponse = {
  data: ChapterCustomField[] | null;
  error: PostgrestError | null;
};
type ValuesResponse = {
  data: { field_id: string; value: string | null }[] | null;
  error: PostgrestError | null;
};
type MutateResponse = { error: PostgrestError | null };

/**
 * CRUD over `chapter_custom_fields`, scoped to the active chapter (Settings →
 * Fields). Part of the settings family: every mutation appends a
 * `chapter_audit_log` row (mirrored to `#chapter-audit` by the ChatBridgeWorker,
 * ADR-08) like every other settings save. The configured `visibility` /
 * `sensitive` flags are stored here and enforced server-side by
 * `findVisibleValuesForMember` when the member directory renders values.
 */
@Injectable()
export class CustomFieldService {
  private readonly logger = new Logger(CustomFieldService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<ChapterCustomField[]> {
    const { data, error }: ListResponse = await this.supabase
      .from('chapter_custom_fields')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('sort', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Return a member's custom-field values, restricted to the fields whose
   * `visibility` is in `allowed` (Chunk 09 — the member directory renders these
   * with server-side visibility enforcement). Starting from the (already
   * visibility-filtered) definitions means out-of-tier and `sensitive` field
   * values are never even looked up, so they cannot leak. Fields with no value
   * set for this member are returned with `value: null` so the directory can
   * render the full (visible) field set per chapter.
   */
  async findVisibleValuesForMember(
    chapterId: string,
    memberId: string,
    allowed: Set<CustomFieldVisibility>,
  ): Promise<MemberCustomFieldValue[]> {
    if (allowed.size === 0) return [];

    const { data: defs, error: defsError }: ListResponse = await this.supabase
      .from('chapter_custom_fields')
      .select('*')
      .eq('chapter_id', chapterId)
      .in('visibility', Array.from(allowed))
      .order('sort', { ascending: true })
      .order('created_at', { ascending: true });
    if (defsError) throw defsError;
    if (!defs || defs.length === 0) return [];

    // Restrict the value lookup to the already visibility-filtered field IDs so
    // out-of-tier / `sensitive` values are never even selected server-side —
    // not merely dropped after the fact (spec/behavior/members.md: values are
    // queried against the allowed tiers, never post-fetch scrubbed).
    const visibleFieldIds = defs.map((def) => def.id);
    const { data: values, error: valuesError }: ValuesResponse =
      await this.supabase
        .from('member_custom_field_values')
        .select('field_id, value')
        .eq('member_id', memberId)
        .in('field_id', visibleFieldIds);
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

  /**
   * Field ids + visibility for a chapter's fields whose `visibility` is in
   * `allowed`, with no value lookup — the search path (#579/#588) needs the
   * visibility tag alongside each id to scope `self`-tier matches to one
   * member, which {@link findVisibleValuesForMember}'s single-member shape
   * doesn't carry.
   */
  async findFieldIdsByVisibility(
    chapterId: string,
    allowed: Set<CustomFieldVisibility>,
  ): Promise<{ id: string; visibility: CustomFieldVisibility }[]> {
    if (allowed.size === 0) return [];

    const { data, error } = (await this.supabase
      .from('chapter_custom_fields')
      .select('id, visibility')
      .eq('chapter_id', chapterId)
      .in('visibility', Array.from(allowed))) as {
      data: { id: string; visibility: CustomFieldVisibility }[] | null;
      error: PostgrestError | null;
    };
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Raw `member_custom_field_values` rows for a set of field ids, across
   * every member holding one — the caller (search) already restricted
   * `fieldIds` to what the requesting viewer may see via
   * {@link findFieldIdsByVisibility}, so this performs no visibility check of
   * its own.
   */
  async findValuesByFieldIds(
    fieldIds: string[],
  ): Promise<{ member_id: string; field_id: string; value: string | null }[]> {
    if (!fieldIds.length) return [];

    const { data, error } = (await this.supabase
      .from('member_custom_field_values')
      .select('member_id, field_id, value')
      .in('field_id', fieldIds)) as {
      data:
        { member_id: string; field_id: string; value: string | null }[] | null;
      error: PostgrestError | null;
    };
    if (error) throw error;
    return data ?? [];
  }

  async create(
    chapterId: string,
    actorUserId: string,
    dto: CreateCustomFieldDto,
  ): Promise<ChapterCustomField> {
    // Defense-in-depth: a select field is meaningless without choices (the
    // shared zod schema enforces the same on the client/contract boundary).
    if (dto.type === 'select' && !(dto.options?.choices?.length ?? 0)) {
      throw new BadRequestException(
        'A select field requires a non-empty options.choices list',
      );
    }

    const row: TablesInsert<'chapter_custom_fields'> = {
      chapter_id: chapterId,
      key: dto.key,
      label: dto.label,
      type: dto.type,
      required: dto.required ?? false,
      visibility: dto.visibility ?? 'chapter',
      sensitive: dto.sensitive ?? false,
      // Options are deep-cloned so the persisted jsonb never shares a
      // reference with the request payload — each chapter owns its own
      // options list (spec: "options lists are deep-cloned per chapter").
      options: dto.options ? structuredClone(dto.options) : null,
      // Append, rather than default to 0. `findByChapter` orders by `sort` then
      // `created_at`, so a hardcoded 0 put every hand-added field *ahead* of the
      // archetype fields seeded at onboarding (#572) instead of at the bottom —
      // the Fields tab sends no `sort`, so that was every field an officer adds.
      sort: dto.sort ?? (await this.nextSort(chapterId)),
    };
    const { data, error }: RowResponse = await this.supabase
      .from('chapter_custom_fields')
      .insert(row)
      .select()
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        throw new ConflictException(
          'A custom field with this key already exists in this chapter',
        );
      }
      throw error;
    }

    const field = data as ChapterCustomField;
    await this.writeAudit(
      chapterId,
      actorUserId,
      'chapter_custom_field_created',
      field.id,
      {
        field: { from: null, to: field },
      },
    );
    return field;
  }

  async update(
    id: string,
    chapterId: string,
    actorUserId: string,
    dto: UpdateCustomFieldDto,
  ): Promise<ChapterCustomField> {
    const existing = await this.findOne(id, chapterId);

    // A `select` field must keep a non-empty choices list (same invariant
    // create() enforces). The shared zod schema can't check this — `type` is
    // immutable and absent from the update body — so guard it here when the
    // patch touches `options`.
    if (
      existing.type === 'select' &&
      dto.options !== undefined &&
      !(dto.options?.choices?.length ?? 0)
    ) {
      throw new BadRequestException(
        'A select field requires a non-empty options.choices list',
      );
    }

    // `key` and `type` are immutable — only presentation attrs and options are
    // patchable.
    const patch: TablesUpdate<'chapter_custom_fields'> = {};
    if (dto.label !== undefined) patch.label = dto.label;
    if (dto.required !== undefined) patch.required = dto.required;
    if (dto.visibility !== undefined) patch.visibility = dto.visibility;
    if (dto.sensitive !== undefined) patch.sensitive = dto.sensitive;
    if (dto.sort !== undefined) patch.sort = dto.sort;
    if (dto.options !== undefined) {
      // Deep-clone (or null) so the row never shares a reference with the
      // request payload — see the create() rationale.
      patch.options = dto.options ? structuredClone(dto.options) : null;
    }

    if (Object.keys(patch).length === 0) {
      return existing;
    }

    const { data, error }: RowResponse = await this.supabase
      .from('chapter_custom_fields')
      .update(patch)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Custom field not found');

    const field = data;
    await this.writeAudit(
      chapterId,
      actorUserId,
      'chapter_custom_field_updated',
      id,
      {
        field: { from: existing, to: field },
      },
    );
    return field;
  }

  async remove(
    id: string,
    chapterId: string,
    actorUserId: string,
  ): Promise<{ success: true }> {
    // Custom fields have no `core` concept (unlike custom roles) — every field
    // is deletable. We still resolve the row first so the audit diff captures
    // what was removed and a stray id 404s.
    const existing = await this.findOne(id, chapterId);

    const { error }: MutateResponse = await this.supabase
      .from('chapter_custom_fields')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw error;

    await this.writeAudit(
      chapterId,
      actorUserId,
      'chapter_custom_field_deleted',
      id,
      {
        field: { from: existing, to: null },
      },
    );
    return { success: true };
  }

  /**
   * Next free `sort` for a chapter — one past the highest in use, or 0 for a
   * chapter with no fields yet. Read-then-write rather than a DB-side default
   * because `sort` is chapter-scoped and freely reorderable; two fields racing
   * to the same value is a cosmetic tie that `created_at` already breaks.
   */
  private async nextSort(chapterId: string): Promise<number> {
    const { data, error } = (await this.supabase
      .from('chapter_custom_fields')
      .select('sort')
      .eq('chapter_id', chapterId)
      .order('sort', { ascending: false })
      .limit(1)
      .maybeSingle()) as {
      data: { sort: number } | null;
      error: PostgrestError | null;
    };
    if (error) throw error;
    return data ? data.sort + 1 : 0;
  }

  private async findOne(
    id: string,
    chapterId: string,
  ): Promise<ChapterCustomField> {
    const { data, error }: RowResponse = await this.supabase
      .from('chapter_custom_fields')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error || !data) throw new NotFoundException('Custom field not found');
    return data;
  }

  // Append-only audit trail. A failed write must fail the request — settings
  // changes are never silently unaudited (matches ChapterConfigService).
  private async writeAudit(
    chapterId: string,
    actorUserId: string,
    action: string,
    targetId: string,
    diff: Record<string, { from: unknown; to: unknown }>,
  ): Promise<void> {
    const audit: TablesInsert<'chapter_audit_log'> = {
      chapter_id: chapterId,
      actor_user_id: actorUserId,
      action,
      target_type: 'chapter_custom_field',
      // The field being changed — lets the audit log filter by entity.
      target_id: targetId,
      scope: 'chapter',
      diff,
      member_visible: true,
    };
    const { error }: MutateResponse = await this.supabase
      .from('chapter_audit_log')
      .insert(audit);
    if (error) {
      this.logger.error('Failed to write chapter audit log', error);
      throw error;
    }
  }
}
