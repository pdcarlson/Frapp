import { Test, TestingModule } from '@nestjs/testing';
import { RbacService } from './rbac.service';
import { RBAC_REPOSITORY } from '../../domain/repositories/rbac.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';

describe('RbacService', () => {
  let service: RbacService;
  let rbacRepo: {
    findRolesByIds: jest.Mock;
    createRole: jest.Mock;
  };
  let memberRepo: {
    findByUserAndChapter: jest.Mock;
  };

  const mockRbacRepo = {
    findRolesByIds: jest.fn(),
    createRole: jest.fn(),
  };

  const mockMemberRepo = {
    findByUserAndChapter: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RbacService,
        { provide: RBAC_REPOSITORY, useValue: mockRbacRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
      ],
    }).compile();

    service = module.get<RbacService>(RbacService);
    rbacRepo = mockRbacRepo;
    memberRepo = mockMemberRepo;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getPermissionsForUser', () => {
    it('should return unique permissions from user roles', async () => {
      const userId = 'u1';
      const chapterId = 'c1';
      const roleIds = ['r1', 'r2'];

      memberRepo.findByUserAndChapter.mockResolvedValue({ roleIds });
      rbacRepo.findRolesByIds.mockResolvedValue([
        { permissions: ['p1', 'p2'] },
        { permissions: ['p2', 'p3'] },
      ]);

      const permissions = await service.getPermissionsForUser(
        userId,
        chapterId,
      );
      expect(permissions).toEqual(new Set(['p1', 'p2', 'p3']));
    });

    it('should return empty set if no member found', async () => {
      memberRepo.findByUserAndChapter.mockResolvedValue(null);
      const permissions = await service.getPermissionsForUser('u1', 'c1');
      expect(permissions.size).toBe(0);
    });
  });

  describe('createRole', () => {
    it('should create a role using the repository', async () => {
      const chapterId = 'c1';
      const name = 'Admin';
      const permissions = ['p1'];
      const mockRole = {
        id: 'r1',
        chapterId,
        name,
        permissions,
        isSystem: false,
      };

      rbacRepo.createRole.mockResolvedValue(mockRole);

      const result = await service.createRole(chapterId, name, permissions);

      expect(rbacRepo.createRole).toHaveBeenCalledWith({
        chapterId,
        name,
        permissions,
        isSystem: false,
      });
      expect(result).toEqual(mockRole);
    });
  });
});
