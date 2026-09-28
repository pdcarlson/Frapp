import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { DiscordImportController } from './discord-import.controller';
import { DiscordImportService } from '../../application/services/discord-import.service';
import { RbacService } from '../../application/services/rbac.service';
import { SystemPermissions } from '#domain/constants/permissions';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';
const IMPORT_ID = '44444444-4444-4444-8444-444444444444';

/**
 * The two routes that can create roles and grant permissions (#2818). The
 * import itself is gated on `channels:manage`; `roles:manage` is resolved in
 * the handler for the CALLER, and the service decides whether the request
 * needs it. A wrong user, a wrong permission, or a hard-coded answer here
 * would let `channels:manage` alone create roles.
 */
describe('DiscordImportController — roles:manage is resolved for the caller (#2818)', () => {
  let controller: DiscordImportController;
  let importService: {
    setRoleMapping: jest.Mock;
    start: jest.Mock;
  };
  let rbacService: { memberHasAnyPermission: jest.Mock };

  beforeEach(async () => {
    importService = {
      setRoleMapping: jest.fn(async () => ({ id: IMPORT_ID })),
      start: jest.fn(async () => ({ id: IMPORT_ID })),
    };
    rbacService = { memberHasAnyPermission: jest.fn() };

    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [DiscordImportController],
      providers: [
        { provide: DiscordImportService, useValue: importService },
        { provide: RbacService, useValue: rbacService },
      ],
    }).compile();
    controller = module.get(DiscordImportController);
  });

  it.each([true, false])(
    'passes whether the caller holds roles:manage (%s) to the role mapping',
    async (holds) => {
      rbacService.memberHasAnyPermission.mockResolvedValue(holds);
      const roles = [
        {
          discord_role_id: '1',
          discord_role_name: 'Rush Chair',
          action: 'new' as const,
          new_role_name: 'Rush Chair',
        },
      ];

      await controller.setRoleMapping(IMPORT_ID, CHAPTER, USER, { roles });

      expect(rbacService.memberHasAnyPermission).toHaveBeenCalledWith(
        CHAPTER,
        USER,
        [SystemPermissions.ROLES_MANAGE],
      );
      expect(importService.setRoleMapping).toHaveBeenCalledWith(
        IMPORT_ID,
        CHAPTER,
        roles,
        holds,
      );
    },
  );

  it.each([true, false])(
    'passes whether the caller holds roles:manage (%s) to start',
    async (holds) => {
      rbacService.memberHasAnyPermission.mockResolvedValue(holds);

      await controller.start(IMPORT_ID, CHAPTER, USER);

      expect(rbacService.memberHasAnyPermission).toHaveBeenCalledWith(
        CHAPTER,
        USER,
        [SystemPermissions.ROLES_MANAGE],
      );
      expect(importService.start).toHaveBeenCalledWith(
        IMPORT_ID,
        CHAPTER,
        holds,
      );
    },
  );
});
