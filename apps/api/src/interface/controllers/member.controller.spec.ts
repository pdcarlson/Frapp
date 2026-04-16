import { Test, TestingModule } from '@nestjs/testing';
import { MemberController } from './member.controller';
import { MemberService } from '../../application/services/member.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { UpdateMemberRolesDto, UpdateOnboardingDto } from '../dtos/member.dto';

describe('MemberController', () => {
  let controller: MemberController;
  let memberService: jest.Mocked<MemberService>;

  beforeEach(async () => {
    memberService = {
      findProfilesByChapter: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findProfileById: jest.fn(),
      searchByChapterAndName: jest.fn(),
      findAlumniByChapter: jest.fn(),
      updateRoles: jest.fn(),
      updateOnboarding: jest.fn(),
      remove: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MemberController],
      providers: [{ provide: MemberService, useValue: memberService }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(MemberController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('list', () => {
    it('returns chapter member profiles', async () => {
      const chapterId = 'chapter-1';
      const expectedResult = [
        {
          id: 'member-1',
          user_id: 'user-1',
          chapter_id: chapterId,
          role_ids: ['role-president'],
          has_completed_onboarding: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
          display_name: 'Jordan M.',
          avatar_url: null,
          bio: null,
          graduation_year: null,
          current_city: null,
          current_company: null,
          email: 'jordan@example.com',
        },
      ] as any;

      memberService.findProfilesByChapter.mockResolvedValue(expectedResult);

      const result = await controller.list(chapterId);

      expect(memberService.findProfilesByChapter).toHaveBeenCalledWith(
        chapterId,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('search', () => {
    it('forwards chapter-scoped search queries', async () => {
      memberService.searchByChapterAndName.mockResolvedValue([] as any);

      await controller.search('chapter-1', 'jordan');

      expect(memberService.searchByChapterAndName).toHaveBeenCalledWith(
        'chapter-1',
        'jordan',
      );
    });
  });

  describe('getOne', () => {
    it('loads a single member profile', async () => {
      const profile = {
        id: 'member-1',
        display_name: 'Jordan M.',
      } as any;
      memberService.findProfileById.mockResolvedValue(profile);

      const result = await controller.getOne('chapter-1', 'member-1');

      expect(memberService.findProfileById).toHaveBeenCalledWith(
        'member-1',
        'chapter-1',
      );
      expect(result).toEqual(profile);
    });
  });

  describe('updateRoles', () => {
    it('updates member roles', async () => {
      const dto: UpdateMemberRolesDto = { role_ids: ['role-1', 'role-2'] };
      const updatedMember = { id: 'member-1', role_ids: dto.role_ids } as any;
      memberService.updateRoles.mockResolvedValue(updatedMember);

      const result = await controller.updateRoles('member-1', dto);

      expect(memberService.updateRoles).toHaveBeenCalledWith(
        'member-1',
        dto.role_ids,
      );
      expect(result).toEqual(updatedMember);
    });
  });

  describe('updateOnboarding', () => {
    it('updates onboarding status for current member', async () => {
      const dto: UpdateOnboardingDto = { has_completed_onboarding: true };
      const updatedMember = { id: 'member-1', ...dto } as any;
      memberService.updateOnboarding.mockResolvedValue(updatedMember);

      const result = await controller.updateOnboarding({ id: 'member-1' }, dto);

      expect(memberService.updateOnboarding).toHaveBeenCalledWith(
        'member-1',
        true,
      );
      expect(result).toEqual(updatedMember);
    });
  });

  describe('remove', () => {
    it('removes a member and returns success payload', async () => {
      memberService.remove.mockResolvedValue(undefined);

      const result = await controller.remove('member-1');

      expect(memberService.remove).toHaveBeenCalledWith('member-1');
      expect(result).toEqual({ success: true });
    });
  });
});
