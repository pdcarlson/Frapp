import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ChapterService } from './chapter.service';
import { CHAPTER_REPOSITORY } from '../../domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '../../domain/repositories/chapter.repository.interface';
import { ROLE_REPOSITORY } from '../../domain/repositories/role.repository.interface';
import type { IRoleRepository } from '../../domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  DEFAULT_SYSTEM_ROLES,
  DEFAULT_CHANNELS,
} from '../../domain/constants/permissions';
import type { Chapter } from '../../domain/entities/chapter.entity';
import type { Role } from '../../domain/entities/role.entity';
import type { Member } from '../../domain/entities/member.entity';

function mockRoleIdForName(name: string): string {
  return `role-${name.toLowerCase().replace(/\s+/g, '-')}`;
}

function mockSystemRolesForChapter(chapterId: string): Role[] {
  return DEFAULT_SYSTEM_ROLES.map((r) => ({
    id: mockRoleIdForName(r.name),
    chapter_id: chapterId,
    name: r.name,
    system_key: r.system_key,
    permissions: [...r.permissions],
    is_system: r.is_system,
    display_order: r.display_order,
    color: r.color ?? null,
    created_at: '2024-01-01',
  }));
}

describe('ChapterService', () => {
  let service: ChapterService;
  let mockChapterRepo: jest.Mocked<IChapterRepository>;
  let mockRoleRepo: jest.Mocked<IRoleRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockUserRepo: jest.Mocked<IUserRepository>;
  let mockStorageProvider: {
    getSignedUploadUrl: jest.Mock;
    getSignedDownloadUrl: jest.Mock;
    deleteFile: jest.Mock;
  };
  let mockSupabase: { from: jest.Mock };
  let mockInsert: jest.Mock;

  beforeEach(async () => {
    mockStorageProvider = {
      getSignedUploadUrl: jest
        .fn()
        .mockResolvedValue('https://signed-upload.url'),
      getSignedDownloadUrl: jest
        .fn()
        .mockResolvedValue('https://signed-download.url'),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    mockChapterRepo = {
      findById: jest.fn(),
      findByStripeCustomerId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockRoleRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByIds: jest.fn(),
      findByChapterAndName: jest.fn(),
      findByChapterAndSystemKey: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUser: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockUserRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      anonymize: jest.fn(),
    };

    mockInsert = jest.fn().mockResolvedValue({ error: null });
    mockSupabase = {
      from: jest.fn().mockReturnValue({ insert: mockInsert }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterService,
        { provide: CHAPTER_REPOSITORY, useValue: mockChapterRepo },
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: STORAGE_PROVIDER, useValue: mockStorageProvider },
        { provide: SUPABASE_CLIENT, useValue: mockSupabase },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
      ],
    }).compile();

    service = module.get(ChapterService);
  });

  it('should find chapter by id', async () => {
    const chapter: Chapter = {
      id: 'ch-1',
      name: 'Alpha',
      university: 'State U',
      stripe_customer_id: null,
      subscription_status: 'active',
      subscription_id: null,
      past_due_since: null,
      last_stripe_webhook_at: null,
      accent_color: null,
      logo_path: null,
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockChapterRepo.findById.mockResolvedValue(chapter);

    const result = await service.findById('ch-1');

    expect(mockChapterRepo.findById).toHaveBeenCalledWith('ch-1');
    expect(result).toEqual(chapter);
  });

  it('should list chapters for the current user', async () => {
    const chapters: Chapter[] = [
      {
        id: 'ch-1',
        name: 'Alpha',
        university: 'State U',
        stripe_customer_id: null,
        subscription_status: 'active',
        subscription_id: null,
        past_due_since: null,
        last_stripe_webhook_at: null,
        accent_color: '#2563EB',
        logo_path: null,
        donation_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
      {
        id: 'ch-2',
        name: 'Beta',
        university: 'Tech U',
        stripe_customer_id: null,
        subscription_status: 'incomplete',
        subscription_id: null,
        past_due_since: null,
        last_stripe_webhook_at: null,
        accent_color: '#1D4ED8',
        logo_path: null,
        donation_url: null,
        created_at: '2024-01-02',
        updated_at: '2024-01-02',
      },
    ];
    mockMemberRepo.findByUser.mockResolvedValue([
      {
        id: 'member-1',
        user_id: 'user-1',
        chapter_id: 'ch-1',
        role_ids: ['role-president'],
        custom_role_ids: [],
        has_completed_onboarding: true,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
      {
        id: 'member-2',
        user_id: 'user-1',
        chapter_id: 'ch-2',
        role_ids: ['role-member'],
        custom_role_ids: [],
        has_completed_onboarding: false,
        created_at: '2024-01-02',
        updated_at: '2024-01-02',
      },
    ]);
    mockChapterRepo.findById
      .mockResolvedValueOnce(chapters[0])
      .mockResolvedValueOnce(chapters[1]);

    const result = await service.listForUser('user-1');

    expect(mockMemberRepo.findByUser).toHaveBeenCalledWith('user-1');
    expect(mockChapterRepo.findById).toHaveBeenNthCalledWith(1, 'ch-1');
    expect(mockChapterRepo.findById).toHaveBeenNthCalledWith(2, 'ch-2');
    expect(result).toEqual([
      {
        member_id: 'member-1',
        chapter_id: 'ch-1',
        role_ids: ['role-president'],
        has_completed_onboarding: true,
        chapter: chapters[0],
      },
      {
        member_id: 'member-2',
        chapter_id: 'ch-2',
        role_ids: ['role-member'],
        has_completed_onboarding: false,
        chapter: chapters[1],
      },
    ]);
  });

  it('should throw NotFoundException when chapter not found', async () => {
    mockChapterRepo.findById.mockResolvedValue(null);

    await expect(service.findById('ch-1')).rejects.toThrow(NotFoundException);
    await expect(service.findById('ch-1')).rejects.toThrow('Chapter not found');
  });

  describe('findByIdWithLogoUrl', () => {
    function chapterWith(logoPath: string | null): Chapter {
      return {
        id: 'ch-1',
        name: 'Alpha',
        university: 'State U',
        stripe_customer_id: null,
        subscription_status: 'active',
        subscription_id: null,
        past_due_since: null,
        last_stripe_webhook_at: null,
        accent_color: '#8B0000',
        logo_path: logoPath,
        donation_url: null,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };
    }

    it('signs the logo out of the private branding bucket', async () => {
      mockChapterRepo.findById.mockResolvedValue(
        chapterWith('chapters/ch-1/branding/logo.png'),
      );

      const result = await service.findByIdWithLogoUrl('ch-1');

      expect(mockStorageProvider.getSignedDownloadUrl).toHaveBeenCalledWith(
        'branding',
        'chapters/ch-1/branding/logo.png',
      );
      expect(result.logo_url).toBe('https://signed-download.url');
      expect(result.name).toBe('Alpha');
    });

    it('returns a null logo_url without calling storage when unset', async () => {
      mockChapterRepo.findById.mockResolvedValue(chapterWith(null));

      const result = await service.findByIdWithLogoUrl('ch-1');

      expect(result.logo_url).toBeNull();
      expect(mockStorageProvider.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('degrades to a null logo_url when signing fails', async () => {
      // The logo is decoration on a payload that also carries name and
      // subscription status; a storage outage must not blank the shell.
      mockChapterRepo.findById.mockResolvedValue(
        chapterWith('chapters/ch-1/branding/logo.png'),
      );
      mockStorageProvider.getSignedDownloadUrl.mockRejectedValue(
        new Error('storage unreachable'),
      );

      const result = await service.findByIdWithLogoUrl('ch-1');

      expect(result.logo_url).toBeNull();
      expect(result.name).toBe('Alpha');
    });

    it('propagates a missing chapter as NotFoundException', async () => {
      mockChapterRepo.findById.mockResolvedValue(null);

      await expect(service.findByIdWithLogoUrl('ch-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  it('should create chapter with default roles', async () => {
    const chapter: Chapter = {
      id: 'ch-1',
      name: 'Alpha',
      university: 'State U',
      stripe_customer_id: null,
      subscription_status: 'active',
      subscription_id: null,
      past_due_since: null,
      last_stripe_webhook_at: null,
      accent_color: null,
      logo_path: null,
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockChapterRepo.create.mockResolvedValue(chapter);

    const roles = mockSystemRolesForChapter(chapter.id);

    mockRoleRepo.createMany.mockResolvedValueOnce(roles);

    const result = await service.create('user-1', {
      name: 'Alpha',
      university: 'State U',
    });

    expect(mockChapterRepo.create).toHaveBeenCalledWith({
      name: 'Alpha',
      university: 'State U',
    });
    expect(mockRoleRepo.createMany).toHaveBeenCalledTimes(1);
    const expectedRolesData = DEFAULT_SYSTEM_ROLES.map((roleDef) => ({
      chapter_id: chapter.id,
      name: roleDef.name,
      system_key: roleDef.system_key,
      permissions: [...roleDef.permissions],
      is_system: roleDef.is_system,
      display_order: roleDef.display_order,
      color: roleDef.color ?? null,
    }));
    expect(mockRoleRepo.createMany).toHaveBeenCalledWith(expectedRolesData);
    expect(result).toEqual(chapter);
  });

  it('should merge onboarding config columns into the chapter insert', async () => {
    const chapter: Chapter = {
      id: 'ch-1',
      name: 'Sigma Phi Epsilon',
      university: 'UCLA',
      stripe_customer_id: null,
      subscription_status: 'incomplete',
      subscription_id: null,
      past_due_since: null,
      last_stripe_webhook_at: null,
      accent_color: null,
      logo_path: null,
      donation_url: null,
      created_at: '2026-05-24',
      updated_at: '2026-05-24',
    };
    mockChapterRepo.create.mockResolvedValue(chapter);
    mockRoleRepo.createMany.mockResolvedValueOnce(
      mockSystemRolesForChapter(chapter.id),
    );
    mockMemberRepo.create.mockResolvedValue({
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: chapter.id,
      role_ids: [mockRoleIdForName('President')],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2026-05-24',
      updated_at: '2026-05-24',
    });

    await service.create('user-1', {
      name: 'Sigma Phi Epsilon',
      university: 'UCLA',
      config: {
        org_archetype: 'nphc',
        enabled_modules: { chat: true },
        directory_id: 'dir-1',
      },
    });

    expect(mockChapterRepo.create).toHaveBeenCalledWith({
      name: 'Sigma Phi Epsilon',
      university: 'UCLA',
      org_archetype: 'nphc',
      enabled_modules: { chat: true },
      directory_id: 'dir-1',
    });
  });

  it('should assign creator as President on chapter creation', async () => {
    const chapter: Chapter = {
      id: 'ch-1',
      name: 'Alpha',
      university: 'State U',
      stripe_customer_id: null,
      subscription_status: 'active',
      subscription_id: null,
      past_due_since: null,
      last_stripe_webhook_at: null,
      accent_color: null,
      logo_path: null,
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockChapterRepo.create.mockResolvedValue(chapter);

    const roles = mockSystemRolesForChapter(chapter.id);
    const presidentRole = roles.find((r) => r.name === 'President')!;

    mockRoleRepo.createMany.mockResolvedValueOnce(roles);

    const member: Member = {
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: chapter.id,
      role_ids: [presidentRole.id],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockMemberRepo.create.mockResolvedValue(member);

    await service.create('user-1', { name: 'Alpha', university: 'State U' });

    expect(mockMemberRepo.create).toHaveBeenCalledWith({
      user_id: 'user-1',
      chapter_id: chapter.id,
      role_ids: [presidentRole.id],
      has_completed_onboarding: true,
    });
  });

  it('should create default channels on chapter creation', async () => {
    const chapter: Chapter = {
      id: 'ch-1',
      name: 'Alpha',
      university: 'State U',
      stripe_customer_id: null,
      subscription_status: 'active',
      subscription_id: null,
      past_due_since: null,
      last_stripe_webhook_at: null,
      accent_color: null,
      logo_path: null,
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockChapterRepo.create.mockResolvedValue(chapter);

    mockRoleRepo.createMany.mockImplementation((dataArr) =>
      Promise.resolve(
        dataArr.map((data) => ({
          id: mockRoleIdForName(data.name ?? ''),
          chapter_id: data.chapter_id!,
          name: data.name!,
          system_key: data.system_key ?? null,
          permissions: data.permissions ?? [],
          is_system: data.is_system ?? false,
          display_order: data.display_order ?? 0,
          color: data.color ?? null,
          created_at: '2024-01-01',
        })),
      ),
    );
    mockMemberRepo.create.mockResolvedValue({
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: chapter.id,
      role_ids: [mockRoleIdForName('President')],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    await service.create('user-1', { name: 'Alpha', university: 'State U' });

    expect(mockSupabase.from).toHaveBeenCalledWith('chat_channels');
    expect(mockSupabase.from().insert).toHaveBeenCalledTimes(1);
    expect(mockSupabase.from().insert).toHaveBeenCalledWith(
      DEFAULT_CHANNELS.map((channelDef) => ({
        chapter_id: chapter.id,
        name: channelDef.name,
        type: channelDef.type,
        is_read_only: channelDef.is_read_only,
        required_permissions: channelDef.required_permissions
          ? [...channelDef.required_permissions]
          : null,
      })),
    );
  });

  // FRA-321: the seeder used to drop `required_permissions` entirely, leaving
  // #alumni ROLE_GATED but gating on nothing — which `canAccessChannel` then
  // read as "any chapter member". Asserted against the persisted payload rather
  // than the constant so a seeder that silently stops writing the field fails.
  it('should persist required_permissions for the seeded ROLE_GATED channel', () => {
    const alumniChannel = DEFAULT_CHANNELS.find(
      (channelDef) => channelDef.type === 'ROLE_GATED',
    );

    expect(alumniChannel).toBeDefined();
    expect(alumniChannel?.required_permissions).toEqual([
      'members:view',
      'alumni:post',
    ]);

    for (const channelDef of DEFAULT_CHANNELS) {
      if (channelDef.type !== 'ROLE_GATED') continue;
      expect(channelDef.required_permissions?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('should fail chapter creation when default channel insert returns an error', async () => {
    const chapter: Chapter = {
      id: 'ch-1',
      name: 'Alpha',
      university: 'State U',
      stripe_customer_id: null,
      subscription_status: 'active',
      subscription_id: null,
      past_due_since: null,
      last_stripe_webhook_at: null,
      accent_color: null,
      logo_path: null,
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockChapterRepo.create.mockResolvedValue(chapter);
    mockRoleRepo.createMany.mockImplementation((dataArr) =>
      Promise.resolve(
        dataArr.map((data) => ({
          id: mockRoleIdForName(data.name ?? ''),
          chapter_id: data.chapter_id!,
          name: data.name!,
          system_key: data.system_key ?? null,
          permissions: data.permissions ?? [],
          is_system: data.is_system ?? false,
          display_order: data.display_order ?? 0,
          color: data.color ?? null,
          created_at: '2024-01-01',
        })),
      ),
    );
    mockMemberRepo.create.mockResolvedValue({
      id: 'member-1',
      user_id: 'user-1',
      chapter_id: chapter.id,
      role_ids: [mockRoleIdForName('President')],
      custom_role_ids: [],
      has_completed_onboarding: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });
    mockInsert.mockResolvedValueOnce({
      error: { message: 'insert failed' },
    });
    const loggerErrorSpy = jest
      .spyOn((service as any).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(
      service.create('user-1', { name: 'Alpha', university: 'State U' }),
    ).rejects.toThrow(InternalServerErrorException);

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Failed to insert default chat channels for chapter ch-1',
      'insert failed',
    );
  });

  it('should update chapter data with valid WCAG accent color', async () => {
    const updatedChapter: Chapter = {
      id: 'ch-1',
      name: 'Alpha Updated',
      university: 'State U',
      stripe_customer_id: null,
      subscription_status: 'active',
      subscription_id: null,
      past_due_since: null,
      last_stripe_webhook_at: null,
      accent_color: '#1E293B',
      logo_path: null,
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
    };
    mockChapterRepo.update.mockResolvedValue(updatedChapter);

    const result = await service.update('ch-1', {
      name: 'Alpha Updated',
      accent_color: '#1E293B',
    });

    // The accent is mirrored into `branding.colors.accent` in the same write.
    // `branding.colors` is authoritative (#795) and this is the one path that
    // sets the column directly, so without the mirror a Settings edit would
    // leave the two stores disagreeing.
    expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
      name: 'Alpha Updated',
      accent_color: '#1E293B',
      branding: { colors: { accent: '#1E293B' } },
    });
    expect(result).toEqual(updatedChapter);
  });

  it('preserves other branding keys when mirroring the accent', async () => {
    mockChapterRepo.findById.mockResolvedValue({
      id: 'ch-1',
      branding: {
        greek_letters: 'ΦΓΔ',
        colors: { dark: '#4B2E2E', accent: '#8B0000' },
      },
    } as never);
    mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' } as never);

    await service.update('ch-1', { accent_color: '#1E293B' });

    expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
      accent_color: '#1E293B',
      branding: {
        greek_letters: 'ΦΓΔ',
        colors: { dark: '#4B2E2E', accent: '#1E293B' },
      },
    });
  });

  it('does not touch branding when the update carries no accent', async () => {
    mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' } as never);

    await service.update('ch-1', { name: 'Renamed' });

    expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
      name: 'Renamed',
    });
    expect(mockChapterRepo.findById).not.toHaveBeenCalled();
  });

  it('accepts a low-contrast accent rather than gating it on save', async () => {
    // This route used to reject anything under 4.5:1 on the light surface. It
    // no longer does, and that is deliberate: `accent_color` is a mirror of
    // `branding.colors.accent`, which is the accent engine's seed and is not
    // gated — the seed never paints, and gating it rejects 49 of the 50 real
    // chapters in the directory seed.
    //
    // Gating only this path was worse than gating none: onboarding and the
    // config PATCH both write the column without checking, so a chapter could
    // hold an accent this route then refused, leaving the officer unable to
    // save anything in Settings (the form resends the stored value). Legibility
    // is enforced at render time by `resolveChapterAccentColor`, which
    // substitutes an accessible fallback per surface.
    mockChapterRepo.findById.mockResolvedValue({ id: 'ch-1' } as never);
    mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' } as never);

    // #C9A56F is 2.16:1 on bone and is the most common accent in the seed.
    await service.update('ch-1', { accent_color: '#C9A56F' });

    expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
      accent_color: '#C9A56F',
      branding: { colors: { accent: '#C9A56F' } },
    });
  });

  it('should generate logo upload URL', async () => {
    const result = await service.requestLogoUploadUrl(
      'ch-1',
      'logo.png',
      'image/png',
    );

    expect(mockStorageProvider.getSignedUploadUrl).toHaveBeenCalledWith(
      'branding',
      'chapters/ch-1/branding/logo.png',
      'image/png',
    );
    expect(result).toEqual({
      signedUrl: 'https://signed-upload.url',
      storage_path: 'chapters/ch-1/branding/logo.png',
    });
  });

  it('should reject logo upload with invalid content type', async () => {
    await expect(
      service.requestLogoUploadUrl('ch-1', 'logo.png', 'application/pdf'),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject logo upload with invalid extension', async () => {
    await expect(
      service.requestLogoUploadUrl('ch-1', 'logo.pdf', 'image/png'),
    ).rejects.toThrow(BadRequestException);
  });

  it('should confirm logo upload and update logo_path', async () => {
    const updatedChapter: Chapter = {
      id: 'ch-1',
      name: 'Alpha',
      university: 'State U',
      stripe_customer_id: null,
      subscription_status: 'active',
      subscription_id: null,
      past_due_since: null,
      last_stripe_webhook_at: null,
      accent_color: null,
      logo_path: 'chapters/ch-1/branding/logo.png',
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
    };
    mockChapterRepo.update.mockResolvedValue(updatedChapter);

    const result = await service.confirmLogoUpload(
      'ch-1',
      'chapters/ch-1/branding/logo.png',
    );

    expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
      logo_path: 'chapters/ch-1/branding/logo.png',
    });
    expect(result).toEqual(updatedChapter);
  });

  it('should reject confirm logo with invalid storage path', async () => {
    await expect(
      service.confirmLogoUpload(
        'ch-1',
        'chapters/other-chapter/branding/logo.png',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(mockChapterRepo.update).not.toHaveBeenCalled();
  });

  it('should delete logo and clear logo_path', async () => {
    const chapterWithLogo: Chapter = {
      id: 'ch-1',
      name: 'Alpha',
      university: 'State U',
      stripe_customer_id: null,
      subscription_status: 'active',
      subscription_id: null,
      past_due_since: null,
      last_stripe_webhook_at: null,
      accent_color: null,
      logo_path: 'chapters/ch-1/branding/logo.png',
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    const updatedChapter = { ...chapterWithLogo, logo_path: null };
    mockChapterRepo.findById.mockResolvedValue(chapterWithLogo);
    mockChapterRepo.update.mockResolvedValue(updatedChapter);

    const result = await service.deleteLogo('ch-1');

    expect(mockStorageProvider.deleteFile).toHaveBeenCalledWith(
      'branding',
      'chapters/ch-1/branding/logo.png',
    );
    expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
      logo_path: null,
    });
    expect(result.logo_path).toBeNull();
  });

  it('should delete logo when chapter has no logo (no-op)', async () => {
    const chapterWithoutLogo: Chapter = {
      id: 'ch-1',
      name: 'Alpha',
      university: 'State U',
      stripe_customer_id: null,
      subscription_status: 'active',
      subscription_id: null,
      past_due_since: null,
      last_stripe_webhook_at: null,
      accent_color: null,
      logo_path: null,
      donation_url: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockChapterRepo.findById.mockResolvedValue(chapterWithoutLogo);
    mockChapterRepo.update.mockResolvedValue(chapterWithoutLogo);

    const result = await service.deleteLogo('ch-1');

    expect(mockStorageProvider.deleteFile).not.toHaveBeenCalled();
    expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
      logo_path: null,
    });
    expect(result.logo_path).toBeNull();
  });

  it('should throw NotFoundException when chapter to delete logo from is not found', async () => {
    mockChapterRepo.findById.mockResolvedValue(null);

    await expect(service.deleteLogo('ch-1')).rejects.toThrow(NotFoundException);
  });

  // The persisted selection is stamped into the access token as the
  // authoritative active_chapter_id claim, so a chapter the caller cannot join
  // must never reach it (spec/behavior/multi-tenancy.md).
  describe('setActiveChapter', () => {
    it('persists the selection for a member', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue({
        id: 'member-1',
      } as Member);

      await service.setActiveChapter('user-1', 'ch-1');

      expect(mockUserRepo.update).toHaveBeenCalledWith('user-1', {
        active_chapter_id: 'ch-1',
      });
    });

    it('refuses a chapter the caller is not a member of', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);

      await expect(
        service.setActiveChapter('user-1', 'ch-foreign'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });
  });
});
