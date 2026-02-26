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
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

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

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
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

    const userPermissions = new Set(roles.flatMap((r) => r.permissions));

    if (userPermissions.has('*')) {
      return true;
    }

    const hasAll = requiredPermissions.every((p) => userPermissions.has(p));
    if (!hasAll) {
      throw new ForbiddenException(
        `Missing required permissions: ${requiredPermissions.filter((p) => !userPermissions.has(p)).join(', ')}`,
      );
    }

    return true;
  }
}
