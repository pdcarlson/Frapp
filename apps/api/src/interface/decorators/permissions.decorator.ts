import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const PERMISSIONS_ANY_KEY = 'permissions_any';

export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const RequireAnyOfPermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_ANY_KEY, permissions);
