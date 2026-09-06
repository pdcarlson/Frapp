import { Test, TestingModule } from '@nestjs/testing';
import { RbacController } from './rbac.controller';
import { RbacService } from '../../application/services/rbac.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SystemPermissions } from '#domain/constants/permissions';
import {
  CreateRoleDto,
  UpdateRoleDto,
  TransferPresidencyDto,
} from '../dtos/rbac.dto';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

describe('RbacController', () => {
  let controller: RbacController;
  let rbacService: jest.Mocked<RbacService>;

  beforeEach(async () => {
    rbacService = {
      findByChapter: jest.fn(),
      getPermissionsCatalog: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      transferPresidency: jest.fn(),
      getPresidencyClaimStatus: jest.fn(),
      claimPresidency: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RbacController],
      providers: [{ provide: RbacService, useValue: rbacService }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RbacController>(RbacController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('list', () => {
    it('should list chapter roles', async () => {
      const chapterId = 'chapter-1';
      const expectedRoles = [{ id: 'role-1' }] as any;
      rbacService.findByChapter.mockResolvedValue(expectedRoles);

      const result = await controller.list(chapterId);

      expect(rbacService.findByChapter).toHaveBeenCalledWith(chapterId);
      expect(result).toEqual(expectedRoles);
    });
  });

  describe('catalog', () => {
    it('should return system permissions catalog', () => {
      const expectedCatalog = [{ key: 'WILDCARD', permission: '*' }] as any;
      rbacService.getPermissionsCatalog.mockReturnValue(expectedCatalog);

      const result = controller.catalog();

      expect(rbacService.getPermissionsCatalog).toHaveBeenCalled();
      expect(result).toEqual(expectedCatalog);
    });
  });

  describe('create', () => {
    it('should create a custom role', async () => {
      const chapterId = 'chapter-1';
      const dto: CreateRoleDto = {
        name: 'Custom Role',
        permissions: [SystemPermissions.EVENTS_CREATE],
      };
      const expectedRole = { id: 'role-1', ...dto } as any;
      rbacService.create.mockResolvedValue(expectedRole);

      const result = await controller.create(chapterId, dto);

      expect(rbacService.create).toHaveBeenCalledWith(chapterId, dto);
      expect(result).toEqual(expectedRole);
    });

    it('should require ROLES_MANAGE permission', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.create,
      );
      expect(permissions).toEqual([SystemPermissions.ROLES_MANAGE]);
    });
  });

  describe('update', () => {
    it('should update a role', async () => {
      const roleId = 'role-1';
      const chapterId = 'chapter-1';
      const dto: UpdateRoleDto = { name: 'Updated Role' };
      const expectedRole = { id: roleId, ...dto } as any;
      rbacService.update.mockResolvedValue(expectedRole);

      const result = await controller.update(roleId, chapterId, dto);

      expect(rbacService.update).toHaveBeenCalledWith(roleId, chapterId, dto);
      expect(result).toEqual(expectedRole);
    });

    it('should require ROLES_MANAGE permission', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.update,
      );
      expect(permissions).toEqual([SystemPermissions.ROLES_MANAGE]);
    });
  });

  describe('delete', () => {
    it('should delete a custom role', async () => {
      const roleId = 'role-1';
      const chapterId = 'chapter-1';
      rbacService.delete.mockResolvedValue(undefined);

      const result = await controller.delete(roleId, chapterId);

      expect(rbacService.delete).toHaveBeenCalledWith(roleId, chapterId);
      expect(result).toEqual({ success: true });
    });

    it('should require ROLES_MANAGE permission', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.delete,
      );
      expect(permissions).toEqual([SystemPermissions.ROLES_MANAGE]);
    });
  });

  describe('transferPresidency', () => {
    it('should transfer presidency to another member', async () => {
      const chapterId = 'chapter-1';
      const currentMember = { id: 'member-1' };
      const dto: TransferPresidencyDto = { target_member_id: 'member-2' };
      rbacService.transferPresidency.mockResolvedValue(undefined);

      const result = await controller.transferPresidency(
        chapterId,
        currentMember,
        dto,
      );

      expect(rbacService.transferPresidency).toHaveBeenCalledWith(
        chapterId,
        currentMember.id,
        dto.target_member_id,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('presidencyClaimStatus', () => {
    it('returns the claim status for the current member', async () => {
      const chapterId = 'chapter-1';
      const member = { id: 'member-1' };
      const status = {
        needs_president: true,
        eligible: true,
        next_role_name: 'Treasurer',
      };
      rbacService.getPresidencyClaimStatus.mockResolvedValue(status as any);

      const result = await controller.presidencyClaimStatus(chapterId, member);

      expect(rbacService.getPresidencyClaimStatus).toHaveBeenCalledWith(
        chapterId,
        member.id,
      );
      expect(result).toEqual(status);
    });
  });

  describe('claimPresidency', () => {
    it('claims the presidency for the current member', async () => {
      const chapterId = 'chapter-1';
      const member = { id: 'member-1' };
      rbacService.claimPresidency.mockResolvedValue(undefined);

      const result = await controller.claimPresidency(chapterId, member);

      expect(rbacService.claimPresidency).toHaveBeenCalledWith(
        chapterId,
        member.id,
      );
      expect(result).toEqual({ success: true });
    });
  });
});
