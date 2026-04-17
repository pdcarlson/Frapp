import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  type Type,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  PERMISSIONS_KEY,
  PERMISSIONS_ANY_KEY,
} from '../decorators/permissions.decorator';
import type { RequestContext } from '../types/request-context.types';

interface RolePermissionRow {
  permissions: string[];
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controllerClass = context.getClass();

    const requiredPermissions = this.mergeUniquePermissionLists(
      this.reflector.get<string[]>(PERMISSIONS_KEY, handler),
      this.reflector.get<string[]>(PERMISSIONS_KEY, controllerClass),
    );

    const anyOfGroups = this.collectAnyOfPermissionGroups(
      handler,
      controllerClass,
    );

    if (!requiredPermissions.length && !anyOfGroups?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestContext>();
    const member = request.member;

    if (!member?.role_ids?.length) {
      throw new ForbiddenException('No roles assigned');
    }

    const { data: roles } = await this.supabase
      .from('roles')
      .select('permissions')
      .in('id', member.role_ids);

    if (!roles?.length) {
      throw new ForbiddenException('No valid roles found');
    }

    const userPermissions = new Set(
      (roles as RolePermissionRow[]).flatMap((role) => role.permissions),
    );

    if (userPermissions.has('*')) {
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
    handler: Type<unknown> | Function,
    controllerClass: Type<unknown> | Function,
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
