import { Test, TestingModule } from '@nestjs/testing';
import { AlumniController } from './alumni.controller';
import { MemberService } from '../../application/services/member.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { SystemPermissions } from '../../domain/constants/permissions';
import { RequirePermissions } from '../decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';

describe('AlumniController', () => {
  let controller: AlumniController;
  let memberService: jest.Mocked<MemberService>;

  beforeEach(async () => {
    memberService = {
      findAlumniByChapter: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AlumniController],
      providers: [{ provide: MemberService, useValue: memberService }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AlumniController>(AlumniController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('Guards and Decorators', () => {
    it('should have correct guards applied', () => {
      const guards = Reflect.getMetadata('__guards__', AlumniController);
      expect(guards).toBeDefined();
      expect(guards.length).toBe(3);
      expect(guards).toContain(SupabaseAuthGuard);
      expect(guards).toContain(ChapterGuard);
      expect(guards).toContain(PermissionsGuard);
    });

    it('should require MEMBERS_VIEW permission', () => {
      const requiredPermissions = Reflect.getMetadata('permissions', AlumniController);
      expect(requiredPermissions).toBeDefined();
      expect(requiredPermissions).toContain(SystemPermissions.MEMBERS_VIEW);
    });
  });

  describe('list', () => {
    const chapterId = 'chapter-123';
    const mockAlumni = [
      {
        id: 'member-1',
        user_id: 'user-1',
        display_name: 'John Doe',
        graduation_year: 2020,
      },
    ] as any;

    it('should call memberService.findAlumniByChapter with no filter when no query params are provided', async () => {
      memberService.findAlumniByChapter.mockResolvedValue(mockAlumni);

      const result = await controller.list(chapterId);

      expect(memberService.findAlumniByChapter).toHaveBeenCalledWith(chapterId, undefined);
      expect(result).toEqual(mockAlumni);
    });

    it('should parse graduation_year correctly', async () => {
      memberService.findAlumniByChapter.mockResolvedValue(mockAlumni);

      await controller.list(chapterId, '2020');

      expect(memberService.findAlumniByChapter).toHaveBeenCalledWith(chapterId, {
        graduation_year: 2020,
      });
    });

    it('should pass city and company filters correctly', async () => {
      memberService.findAlumniByChapter.mockResolvedValue(mockAlumni);

      await controller.list(chapterId, undefined, 'New York', 'Acme Corp');

      expect(memberService.findAlumniByChapter).toHaveBeenCalledWith(chapterId, {
        city: 'New York',
        company: 'Acme Corp',
      });
    });

    it('should pass all filters correctly', async () => {
      memberService.findAlumniByChapter.mockResolvedValue(mockAlumni);

      await controller.list(chapterId, '2020', 'New York', 'Acme Corp');

      expect(memberService.findAlumniByChapter).toHaveBeenCalledWith(chapterId, {
        graduation_year: 2020,
        city: 'New York',
        company: 'Acme Corp',
      });
    });

    it('should ignore empty strings for filters', async () => {
      memberService.findAlumniByChapter.mockResolvedValue(mockAlumni);

      await controller.list(chapterId, '', '', '');

      expect(memberService.findAlumniByChapter).toHaveBeenCalledWith(chapterId, undefined);
    });

    it('should ignore invalid graduation_year', async () => {
      memberService.findAlumniByChapter.mockResolvedValue(mockAlumni);

      await controller.list(chapterId, 'invalid-year');

      expect(memberService.findAlumniByChapter).toHaveBeenCalledWith(chapterId, undefined);
    });
  });
});
