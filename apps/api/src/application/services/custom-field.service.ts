import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ChapterCustomField,
  CustomFieldVisibility,
  MemberCustomFieldValue,
} from '#domain/entities/chapter-custom-field.entity';
import {
  CUSTOM_FIELD_REPOSITORY,
  CustomFieldKeyConflictError,
  type ICustomFieldRepository,
} from '#domain/repositories/custom-field.repository.interface';
import type { CreateCustomField, UpdateCustomField } from '@repo/validation';
import {
  ChapterAuditLogService,
  type AuditDiff,
} from './chapter-audit-log.service';

/**
 * What `create` and `update` accept.
 *
 * Reused from `@repo/validation` rather than restated: `CreateCustomFieldSchema`
 * is what the web Fields tab already validates its POST body with, so binding
 * the service to the same declaration is what keeps the client's idea of the
 * payload and the server's from drifting. The interface layer's
 * `CreateCustomFieldDto` / `UpdateCustomFieldDto` remain the request-time
 * class-validator surface — the application layer may not import them
 * (dependency-cruiser `api-application-not-to-interface`), and
 * `CustomFieldController` is where the two meet. That call site checks
 * assignability, which is **one-directional**: it catches a field these types
 * require that a DTO stopped supplying, and it does not catch a field added to
 * a DTO and never added to the schema — that one validates on the wire and is
 * silently dropped before it reaches this service. Widen the schema and the DTO
 * together.
 */
export type CreateCustomFieldInput = CreateCustomField;
export type UpdateCustomFieldInput = UpdateCustomField;

/**
 * `chapter_audit_log.target_type` for every row this service writes. Paired
 * with the field id as `target_id`, it is what lets the audit log filter by
 * entity.
 */
const AUDIT_TARGET_TYPE = 'chapter_custom_field';

/**
 * CRUD over `chapter_custom_fields`, scoped to the active chapter (Settings →
 * Fields). Part of the settings family: every mutation appends a
 * `chapter_audit_log` row (mirrored to `#chapter-audit` by the ChatBridgeWorker,
 * ADR-08) like the other audited settings saves. The configured `visibility` /
 * `sensitive` flags are stored here and enforced server-side by
 * `findVisibleValuesForMember` when the member directory renders values.
 */
@Injectable()
export class CustomFieldService {
  constructor(
    @Inject(CUSTOM_FIELD_REPOSITORY)
    private readonly fields: ICustomFieldRepository,
    private readonly auditLog: ChapterAuditLogService,
  ) {}

  async findByChapter(chapterId: string): Promise<ChapterCustomField[]> {
    return this.fields.findByChapter(chapterId);
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

    const defs = await this.fields.findByVisibility(
      chapterId,
      Array.from(allowed),
    );
    if (defs.length === 0) return [];

    // Restrict the value lookup to the already visibility-filtered field IDs so
    // out-of-tier / `sensitive` values are never even selected server-side —
    // not merely dropped after the fact (spec/behavior/members.md: values are
    // queried against the allowed tiers, never post-fetch scrubbed).
    const visibleFieldIds = defs.map((def) => def.id);
    const values = await this.fields.findValuesForMember(
      memberId,
      visibleFieldIds,
    );

    const valueByFieldId = new Map(
      values.map((row) => [row.field_id, row.value]),
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
    return this.fields.findIdsByVisibility(chapterId, Array.from(allowed));
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
    return this.fields.findValuesByFieldIds(fieldIds);
  }

  async create(
    chapterId: string,
    actorUserId: string,
    dto: CreateCustomFieldInput,
  ): Promise<ChapterCustomField> {
    // Defense-in-depth: a select field is meaningless without choices (the
    // shared zod schema enforces the same on the client/contract boundary).
    if (dto.type === 'select' && !(dto.options?.choices?.length ?? 0)) {
      throw new BadRequestException(
        'A select field requires a non-empty options.choices list',
      );
    }

    const row: Partial<ChapterCustomField> = {
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
    let field: ChapterCustomField;
    try {
      field = await this.fields.create(row);
    } catch (error) {
      if (error instanceof CustomFieldKeyConflictError) {
        throw new ConflictException(
          'A custom field with this key already exists in this chapter',
        );
      }
      throw error;
    }

    await this.auditLog.record({
      chapterId,
      actorUserId,
      action: 'chapter_custom_field_created',
      targetType: AUDIT_TARGET_TYPE,
      targetId: field.id,
      diff: { field: { from: null, to: field } } satisfies AuditDiff,
    });
    return field;
  }

  async update(
    id: string,
    chapterId: string,
    actorUserId: string,
    dto: UpdateCustomFieldInput,
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
    const patch: Partial<ChapterCustomField> = {};
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

    const field = await this.fields.update(id, chapterId, patch);
    if (!field) throw new NotFoundException('Custom field not found');

    await this.auditLog.record({
      chapterId,
      actorUserId,
      action: 'chapter_custom_field_updated',
      targetType: AUDIT_TARGET_TYPE,
      targetId: id,
      diff: { field: { from: existing, to: field } } satisfies AuditDiff,
    });
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

    await this.fields.delete(id, chapterId);

    await this.auditLog.record({
      chapterId,
      actorUserId,
      action: 'chapter_custom_field_deleted',
      targetType: AUDIT_TARGET_TYPE,
      targetId: id,
      diff: { field: { from: existing, to: null } } satisfies AuditDiff,
    });
    return { success: true };
  }

  /**
   * Next free `sort` for a chapter — one past the highest in use, or 0 for a
   * chapter with no fields yet. Read-then-write rather than a DB-side default
   * because `sort` is chapter-scoped and freely reorderable; two fields racing
   * to the same value is a cosmetic tie that `created_at` already breaks.
   */
  private async nextSort(chapterId: string): Promise<number> {
    const max = await this.fields.findMaxSort(chapterId);
    return max === null ? 0 : max + 1;
  }

  private async findOne(
    id: string,
    chapterId: string,
  ): Promise<ChapterCustomField> {
    const field = await this.fields.findById(id, chapterId);
    if (!field) throw new NotFoundException('Custom field not found');
    return field;
  }
}
