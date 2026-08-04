import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PermissionsGuard } from './permissions.guard';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../decorators/permissions.decorator';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;
  let mockFrom: jest.Mock;

  const ACTIVE_CHAPTER = 'ch-1';

  const mockHandler = jest.fn();
  const mockControllerClass = jest.fn();

  interface RoleRow {
    id: string;
    chapter_id: string;
    permissions: string[];
  }

  interface CustomRoleRow {
    id: string;
    chapter_id: string;
    capabilities: string[];
  }

  const role = (
    id: string,
    permissions: string[],
    chapterId = ACTIVE_CHAPTER,
  ): RoleRow => ({ id, chapter_id: chapterId, permissions });

  const customRole = (
    id: string,
    capabilities: string[],
    chapterId = ACTIVE_CHAPTER,
  ): CustomRoleRow => ({ id, chapter_id: chapterId, capabilities });

  /**
   * Stands in for the PostgREST filter chain the guard builds on `roles`, and
   * filters rows the way the database would — by the ids in `.in('id', …)` and
   * by `.eq('chapter_id', …)`. Modelling the filters rather than returning a
   * fixed payload is what lets a test prove a foreign-chapter role id resolves
   * to no row at all.
   */
  const mockRoles = (rows: RoleRow[], customRows: CustomRoleRow[] = []) => {
    mockFrom.mockImplementation((table: string) => {
      let matched: Array<RoleRow | CustomRoleRow> =
        table === 'chapter_custom_roles' ? customRows : rows;
      const chain = {
        select: jest.fn(() => chain),
        in: jest.fn((column: 'id', values: string[]) => {
          matched = matched.filter((row) => values.includes(row[column]));
          return chain;
        }),
        eq: jest.fn((column: 'chapter_id', value: string) => {
          matched = matched.filter((row) => row[column] === value);
          return chain;
        }),
        then: (
          resolve: (result: {
            data: Array<RoleRow | CustomRoleRow>;
          }) => unknown,
        ) => resolve({ data: matched }),
      };
      return chain;
    });
  };

  /** Pass `null` for `chapterId` to model a request `ChapterGuard` never touched. */
  const mockExecutionContext = (
    member?: { role_ids: string[]; custom_role_ids?: string[] },
    chapterId: string | null = ACTIVE_CHAPTER,
  ): ExecutionContext => {
    const request = { member, chapterId: chapterId ?? undefined };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => mockHandler,
      getClass: () => mockControllerClass,
    } as unknown as ExecutionContext;
  };

  const mockPermissionMetadata = (opts: {
    handlerRequire?: string[];
    classRequire?: string[];
    handlerAny?: string[];
    classAny?: string[];
  }) => {
    jest.spyOn(reflector, 'get').mockImplementation((key, target) => {
      if (key === PERMISSIONS_KEY) {
        if (target === mockHandler) return opts.handlerRequire;
        if (target === mockControllerClass) return opts.classRequire;
      }
      if (key === PERMISSIONS_ANY_KEY) {
        if (target === mockHandler) return opts.handlerAny;
        if (target === mockControllerClass) return opts.classAny;
      }
      return undefined;
    });
  };

  beforeEach(async () => {
    mockFrom = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        Reflector,
        {
          provide: SUPABASE_CLIENT,
          useValue: { from: mockFrom },
        },
      ],
    }).compile();

    guard = module.get(PermissionsGuard);
    reflector = module.get(Reflector);
  });

  it('should allow access when no permissions are required', async () => {
    mockPermissionMetadata({});
    const ctx = mockExecutionContext();
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('merges handler- and class-level @RequirePermissions (must satisfy all)', async () => {
    mockPermissionMetadata({
      handlerRequire: ['polls:view_all'],
      classRequire: ['members:view'],
    });
    mockRoles([role('role-1', ['polls:view_all'])]);

    const ctx = mockExecutionContext({ role_ids: ['role-1'] });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('allows access when user has every merged @RequirePermissions', async () => {
    mockPermissionMetadata({
      handlerRequire: ['polls:view_all'],
      classRequire: ['members:view'],
    });
    mockRoles([role('role-1', ['polls:view_all', 'members:view'])]);

    const ctx = mockExecutionContext({ role_ids: ['role-1'] });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('should throw ForbiddenException when member has no roles', async () => {
    mockPermissionMetadata({ handlerRequire: ['events:create'] });
    const ctx = mockExecutionContext({ role_ids: [] });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should allow access with wildcard permission', async () => {
    mockPermissionMetadata({ handlerRequire: ['events:create'] });
    mockRoles([role('role-1', ['*'])]);

    const ctx = mockExecutionContext({ role_ids: ['role-1'] });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('should allow access when user has all required permissions', async () => {
    mockPermissionMetadata({
      handlerRequire: ['events:create', 'events:update'],
    });
    mockRoles([
      role('role-1', ['events:create', 'members:view']),
      role('role-2', ['events:update']),
    ]);

    const ctx = mockExecutionContext({ role_ids: ['role-1', 'role-2'] });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('should deny access when user is missing required permissions', async () => {
    mockPermissionMetadata({
      handlerRequire: ['events:create', 'billing:manage'],
    });
    mockRoles([role('role-1', ['events:create'])]);

    const ctx = mockExecutionContext({ role_ids: ['role-1'] });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should aggregate permissions from multiple roles', async () => {
    mockPermissionMetadata({
      handlerRequire: ['events:create', 'billing:view', 'members:view'],
    });
    mockRoles([
      role('role-1', ['events:create']),
      role('role-2', ['billing:view', 'members:view']),
    ]);

    const ctx = mockExecutionContext({ role_ids: ['role-1', 'role-2'] });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('requires each @RequireAnyOfPermissions level when both handler and class set it', async () => {
    mockPermissionMetadata({
      classAny: ['roles:manage', 'billing:manage'],
      handlerAny: ['events:create', 'events:update'],
    });
    mockRoles([role('role-1', ['roles:manage', 'events:create'])]);

    const ctx = mockExecutionContext({ role_ids: ['role-1'] });
    expect(await guard.canActivate(ctx)).toBe(true);
  });

  it('denies when only one of two any-of groups is satisfied', async () => {
    mockPermissionMetadata({
      classAny: ['roles:manage', 'billing:manage'],
      handlerAny: ['events:create', 'events:update'],
    });
    mockRoles([role('role-1', ['roles:manage'])]);

    const ctx = mockExecutionContext({ role_ids: ['role-1'] });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  describe('chapter scoping', () => {
    it('ignores a role id belonging to another chapter', async () => {
      // `members.role_ids` can carry a stale or cross-chapter id. Resolving it
      // must not pull in the other chapter's role — here a wildcard one.
      mockPermissionMetadata({ handlerRequire: ['events:create'] });
      mockRoles([
        role('role-foreign', ['*'], 'ch-other'),
        role('role-1', ['members:view']),
      ]);

      const ctx = mockExecutionContext({
        role_ids: ['role-foreign', 'role-1'],
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException('Missing required permissions: events:create'),
      );
    });

    it('denies when every role id belongs to another chapter', async () => {
      mockPermissionMetadata({ handlerRequire: ['events:create'] });
      mockRoles([role('role-foreign', ['*'], 'ch-other')]);

      const ctx = mockExecutionContext({ role_ids: ['role-foreign'] });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException('No valid roles found'),
      );
    });

    it('denies when the request carries no active chapter', async () => {
      mockPermissionMetadata({ handlerRequire: ['events:create'] });
      mockRoles([role('role-1', ['*'])]);

      const ctx = mockExecutionContext({ role_ids: ['role-1'] }, null);

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException('No active chapter'),
      );
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  // Bridge model (spec/behavior/rbac.md): custom-role capabilities flatten
  // into the same permission set the guard checks.
  describe('custom-role capabilities', () => {
    it('grants when a required permission comes from a custom role', async () => {
      mockPermissionMetadata({ handlerRequire: ['events:create'] });
      mockRoles(
        [role('role-1', ['members:view'])],
        [customRole('custom-1', ['events:create'])],
      );

      const ctx = mockExecutionContext({
        role_ids: ['role-1'],
        custom_role_ids: ['custom-1'],
      });

      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('grants a member holding only custom roles', async () => {
      mockPermissionMetadata({ handlerRequire: ['chapter_docs:upload'] });
      mockRoles([], [customRole('custom-1', ['chapter_docs:upload'])]);

      const ctx = mockExecutionContext({
        role_ids: [],
        custom_role_ids: ['custom-1'],
      });

      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('never honors a wildcard carried by a custom role', async () => {
      // Pre-validation rows may still contain `*`; only the live President
      // role may wield it, so the guard drops it from custom capabilities.
      mockPermissionMetadata({ handlerRequire: ['billing:manage'] });
      mockRoles([], [customRole('custom-evil', ['*', 'members:view'])]);

      const ctx = mockExecutionContext({
        role_ids: [],
        custom_role_ids: ['custom-evil'],
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException('Missing required permissions: billing:manage'),
      );
    });

    it('ignores a custom role id belonging to another chapter', async () => {
      mockPermissionMetadata({ handlerRequire: ['events:create'] });
      mockRoles(
        [role('role-1', ['members:view'])],
        [customRole('custom-foreign', ['events:create'], 'ch-other')],
      );

      const ctx = mockExecutionContext({
        role_ids: ['role-1'],
        custom_role_ids: ['custom-foreign'],
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException('Missing required permissions: events:create'),
      );
    });

    it('denies when every id (live and custom) resolves to another chapter', async () => {
      mockPermissionMetadata({ handlerRequire: ['events:create'] });
      mockRoles(
        [role('role-foreign', ['*'], 'ch-other')],
        [customRole('custom-foreign', ['events:create'], 'ch-other')],
      );

      const ctx = mockExecutionContext({
        role_ids: ['role-foreign'],
        custom_role_ids: ['custom-foreign'],
      });

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new ForbiddenException('No valid roles found'),
      );
    });
  });
});
