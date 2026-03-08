import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
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
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const anyOfPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_ANY_KEY,
      [context.getHandler(), context.getClass()],
    );

    const permissionsToCheck = requiredPermissions?.length
      ? requiredPermissions
      : anyOfPermissions;
    const requireAll = !!requiredPermissions?.length;

    if (!permissionsToCheck || permissionsToCheck.length === 0) {
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

    const hasAccess = requireAll
      ? permissionsToCheck.every((p) => userPermissions.has(p))
      : permissionsToCheck.some((p) => userPermissions.has(p));

    if (!hasAccess) {
      throw new ForbiddenException(
        requireAll
          ? `Missing required permissions: ${permissionsToCheck.filter((p) => !userPermissions.has(p)).join(', ')}`
          : `Missing one of required permissions: ${permissionsToCheck.join(', ')}`,
      );
    }

    return true;
  }
}
