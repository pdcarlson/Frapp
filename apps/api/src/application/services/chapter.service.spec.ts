import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { deriveSignetPalette } from '@repo/chapter-theme';
import * as chapterTheme from '@repo/chapter-theme';
import { ChapterService } from './chapter.service';
import { toChapterMemberView } from './chapter-member-view';
import { ChapterAuditLogService } from './chapter-audit-log.service';
import { CHAPTER_REPOSITORY } from '#domain/repositories/chapter.repository.interface';
import type { IChapterRepository } from '#domain/repositories/chapter.repository.interface';
import { ROLE_REPOSITORY } from '#domain/repositories/role.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import { STORAGE_PROVIDER } from '#domain/adapters/storage.interface';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import {
  DEFAULT_SYSTEM_ROLES,
  DEFAULT_CHANNELS,
} from '#domain/constants/permissions';
import type { Chapter } from '#domain/entities/chapter.entity';
import type { Role } from '#domain/entities/role.entity';
import type { Member } from '#domain/entities/member.entity';

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
  let mockAuditLog: { record: jest.Mock };

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
      findBySubscriptionId: jest.fn(),
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
      findDisplayIdentitiesByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      anonymize: jest.fn(),
    };

    mockInsert = jest.fn().mockResolvedValue({ error: null });
    mockSupabase = {
      from: jest.fn().mockReturnValue({ insert: mockInsert }),
    };

    mockAuditLog = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterService,
        { provide: CHAPTER_REPOSITORY, useValue: mockChapterRepo },
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: STORAGE_PROVIDER, useValue: mockStorageProvider },
        { provide: SUPABASE_CLIENT, useValue: mockSupabase },
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: ChapterAuditLogService, useValue: mockAuditLog },
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
    // Projected, not the raw row (#930). This assertion used to read
    // `chapter: chapters[0]`, which pinned the leak: `GET /v1/chapters` has no
    // billing permission, yet shipped `stripe_customer_id`, `subscription_id`
    // and `last_stripe_webhook_at` for every chapter the caller belongs to.
    expect(result).toEqual([
      {
        member_id: 'member-1',
        chapter_id: 'ch-1',
        role_ids: ['role-president'],
        has_completed_onboarding: true,
        chapter: toChapterMemberView(chapters[0]),
      },
      {
        member_id: 'member-2',
        chapter_id: 'ch-2',
        role_ids: ['role-member'],
        has_completed_onboarding: false,
        chapter: toChapterMemberView(chapters[1]),
      },
    ]);

    // Asserted directly rather than left implicit in the projection helper, so
    // this test fails on a regression here even if the helper's own contract
    // changed.
    for (const summary of result) {
      expect(summary.chapter).not.toHaveProperty('stripe_customer_id');
      expect(summary.chapter).not.toHaveProperty('subscription_id');
      expect(summary.chapter).not.toHaveProperty('last_stripe_webhook_at');
      // Still present — the chapter picker and the subscription gate read it.
      expect(summary.chapter).toHaveProperty('subscription_status');
    }
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

    describe('member-safe projection (#930)', () => {
      /*
       * `GET /v1/chapters/current` is guarded by `members:view` — every member
       * of the chapter. The repository read behind it is `select('*')`, so
       * without a projection the whole row shipped. These two tests are the
       * endpoint-level halves of the issue's AC #2 and AC #3.
       */
      function populatedChapter(): Chapter {
        return {
          ...chapterWith(null),
          stripe_customer_id: 'cus_SENSITIVE',
          subscription_id: 'sub_SENSITIVE',
          subscription_status: 'past_due',
          past_due_since: '2026-08-01T00:00:00.000Z',
          last_stripe_webhook_at: '2026-08-02T00:00:00.000Z',
          legal_accepted_by: 'user-legal-signer',
          beta_config: { enabled: true },
        };
      }

      it('withholds billing identifiers and internal columns', async () => {
        mockChapterRepo.findById.mockResolvedValue(populatedChapter());

        const result = await service.findByIdWithLogoUrl('ch-1');

        expect(result).not.toHaveProperty('stripe_customer_id');
        expect(result).not.toHaveProperty('subscription_id');
        expect(result).not.toHaveProperty('last_stripe_webhook_at');
        expect(result).not.toHaveProperty('legal_accepted_by');
        expect(result).not.toHaveProperty('beta_config');
        expect(JSON.stringify(result)).not.toContain('SENSITIVE');
      });

      it('still delivers the entitlement mirror the client gate reads', async () => {
        // If this fails, every client silently renders grace-window
        // affordances while the server hard-locks the same writes —
        // `isWithinSubscriptionGrace(null)` fails open.
        mockChapterRepo.findById.mockResolvedValue(populatedChapter());

        const result = await service.findByIdWithLogoUrl('ch-1');

        expect(result.subscription_status).toBe('past_due');
        expect(result.past_due_since).toBe('2026-08-01T00:00:00.000Z');
      });
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

  // #1008: the chapter seeder inserts DEFAULT_CHANNELS straight into
  // `chat_channels`, bypassing `ChatService.createChannel` — so the creator seed
  // that makes a PRIVATE channel readable does not run on this path, and there
  // is no DB default, CHECK or trigger behind it either. A PRIVATE entry added
  // here would give every newly created chapter a channel readable by nobody,
  // with no repair path, which is #1008 verbatim. Assert the invariant that
  // makes the omission safe rather than the seed itself.
  it('should not seed a PRIVATE default channel, which the seeder cannot make readable', () => {
    expect(
      DEFAULT_CHANNELS.filter((channelDef) => channelDef.type === 'PRIVATE'),
    ).toEqual([]);
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

    const result = await service.update(
      'ch-1',
      {
        name: 'Alpha Updated',
        accent_color: '#1E293B',
      },
      'user-1',
    );

    // The accent is mirrored into `branding.colors.accent` in the same write.
    // `branding.colors` is authoritative (#795) and this is the one path that
    // sets the column directly, so without the mirror a Settings edit would
    // leave the two stores disagreeing.
    expect(mockChapterRepo.update).toHaveBeenCalledWith(
      'ch-1',
      expect.objectContaining({
        name: 'Alpha Updated',
        accent_color: '#1E293B',
        branding: { colors: { accent: '#1E293B' } },
      }),
    );
    expect(result.chapter).toEqual(updatedChapter);
    // The real seed clears AA, so nothing to disclose (#1183).
    expect(result.failedContrastChecks).toEqual([]);
  });

  it('surfaces failedContrastChecks and logs a warning when the generated accent fails AA (#1183)', async () => {
    // §8 is by construction, not by proof — no real hex in the directory seed
    // or a systematic sweep of the hue/saturation/lightness space fails it, so
    // this exercises the disclosure plumbing via a stubbed generator result
    // rather than hunting for a real seed that may not exist.
    mockChapterRepo.findById.mockResolvedValue({ id: 'ch-1' });
    mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' });
    const loggerWarnSpy = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    // A plain try/finally, not a trailing `mockRestore()` call: an assertion
    // failure below would otherwise skip the restore and leak the queued
    // stub into whichever test runs next in file order.
    const deriveSpy = jest.spyOn(chapterTheme, 'deriveSignetPalette');
    try {
      deriveSpy.mockReturnValueOnce({
        palette: { '--signet-accent-text': '#222222' } as any,
        resolvedSeed: '#222222',
        invalidSeed: false,
        contrastChecks: [
          {
            role: '--signet-accent-text',
            against: '#0E0D0B',
            ratio: 2.1,
            passes: false,
          },
        ],
      });

      const result = await service.update(
        'ch-1',
        {
          accent_color: '#222222',
        },
        'user-1',
      );

      expect(result.failedContrastChecks).toEqual([
        { role: '--signet-accent-text', against: '#0E0D0B', ratio: 2.1 },
      ]);
      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Signet accent contrast below AA for chapter ch-1: --signet-accent-text on #0E0D0B = 2.10:1',
        ),
      );
      // The save still succeeds — §8 forbids a runtime substitution here.
      expect(mockChapterRepo.update).toHaveBeenCalled();
    } finally {
      deriveSpy.mockRestore();
    }
  });

  it('preserves other branding keys when mirroring the accent', async () => {
    // `dark` is deliberate: it is a legacy key written before the #920 slice-9
    // cutover removed the second brand colour. Nothing reads it any more, but
    // it is the tenant's stored data and an accent save must not prune it.
    mockChapterRepo.findById.mockResolvedValue({
      id: 'ch-1',
      branding: {
        greek_letters: 'ΦΓΔ',
        colors: { dark: '#4B2E2E', accent: '#8B0000' },
      },
    });
    mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' });

    await service.update('ch-1', { accent_color: '#1E293B' }, 'user-1');

    expect(mockChapterRepo.update).toHaveBeenCalledWith(
      'ch-1',
      expect.objectContaining({
        accent_color: '#1E293B',
        branding: {
          greek_letters: 'ΦΓΔ',
          colors: { dark: '#4B2E2E', accent: '#1E293B' },
        },
      }),
    );
  });

  it('does not touch branding when the update carries no accent', async () => {
    mockChapterRepo.findById.mockResolvedValue({ id: 'ch-1', name: 'Alpha' });
    mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' });

    await service.update('ch-1', { name: 'Renamed' }, 'user-1');

    expect(mockChapterRepo.update).toHaveBeenCalledWith('ch-1', {
      name: 'Renamed',
    });
    // This used to assert `findById` was never called on the no-accent path.
    // That stopped being true with #486: the audit diff has to compare against
    // the stored row on every path to tell a real edit from a re-save. The
    // branding guarantee this test exists for is unchanged and is what is
    // asserted above — the write still carries no `branding` or `theme_palette`
    // key.
    const [, patch] = mockChapterRepo.update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(patch).not.toHaveProperty('branding');
    expect(patch).not.toHaveProperty('theme_palette');
  });

  // #486 — Chunk 06 routes the four core profile columns through this service
  // while archetype/vocabulary/branding go through the config PATCH, which has
  // always audited. These pin the other door.
  describe('chapter profile audit (#486)', () => {
    // A consistent chapter: the column and the authoritative
    // `branding.colors.accent` agree, which is the post-#795 steady state.
    const stored = {
      id: 'ch-1',
      name: 'Alpha',
      university: 'State U',
      donation_url: null,
      accent_color: '#8B0000',
      branding: { colors: { accent: '#8B0000' } },
    } as unknown as Chapter;

    it('writes one member-visible audit row carrying only the changed fields', async () => {
      mockChapterRepo.findById.mockResolvedValue(stored);
      mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' });

      await service.update(
        'ch-1',
        { name: 'Alpha Beta', university: 'State U' },
        'user-9',
      );

      expect(mockAuditLog.record).toHaveBeenCalledTimes(1);
      expect(mockAuditLog.record).toHaveBeenCalledWith({
        chapterId: 'ch-1',
        actorUserId: 'user-9',
        action: 'chapter_profile_updated',
        targetType: 'chapter',
        targetId: 'ch-1',
        // `university` was submitted but is unchanged, so it must not appear —
        // the diff records what changed, not what was posted.
        diff: { name: { from: 'Alpha', to: 'Alpha Beta' } },
        memberVisible: true,
      });
    });

    it('audits an accent change, which posts to this route rather than the config PATCH', async () => {
      mockChapterRepo.findById.mockResolvedValue(stored);
      mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' });

      await service.update('ch-1', { accent_color: '#0C5C3D' }, 'user-9');

      // Both the column and the authoritative branding mirror move, and the row
      // records both — they are two stores and a reader of the audit trail
      // should not have to know they are kept in sync.
      expect(mockAuditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          diff: {
            accent_color: { from: '#8B0000', to: '#0C5C3D' },
            'branding.colors.accent': { from: '#8B0000', to: '#0C5C3D' },
          },
        }),
      );
    });

    it('treats a hex-case-only accent re-pick as no change', async () => {
      mockChapterRepo.findById.mockResolvedValue(stored);
      mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' });

      // Chapters seeded from the directory store uppercase; `<input type="color">`
      // always reports lowercase. A strict compare made re-picking the same
      // swatch look like an edit and posted a card to the whole chapter.
      await service.update('ch-1', { accent_color: '#8b0000' }, 'user-9');

      expect(mockAuditLog.record).not.toHaveBeenCalled();
    });

    // `chapters.branding` is `jsonb not null default '{}'`, and the #795
    // backfill only touched rows whose branding accent was already set — so a
    // chapter that never went through an onboarding branding step has the
    // column set and an EMPTY branding object. That is the common shape, not an
    // edge case, and it is the one a `branding`-carrying fixture hides.
    it('writes no row for a re-save on a chapter whose branding mirror is empty', async () => {
      mockChapterRepo.findById.mockResolvedValue({
        ...stored,
        branding: {},
      });
      mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' });

      await service.update('ch-1', { accent_color: '#8B0000' }, 'user-9');

      // Populating the mirror for the first time is the system catching up, not
      // an edit. Counting it as a change fires on every accent save for these
      // chapters — exactly the no-op card the rest of this block prevents.
      expect(mockAuditLog.record).not.toHaveBeenCalled();
    });

    it('audits a branding-mirror repair even when the column value is unchanged', async () => {
      // The #795 divergence: the column and the authoritative branding accent
      // disagree. Settings seeds its draft from the column, so pressing Save
      // without editing re-sends the stored column value and repaints every
      // branded surface in the chapter. The column did not change, so without
      // the branding entry this chapter-wide change would be unaudited.
      mockChapterRepo.findById.mockResolvedValue({
        ...stored,
        branding: { colors: { accent: '#003087' } },
      });
      mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' });

      await service.update('ch-1', { accent_color: '#8B0000' }, 'user-9');

      expect(mockAuditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          diff: {
            'branding.colors.accent': { from: '#003087', to: '#8B0000' },
          },
        }),
      );
    });

    it('audits after the update on the accent path too, not just the plain path', async () => {
      mockChapterRepo.findById.mockResolvedValue(stored);
      mockChapterRepo.update.mockRejectedValue(new Error('update failed'));

      await expect(
        service.update('ch-1', { accent_color: '#0C5C3D' }, 'user-9'),
      ).rejects.toThrow('update failed');

      // Pins the ordering on the second, independent `recordProfileAudit` call
      // site. Without this, moving that call above the write would leave the
      // suite green while a failed accent save announced a colour change to
      // `#chapter-audit` that never persisted.
      expect(mockAuditLog.record).not.toHaveBeenCalled();
    });

    it('writes no row when the form re-sends unchanged values', async () => {
      mockChapterRepo.findById.mockResolvedValue(stored);
      mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' });

      // The Settings form re-sends every stored value on save, so this is the
      // common case, not an edge one. Writing here would mirror a "chapter
      // profile updated" message into the member-visible `#chapter-audit`
      // channel every time an officer opened Settings and hit Save.
      await service.update(
        'ch-1',
        { name: 'Alpha', university: 'State U', accent_color: '#8B0000' },
        'user-9',
      );

      expect(mockChapterRepo.update).toHaveBeenCalled();
      expect(mockAuditLog.record).not.toHaveBeenCalled();
    });

    it('audits after the update lands, so a failed save leaves no row claiming it happened', async () => {
      mockChapterRepo.findById.mockResolvedValue(stored);
      mockChapterRepo.update.mockRejectedValue(new Error('update failed'));

      await expect(
        service.update('ch-1', { name: 'Alpha Beta' }, 'user-9'),
      ).rejects.toThrow('update failed');

      expect(mockAuditLog.record).not.toHaveBeenCalled();
    });

    it('fails the request when the audit write fails, rather than silently not auditing', async () => {
      mockChapterRepo.findById.mockResolvedValue(stored);
      mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' });
      mockAuditLog.record.mockRejectedValue(new Error('audit down'));

      await expect(
        service.update('ch-1', { name: 'Alpha Beta' }, 'user-9'),
      ).rejects.toThrow('audit down');
    });
  });

  it('recomputes the theme palette on the same write', async () => {
    // Settings sends `PATCH /v1/chapters/current { accent_color }`, not the
    // config PATCH, so this is the only door the accent editor uses. Without a
    // recompute here `theme_palette` stayed frozen at whatever onboarding
    // derived, and a client reading the generated scale — mobile does — would
    // paint the wizard's original colour forever with no way to change it.
    mockChapterRepo.findById.mockResolvedValue({
      id: 'ch-1',
      branding: { colors: { accent: '#8B0000' } },
    });
    mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' });

    await service.update('ch-1', { accent_color: '#0C5C3D' }, 'user-1');

    const [, patch] = mockChapterRepo.update.mock.calls[0] as [
      string,
      { theme_palette?: Record<string, string> },
    ];
    const palette = patch.theme_palette ?? {};
    // Derived from the NEW accent — not the stored one.
    expect(palette['--signet-accent-primary']).toBeDefined();
    expect(palette['--signet-accent-primary']).not.toBe(
      deriveSignetPalette('#8B0000').palette['--signet-accent-primary'],
    );
    expect(palette['--signet-accent-primary']).toBe(
      deriveSignetPalette('#0C5C3D').palette['--signet-accent-primary'],
    );
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
    mockChapterRepo.findById.mockResolvedValue({ id: 'ch-1' });
    mockChapterRepo.update.mockResolvedValue({ id: 'ch-1' });

    // #C9A56F is 2.16:1 on bone and is the most common accent in the seed.
    await service.update('ch-1', { accent_color: '#C9A56F' });

    expect(mockChapterRepo.update).toHaveBeenCalledWith(
      'ch-1',
      expect.objectContaining({
        accent_color: '#C9A56F',
        branding: { colors: { accent: '#C9A56F' } },
      }),
    );
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
      });

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
