import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService } from '../../application/services/rbac.service';
import { UserService } from '../../application/services/user.service';
import { RequestWithUser } from '../auth.types';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private rbacService: RbacService,
    private userService: UserService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    const chapterId = request.headers['x-chapter-id'] as string;

    if (!user || !user.sub || !chapterId) {
      return false;
    }

    let internalUserId = request.internalUserId;
    if (!internalUserId) {
      const internalUser = await this.userService.findByClerkId(user.sub);
      internalUserId = internalUser.id;
    }

    const userPermissions = await this.rbacService.getPermissionsForUser(
      internalUserId,
      chapterId,
    );

    const hasPermission = requiredPermissions.every((permission) =>
      userPermissions.has(permission),
    );

    if (!hasPermission) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
