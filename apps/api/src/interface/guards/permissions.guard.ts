import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Type,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PostgrestError } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { SupabaseQueryError } from '../../infrastructure/supabase/supabase-query-error';
import { InFlightLookups, lookupUnavailable } from './guard-lookup';
import {
  PERMISSIONS_KEY,
  PERMISSIONS_ANY_KEY,
} from '../decorators/permissions.decorator';
import { WILDCARD } from '#domain/constants/permissions';
import { flattenPermissionSets } from '#domain/utils/permissions';
import type { RequestContext } from '../types/request-context.types';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';

interface RolePermissionRow {
  permissions: string[];
}

interface CustomRoleCapabilityRow {
  capabilities: string[];
}

type RowsResult<Row> = { data: Row[] | null; error: PostgrestError | null };

/**
 * Concurrent requests from one member ask for the same role rows; they share
 * the read (#3728, `InFlightLookups` for the freshness bound). Keyed by the
 * chapter and the sorted id list, so two members share only when they ask for
 * exactly the same rows. Results are only read here, never put on a request.
 */
const roleLookups = new InFlightLookups<RowsResult<RolePermissionRow>>();
const customRoleLookups = new InFlightLookups<
  RowsResult<CustomRoleCapabilityRow>
>();

const lookupKey = (chapterId: string, ids: string[]): string =>
  `${chapterId}:${[...ids].sort().join(',')}`;

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controllerClass = context.getClass();

    const requiredPermissions = this.mergeUniquePermissionLists(
      this.reflector.get<string[]>(PERMISSIONS_KEY, handler),
      this.reflector.get<string[]>(PERMISSIONS_KEY, controllerClass),
    );

    const anyOfGroups = this.collectAnyOfPermissionGroups(
      handler as (...args: unknown[]) => unknown,
      controllerClass,
    );

    if (!requiredPermissions.length && !anyOfGroups?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestContext>();
    const member = request.member;
    const chapterId = request.chapterId;

    const roleIds = member?.role_ids ?? [];
    const customRoleIds = member?.custom_role_ids ?? [];

    if (!roleIds.length && !customRoleIds.length) {
      throw new ForbiddenException('No roles assigned');
    }

    // `ChapterGuard` always runs ahead of this guard and pins the active
    // chapter. Without one there is nothing to scope the lookup to, so deny
    // rather than resolve permissions across every chapter's roles.
    if (!chapterId) {
      throw new ForbiddenException('No active chapter');
    }

    // Both role models are chapter-scoped, so filter on the active chapter as
    // well as the id list: a stale or cross-chapter id left on the member row
    // then resolves to no row instead of silently granting that other
    // chapter's permissions here.
    const [rolesResult, customRolesResult] = await Promise.all([
      roleIds.length
        ? roleLookups.run(
            lookupKey(chapterId, roleIds),
            () =>
              this.supabase
                .from('roles')
                .select('permissions')
                .in('id', roleIds)
                .eq('chapter_id', chapterId) as PromiseLike<
                RowsResult<RolePermissionRow>
              >,
          )
        : Promise.resolve<RowsResult<RolePermissionRow>>({
            data: [],
            error: null,
          }),
      customRoleIds.length
        ? customRoleLookups.run(
            lookupKey(chapterId, customRoleIds),
            () =>
              this.supabase
                .from('chapter_custom_roles')
                .select('capabilities')
                .in('id', customRoleIds)
                .eq('chapter_id', chapterId) as PromiseLike<
                RowsResult<CustomRoleCapabilityRow>
              >,
          )
        : Promise.resolve<RowsResult<CustomRoleCapabilityRow>>({
            data: [],
            error: null,
          }),
    ]);

    // A failed lookup must surface as a server fault, not a permission
    // denial — otherwise a transient DB error reads as a terminal 403. A 503,
    // like the auth and chapter guards' (#3143), so clients retry it. The
    // query error rides along as the cause, so Sentry gets its code and the
    // query's stack (#1264); the client still gets only the generic body.
    const lookupError = rolesResult.error ?? customRolesResult.error;
    if (lookupError) {
      throw lookupUnavailable(
        'Failed to resolve permissions',
        new SupabaseQueryError(lookupError),
      );
    }
    const roles = rolesResult.data;
    const customRoles = customRolesResult.data;

    if (!roles?.length && !customRoles?.length) {
      throw new ForbiddenException('No valid roles found');
    }

    const userPermissions = flattenPermissionSets(
      (roles ?? []).map((role) => role.permissions),
      (customRoles ?? []).map((row) => row.capabilities),
    );

    if (userPermissions.has(WILDCARD)) {
      return true;
    }

    if (requiredPermissions.length > 0) {
      const missing = requiredPermissions.filter(
        (p) => !userPermissions.has(p),
      );
      if (missing.length > 0) {
        throw new ForbiddenException(
          `Missing required permissions: ${missing.join(', ')}`,
        );
      }
    }

    if (anyOfGroups?.length) {
      for (const group of anyOfGroups) {
        const satisfied = group.some((p) => userPermissions.has(p));
        if (!satisfied) {
          throw new ForbiddenException(
            `Missing one of required permissions: ${group.join(', ')}`,
          );
        }
      }
    }

    return true;
  }

  /** Union of class- and handler-level `@RequirePermissions` (order preserved, de-duplicated). */
  private mergeUniquePermissionLists(a?: string[], b?: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const list of [a, b]) {
      if (!list?.length) continue;
      for (const p of list) {
        if (!seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
      }
    }
    return out;
  }

  /**
   * When `@RequireAnyOfPermissions` appears on both handler and class, each level is a separate
   * OR-group; the caller must satisfy every group (AND of ORs). A single level is one group.
   */
  private collectAnyOfPermissionGroups(
    handler: (...args: unknown[]) => unknown,
    controllerClass: Type<unknown>,
  ): string[][] | undefined {
    const handlerAny = this.reflector.get<string[]>(
      PERMISSIONS_ANY_KEY,
      handler,
    );
    const classAny = this.reflector.get<string[]>(
      PERMISSIONS_ANY_KEY,
      controllerClass,
    );
    const groups: string[][] = [];
    if (handlerAny?.length) groups.push(handlerAny);
    if (classAny?.length) groups.push(classAny);
    return groups.length ? groups : undefined;
  }
}
