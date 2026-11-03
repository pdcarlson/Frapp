import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ChapterCustomRole } from '#domain/entities/chapter-custom-role.entity';
import { WILDCARD } from '#domain/constants/permissions';
import {
  CUSTOM_ROLE_REPOSITORY,
  CustomRoleKeyConflictError,
  type ICustomRoleRepository,
} from '#domain/repositories/custom-role.repository.interface';
import type { CreateCustomRole, UpdateCustomRole } from '@repo/validation';
import {
  ChapterAuditLogService,
  type AuditDiff,
} from './chapter-audit-log.service';

/**
 * What `create` and `update` accept.
 *
 * Reused from `@repo/validation` rather than restated: `CreateCustomRoleSchema`
 * is what the web Roles tab already validates its POST body with, so binding the
 * service to the same declaration is what keeps the client's idea of the payload
 * and the server's from drifting — `ROLE_KEY_MAX_LENGTH` / `ROLE_NAME_MAX_LENGTH`
 * are already shared from that package into `custom-role.dto.ts`, so the limits
 * were single-sourced while the shape was not. The interface layer's
 * `CreateCustomRoleDto` / `UpdateCustomRoleDto` remain the request-time
 * class-validator surface — the application layer may not import them
 * (dependency-cruiser `api-application-not-to-interface`), and
 * `CustomRoleController` is where the two meet. That call site checks
 * assignability, which is **one-directional**: it catches a field these types
 * require that a DTO stopped supplying, and it does not catch a field added to a
 * DTO and never added to the schema — that one validates on the wire and is
 * silently dropped before it reaches this service. Widen the schema and the DTO
 * together.
 */
export type CreateCustomRoleInput = CreateCustomRole;
export type UpdateCustomRoleInput = UpdateCustomRole;

/**
 * `chapter_audit_log.target_type` for every row this service writes. Paired
 * with the role id as `target_id`, it is what lets the audit log filter by
 * entity.
 */
const AUDIT_TARGET_TYPE = 'chapter_custom_role';

/**
 * CRUD over `chapter_custom_roles`, scoped to the active chapter. Part of the
 * settings family: every mutation appends a `chapter_audit_log` row (mirrored to
 * `#chapter-audit` by the ChatBridgeWorker, ADR-08) like the other audited
 * settings saves. Custom roles are enforced (bridge model, spec/behavior/rbac.md):
 * members are assigned via `members.custom_role_ids` and the permission
 * resolver flattens `capabilities` into the effective set, so writes here take
 * effect on the next request. The wildcard `*` is rejected on write — only the
 * live President role may carry it.
 */
@Injectable()
export class CustomRoleService {
  constructor(
    @Inject(CUSTOM_ROLE_REPOSITORY)
    private readonly roles: ICustomRoleRepository,
    private readonly auditLog: ChapterAuditLogService,
  ) {}

  async findByChapter(chapterId: string): Promise<ChapterCustomRole[]> {
    return this.roles.findByChapter(chapterId);
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
    return this.roles.findByIds(ids, chapterId);
  }

  async create(
    chapterId: string,
    actorUserId: string,
    dto: CreateCustomRoleInput,
  ): Promise<ChapterCustomRole> {
    this.assertNoWildcard(dto.capabilities);
    const row: Partial<ChapterCustomRole> = {
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
    let role: ChapterCustomRole;
    try {
      role = await this.roles.create(row);
    } catch (error) {
      if (error instanceof CustomRoleKeyConflictError) {
        throw new ConflictException(
          'A custom role with this key already exists in this chapter',
        );
      }
      throw error;
    }

    await this.auditLog.record({
      chapterId,
      actorUserId,
      action: 'chapter_custom_role_created',
      targetType: AUDIT_TARGET_TYPE,
      targetId: role.id,
      diff: { role: { from: null, to: role } } satisfies AuditDiff,
    });
    return role;
  }

  async update(
    id: string,
    chapterId: string,
    actorUserId: string,
    dto: UpdateCustomRoleInput,
  ): Promise<ChapterCustomRole> {
    this.assertNoWildcard(dto.capabilities);
    const existing = await this.findOne(id, chapterId);

    const patch: Partial<ChapterCustomRole> = {};
    if (dto.label !== undefined) patch.label = dto.label;
    if (dto.rank !== undefined) patch.rank = dto.rank;
    if (dto.capabilities !== undefined) patch.capabilities = dto.capabilities;

    if (Object.keys(patch).length === 0) {
      return existing;
    }

    const role = await this.roles.update(id, chapterId, patch);
    if (!role) throw new NotFoundException('Custom role not found');

    await this.auditLog.record({
      chapterId,
      actorUserId,
      action: 'chapter_custom_role_updated',
      targetType: AUDIT_TARGET_TYPE,
      targetId: id,
      diff: { role: { from: existing, to: role } } satisfies AuditDiff,
    });
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

    await this.roles.delete(id, chapterId);

    await this.auditLog.record({
      chapterId,
      actorUserId,
      action: 'chapter_custom_role_deleted',
      targetType: AUDIT_TARGET_TYPE,
      targetId: id,
      diff: { role: { from: existing, to: null } } satisfies AuditDiff,
    });
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
    const role = await this.roles.findById(id, chapterId);
    if (!role) throw new NotFoundException('Custom role not found');
    return role;
  }
}
