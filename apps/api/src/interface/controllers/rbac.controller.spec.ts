/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { RbacController } from './rbac.controller';
import { RbacService } from '../../application/services/rbac.service';
import { ClerkAuthGuard } from '../guards/clerk-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { CreateRoleDto } from '../dtos/rbac.dto';
import { PERMISSIONS } from '../../domain/constants/permissions';

describe('RbacController', () => {
  let controller: RbacController;
  let service: RbacService;

  const mockRbacService = {
    createRole: jest.fn(),
    getRolesForChapter: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RbacController],
      providers: [{ provide: RbacService, useValue: mockRbacService }],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RbacController>(RbacController);
    service = module.get<RbacService>(RbacService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('POST /roles should call service.createRole', async () => {
    const dto: CreateRoleDto = { name: 'Admin', permissions: ['p1'] };
    const chapterId = 'c1';
    await controller.createRole(chapterId, dto);
    expect(service.createRole).toHaveBeenCalledWith(
      chapterId,
      dto.name,
      dto.permissions,
    );
  });

  it('GET /roles should call service.getRolesForChapter', async () => {
    const chapterId = 'c1';
    await controller.getRoles(chapterId);
    expect(service.getRolesForChapter).toHaveBeenCalledWith(chapterId);
  });

  it('GET /permissions should return all permissions', () => {
    const result = controller.getPermissions();
    expect(result).toEqual(Object.values(PERMISSIONS));
  });
});
