import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import type { ChapterCustomRole } from '#domain/entities/chapter-custom-role.entity';
import { WILDCARD } from '#domain/constants/permissions';
import type {
  CreateCustomRoleDto,
  UpdateCustomRoleDto,
} from '../../interface/dtos/custom-role.dto';

// Postgres unique-violation SQLSTATE (raised when (chapter_id, key) collides).
const UNIQUE_VIOLATION = '23505';

/** Shape of a Supabase row response after the (untyped) query builder. */
type RowResponse = {
  data: ChapterCustomRole | null;
  error: PostgrestError | null;
};
type ListResponse = {
  data: ChapterCustomRole[] | null;
  error: PostgrestError | null;
};
type MutateResponse = { error: PostgrestError | null };

/**
 * CRUD over `chapter_custom_roles`, scoped to the active chapter. Part of the
 * settings family: every mutation appends a `chapter_audit_log` row (mirrored to
 * `#chapter-audit` by the ChatBridgeWorker, ADR-08) like every other settings
 * save. Custom roles are enforced (bridge model, spec/behavior/rbac.md):
 * members are assigned via `members.custom_role_ids` and the permission
 * resolver flattens `capabilities` into the effective set, so writes here take
 * effect on the next request. The wildcard `*` is rejected on write — only the
 * live President role may carry it.
 */
@Injectable()
export class CustomRoleService {
  private readonly logger = new Logger(CustomRoleService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async findByChapter(chapterId: string): Promise<ChapterCustomRole[]> {
    const { data, error }: ListResponse = await this.supabase
      .from('chapter_custom_roles')
      .select('*')
      .eq('chapter_id', chapterId)
      .order('rank', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Rows for `ids` filtered to `chapterId`, for the permission resolver and
   * member-assignment validation. A stale or cross-chapter id matches no row
   * and contributes nothing (same contract as `roles` lookups).
   */
  async findByIds(
    ids: string[],
    chapterId: string,
  ): Promise<ChapterCustomRole[]> {
    if (!ids.length) return [];
    const { data, error }: ListResponse = await this.supabase
      .from('chapter_custom_roles')
      .select('*')
      .in('id', ids)
      .eq('chapter_id', chapterId);
    if (error) throw error;
    return data ?? [];
  }

  async create(
    chapterId: string,
    actorUserId: string,
    dto: CreateCustomRoleDto,
  ): Promise<ChapterCustomRole> {
    this.assertNoWildcard(dto.capabilities);
    const row: TablesInsert<'chapter_custom_roles'> = {
      chapter_id: chapterId,
      key: dto.key,
      label: dto.label,
      rank: dto.rank ?? 99,
      capabilities: dto.capabilities ?? [],
      // `core` is never client-settable: only system seeding marks a role
      // core (and core roles can't be deleted). User-created roles are
      // always non-core so they remain deletable.
      core: false,
    };
    const { data, error }: RowResponse = await this.supabase
      .from('chapter_custom_roles')
      .insert(row)
      .select()
      .single();

    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        throw new ConflictException(
          'A custom role with this key already exists in this chapter',
        );
      }
      throw error;
    }

    const role = data as ChapterCustomRole;
    await this.writeAudit(
      chapterId,
      actorUserId,
      'chapter_custom_role_created',
      role.id,
      {
        role: { from: null, to: role },
      },
    );
    return role;
  }

  async update(
    id: string,
    chapterId: string,
    actorUserId: string,
    dto: UpdateCustomRoleDto,
  ): Promise<ChapterCustomRole> {
    this.assertNoWildcard(dto.capabilities);
    const existing = await this.findOne(id, chapterId);

    const patch: TablesUpdate<'chapter_custom_roles'> = {};
    if (dto.label !== undefined) patch.label = dto.label;
    if (dto.rank !== undefined) patch.rank = dto.rank;
    if (dto.capabilities !== undefined) patch.capabilities = dto.capabilities;

    if (Object.keys(patch).length === 0) {
      return existing;
    }

    const { data, error }: RowResponse = await this.supabase
      .from('chapter_custom_roles')
      .update(patch)
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .select()
      .single();
    if (error || !data) throw new NotFoundException('Custom role not found');

    const role = data;
    await this.writeAudit(
      chapterId,
      actorUserId,
      'chapter_custom_role_updated',
      id,
      {
        role: { from: existing, to: role },
      },
    );
    return role;
  }

  async remove(
    id: string,
    chapterId: string,
    actorUserId: string,
  ): Promise<{ success: true }> {
    const existing = await this.findOne(id, chapterId);
    if (existing.core) {
      throw new ForbiddenException('Core roles cannot be deleted');
    }

    const { error }: MutateResponse = await this.supabase
      .from('chapter_custom_roles')
      .delete()
      .eq('id', id)
      .eq('chapter_id', chapterId);
    if (error) throw error;

    await this.writeAudit(
      chapterId,
      actorUserId,
      'chapter_custom_role_deleted',
      id,
      {
        role: { from: existing, to: null },
      },
    );
    return { success: true };
  }

  // Custom-role capabilities enter the permission-check flatten, and `*` there
  // would mint a second wildcard holder outside the presidency-transfer flow —
  // the one invariant spec/behavior/rbac.md reserves for the President role.
  private assertNoWildcard(capabilities?: string[]): void {
    if (capabilities?.includes(WILDCARD)) {
      throw new BadRequestException(
        'Custom roles cannot carry the wildcard (*) permission; use the presidency-transfer flow instead',
      );
    }
  }

  private async findOne(
    id: string,
    chapterId: string,
  ): Promise<ChapterCustomRole> {
    const { data, error }: RowResponse = await this.supabase
      .from('chapter_custom_roles')
      .select('*')
      .eq('id', id)
      .eq('chapter_id', chapterId)
      .maybeSingle();
    if (error || !data) throw new NotFoundException('Custom role not found');
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
      target_type: 'chapter_custom_role',
      // The role being changed — lets the audit log filter by entity.
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
