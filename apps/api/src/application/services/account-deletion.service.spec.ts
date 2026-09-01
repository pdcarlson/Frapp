import { Test, TestingModule } from '@nestjs/testing';
import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';
import { AnalyticsService } from './analytics.service';
import { RbacService } from './rbac.service';
import { ReportRetentionService } from './report-retention.service';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import type { IStorageProvider } from '../../domain/adapters/storage.interface';
import { AUTH_ADMIN_PROVIDER } from '../../domain/adapters/auth-admin.interface';
import type { IAuthAdminProvider } from '../../domain/adapters/auth-admin.interface';

const liveUser = {
  id: 'user-1',
  supabase_auth_id: 'auth-1',
  email: 'doomed@example.com',
  display_name: 'Doomed User',
  avatar_url: 'chapters/chapter-a/profiles/user-1/pic.png',
  bio: 'bio',
  graduation_year: 2027,
  current_city: 'Troy',
  current_company: null,
  active_chapter_id: 'chapter-a',
  deleted_at: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

const tombstone = {
  ...liveUser,
  email: 'deleted+user-1@anonymized.invalid',
  display_name: 'Deleted User',
  avatar_url: null,
  bio: null,
  graduation_year: null,
  current_city: null,
  current_company: null,
  active_chapter_id: null,
  deleted_at: '2026-08-03T00:00:00Z',
};

const membership = (chapterId: string, roleIds: string[] = []) => ({
  id: `m-${chapterId}`,
  user_id: 'user-1',
  chapter_id: chapterId,
  role_ids: roleIds,
});

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;
  let mockUserRepo: jest.Mocked<IUserRepository>;
  let mockMemberRepo: jest.Mocked<Pick<IMemberRepository, 'findByUser'>>;
  let mockStorage: jest.Mocked<IStorageProvider>;
  let mockAuthAdmin: jest.Mocked<IAuthAdminProvider>;
  let mockAnalytics: { forgetUser: jest.Mock };
  let mockRbacService: { flagIfPresidentRemoved: jest.Mock };
  let callOrder: string[];

  beforeEach(async () => {
    callOrder = [];
    mockUserRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findDisplayIdentitiesByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      anonymize: jest.fn(async () => {
        callOrder.push('anonymize');
        return tombstone;
      }),
    };
    mockMemberRepo = {
      findByUser: jest.fn(async () => [membership('chapter-a')]),
    };
    mockStorage = {
      getSignedUploadUrl: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
      uploadFile: jest.fn(),
      downloadFile: jest.fn(),
      deleteFile: jest.fn(),
      deleteFiles: jest.fn(async () => {
        callOrder.push('deleteFiles');
      }),
      // Avatars list by path (age is irrelevant); reports list with metadata.
      listFiles: jest.fn(async (_bucket: string, prefix: string) => {
        callOrder.push('listFiles');
        return [`${prefix}/pic.png`];
      }),
      listObjects: jest.fn(async (_bucket: string, prefix: string) => {
        callOrder.push('listReports');
        return [{ path: `${prefix}/roster.pdf`, createdAt: new Date() }];
      }),
      listFolders: jest.fn(async () => []),
    };
    mockAuthAdmin = {
      deleteAuthUser: jest.fn(async () => {
        callOrder.push('deleteAuthUser');
      }),
    };
    mockAnalytics = {
      forgetUser: jest.fn(async () => {
        callOrder.push('forgetUser');
        return true;
      }),
    };
    mockRbacService = {
      flagIfPresidentRemoved: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: STORAGE_PROVIDER, useValue: mockStorage },
        { provide: AUTH_ADMIN_PROVIDER, useValue: mockAuthAdmin },
        { provide: AnalyticsService, useValue: mockAnalytics },
        { provide: RbacService, useValue: mockRbacService },
        // The real service, not a mock: it shares `mockStorage`, so the
        // report sweep's prefixes and its position relative to the scrub are
        // asserted against the code that actually runs in production.
        ReportRetentionService,
      ],
    }).compile();

    service = module.get(AccountDeletionService);
  });

  /** Profile-photo folders swept, in call order. */
  const listedPrefixes = (bucket: string): string[] =>
    mockStorage.listFiles.mock.calls
      .filter(([called]) => called === bucket)
      .map(([, prefix]) => prefix);

  /** Report prefixes swept, in call order. */
  const listedReportPrefixes = (): string[] =>
    mockStorage.listObjects.mock.calls.map(([, prefix]) => prefix);

  it('runs the full flow in order: storage purge → anonymize → analytics → auth deletion', async () => {
    mockUserRepo.findById.mockResolvedValue(liveUser);

    await service.deleteAccount('user-1');

    expect(mockStorage.listFiles).toHaveBeenCalledWith(
      'profiles',
      'chapters/chapter-a/profiles/user-1',
    );
    expect(mockStorage.deleteFiles).toHaveBeenCalledWith('profiles', [
      'chapters/chapter-a/profiles/user-1/pic.png',
    ]);
    expect(mockUserRepo.anonymize).toHaveBeenCalledWith('user-1');
    expect(mockAnalytics.forgetUser).toHaveBeenCalledWith('user-1');
    // Auth deletion targets the auth id, not the app id; a final convergence
    // scrub follows it to close the PATCH-during-deletion window.
    expect(mockAuthAdmin.deleteAuthUser).toHaveBeenCalledWith('auth-1');
    expect(callOrder).toEqual([
      'listFiles',
      'deleteFiles',
      'listReports',
      'deleteFiles',
      'anonymize',
      'forgetUser',
      'deleteAuthUser',
      'anonymize',
    ]);
    // The convergence pass forces the card rescan to repair cards that raced
    // the first scan; the main pass must not (retries stay cheap).
    expect(mockUserRepo.anonymize).toHaveBeenNthCalledWith(1, 'user-1');
    expect(mockUserRepo.anonymize).toHaveBeenLastCalledWith('user-1', true);
  });

  it('still succeeds when the post-auth-deletion convergence scrub fails', async () => {
    mockUserRepo.findById.mockResolvedValue(liveUser);
    mockUserRepo.anonymize
      .mockResolvedValueOnce(tombstone)
      .mockRejectedValueOnce(new Error('db blip'));

    await expect(service.deleteAccount('user-1')).resolves.toBeUndefined();
    expect(mockAuthAdmin.deleteAuthUser).toHaveBeenCalled();
  });

  it('purges avatars across every chapter membership', async () => {
    mockUserRepo.findById.mockResolvedValue(liveUser);
    mockMemberRepo.findByUser.mockResolvedValue([
      membership('chapter-a'),
      membership('chapter-b'),
    ]);

    await service.deleteAccount('user-1');

    expect(listedPrefixes('profiles')).toEqual([
      'chapters/chapter-a/profiles/user-1',
      'chapters/chapter-b/profiles/user-1',
    ]);
  });

  it('purges generated reports for every chapter the member belonged to', async () => {
    mockUserRepo.findById.mockResolvedValue(liveUser);
    mockMemberRepo.findByUser.mockResolvedValue([
      membership('chapter-a'),
      membership('chapter-b'),
    ]);

    await service.deleteAccount('user-1');

    // A rendered PDF cannot have one member removed from it, so erasure drops
    // the chapter's whole report prefix — safe because exports are derived
    // artifacts, regenerable from the source tables.
    expect(listedReportPrefixes()).toEqual([
      'chapters/chapter-a/reports',
      'chapters/chapter-b/reports',
    ]);
    expect(mockStorage.deleteFiles).toHaveBeenCalledWith('reports', [
      'chapters/chapter-a/reports/roster.pdf',
    ]);
  });

  it('does not reach reports in a chapter the member has already left', async () => {
    // `members` rows are hard-deleted on removal, so a left chapter is simply
    // absent from findByUser. Documented in spec/behavior/data-retention.md as
    // covered by the 24h sweep instead — asserted here so the gap stays a
    // known, bounded one rather than an accidental regression.
    mockUserRepo.findById.mockResolvedValue(liveUser);
    mockMemberRepo.findByUser.mockResolvedValue([membership('chapter-a')]);

    await service.deleteAccount('user-1');

    expect(listedReportPrefixes()).toEqual(['chapters/chapter-a/reports']);
  });

  it('completes the deletion when the report purge fails, rather than revoking erasure', async () => {
    mockUserRepo.findById.mockResolvedValue(liveUser);
    mockStorage.listObjects.mockRejectedValue(new Error('reports listing 500'));

    // Reports have their own 24h reaper; profile photos do not. Aborting here
    // would trade a bounded delay for an unbounded harm — the user could never
    // complete erasure, and every retry would re-delete their avatars while
    // leaving the account alive.
    await expect(service.deleteAccount('user-1')).resolves.toBeUndefined();
    expect(mockUserRepo.anonymize).toHaveBeenCalledWith('user-1');
    expect(mockAuthAdmin.deleteAuthUser).toHaveBeenCalledWith('auth-1');
  });

  it('still aborts before the scrub when the AVATAR purge fails', async () => {
    mockUserRepo.findById.mockResolvedValue(liveUser);
    mockStorage.listFiles.mockRejectedValue(new Error('profiles listing 500'));

    // The asymmetry with reports above is the contract: nothing else ever
    // deletes a profile photo, so this one has to be fatal.
    await expect(service.deleteAccount('user-1')).rejects.toThrow(
      BadGatewayException,
    );
    expect(mockUserRepo.anonymize).not.toHaveBeenCalled();
    expect(mockAuthAdmin.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('skips the report delete for a chapter with no exports', async () => {
    mockUserRepo.findById.mockResolvedValue(liveUser);
    mockStorage.listObjects.mockResolvedValue([]);

    await service.deleteAccount('user-1');

    expect(mockStorage.deleteFiles).not.toHaveBeenCalledWith(
      'reports',
      expect.anything(),
    );
    expect(mockAuthAdmin.deleteAuthUser).toHaveBeenCalledWith('auth-1');
  });

  it('also purges the avatar_url folder when it lives in a chapter the user has left', async () => {
    mockUserRepo.findById.mockResolvedValue({
      ...liveUser,
      avatar_url: 'chapters/old-chapter/profiles/user-1/face.png',
    });
    mockMemberRepo.findByUser.mockResolvedValue([membership('chapter-a')]);

    await service.deleteAccount('user-1');

    expect(mockStorage.listFiles).toHaveBeenCalledWith(
      'profiles',
      'chapters/old-chapter/profiles/user-1',
    );
    expect(mockStorage.listFiles).toHaveBeenCalledWith(
      'profiles',
      'chapters/chapter-a/profiles/user-1',
    );
  });

  it('extracts the avatar folder from a URL-embedded storage path', async () => {
    mockUserRepo.findById.mockResolvedValue({
      ...liveUser,
      avatar_url:
        'https://xyz.supabase.co/storage/v1/object/public/profiles/chapters/old-chapter/profiles/user-1/face.png',
    });
    mockMemberRepo.findByUser.mockResolvedValue([membership('chapter-a')]);

    await service.deleteAccount('user-1');

    expect(mockStorage.listFiles).toHaveBeenCalledWith(
      'profiles',
      'chapters/old-chapter/profiles/user-1',
    );
  });

  it('ignores avatar_url values without a recognizable storage path', async () => {
    mockUserRepo.findById.mockResolvedValue({
      ...liveUser,
      avatar_url: 'https://cdn.example.com/pic.png',
    });

    await service.deleteAccount('user-1');

    expect(listedPrefixes('profiles')).toEqual([
      'chapters/chapter-a/profiles/user-1',
    ]);
  });

  it.each([
    'chapters/x/../y/profiles/user-1/a.png',
    'chapters/x/%2e%2e/y/profiles/user-1/a.png',
    'chapters//x/profiles/user-1/a.png',
  ])(
    'still completes deletion when avatar_url is an unusable path (%p)',
    async (avatarUrl) => {
      // avatar_url is unvalidated free text. The storage layer rejects paths
      // with relative segments, and this purge runs before anything else — so
      // propagating that rejection would turn the user's own right-to-erasure
      // request into a permanent 502 they cannot self-serve out of.
      mockUserRepo.findById.mockResolvedValue({
        ...liveUser,
        avatar_url: avatarUrl,
      });

      await expect(service.deleteAccount('user-1')).resolves.toBeUndefined();

      // Only the membership-derived prefix is swept; the bad value is ignored.
      expect(listedPrefixes('profiles')).toEqual([
        'chapters/chapter-a/profiles/user-1',
      ]);
    },
  );

  it('404s for an unknown user without touching anything', async () => {
    mockUserRepo.findById.mockResolvedValue(null);

    await expect(service.deleteAccount('ghost')).rejects.toThrow(
      NotFoundException,
    );
    expect(mockUserRepo.anonymize).not.toHaveBeenCalled();
    expect(mockAuthAdmin.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('retry on a tombstone finds nothing to purge and still re-runs anonymize, analytics, and auth deletion', async () => {
    mockUserRepo.findById.mockResolvedValue(tombstone);
    mockMemberRepo.findByUser.mockResolvedValue([]);

    await service.deleteAccount('user-1');

    // Memberships and avatar_url were purged by the original run — the purge
    // runs but has no prefixes to sweep.
    expect(mockStorage.listFiles).not.toHaveBeenCalled();
    expect(mockUserRepo.anonymize).toHaveBeenCalledWith('user-1');
    expect(mockAnalytics.forgetUser).toHaveBeenCalledWith('user-1');
    expect(mockAuthAdmin.deleteAuthUser).toHaveBeenCalledWith('auth-1');
  });

  it('aborts with 502 before any mutation when the storage sweep fails', async () => {
    mockUserRepo.findById.mockResolvedValue(liveUser);
    mockStorage.listFiles.mockRejectedValue(new Error('storage down'));

    await expect(service.deleteAccount('user-1')).rejects.toThrow(
      BadGatewayException,
    );
    expect(mockUserRepo.anonymize).not.toHaveBeenCalled();
    expect(mockAnalytics.forgetUser).not.toHaveBeenCalled();
    expect(mockAuthAdmin.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('aborts without scrubbing when a later prefix fails after an earlier one was swept', async () => {
    mockUserRepo.findById.mockResolvedValue(liveUser);
    mockMemberRepo.findByUser.mockResolvedValue([
      membership('chapter-a'),
      membership('chapter-b'),
    ]);
    mockStorage.listFiles
      .mockResolvedValueOnce(['chapters/chapter-a/profiles/user-1/pic.png'])
      .mockRejectedValueOnce(new Error('second prefix 500'));

    await expect(service.deleteAccount('user-1')).rejects.toThrow(
      BadGatewayException,
    );
    // First folder's objects are gone (they belonged to the requester and the
    // retry re-covers the remainder), but no account data was touched.
    expect(mockStorage.deleteFiles).toHaveBeenCalledTimes(1);
    expect(mockUserRepo.anonymize).not.toHaveBeenCalled();
    expect(mockAuthAdmin.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('aborts with 502 before any mutation when membership enumeration fails', async () => {
    mockUserRepo.findById.mockResolvedValue(liveUser);
    mockMemberRepo.findByUser.mockRejectedValue(new Error('db blip'));

    await expect(service.deleteAccount('user-1')).rejects.toThrow(
      BadGatewayException,
    );
    expect(mockUserRepo.anonymize).not.toHaveBeenCalled();
    expect(mockAuthAdmin.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('aborts with 502 before auth deletion when the analytics forget is not confirmed', async () => {
    mockUserRepo.findById.mockResolvedValue(liveUser);
    mockAnalytics.forgetUser.mockResolvedValue(false);

    await expect(service.deleteAccount('user-1')).rejects.toThrow(
      BadGatewayException,
    );
    expect(mockUserRepo.anonymize).toHaveBeenCalled();
    expect(mockAuthAdmin.deleteAuthUser).not.toHaveBeenCalled();
  });

  it('maps an auth-deletion failure to 502 after the database is already anonymized', async () => {
    mockUserRepo.findById.mockResolvedValue(liveUser);
    mockAuthAdmin.deleteAuthUser.mockRejectedValue(new Error('gotrue down'));

    await expect(service.deleteAccount('user-1')).rejects.toThrow(
      BadGatewayException,
    );
    expect(mockUserRepo.anonymize).toHaveBeenCalled();
    expect(mockAnalytics.forgetUser).toHaveBeenCalled();
  });

  it('404s when the user vanishes between lookup and anonymize', async () => {
    mockUserRepo.findById.mockResolvedValue(liveUser);
    mockUserRepo.anonymize.mockResolvedValue(null);

    await expect(service.deleteAccount('user-1')).rejects.toThrow(
      NotFoundException,
    );
    expect(mockAuthAdmin.deleteAuthUser).not.toHaveBeenCalled();
  });

  // #349: account deletion is the other orphaning cause spec/behavior/rbac.md's
  // Presidency Transfer "Edge case" names, alongside MemberService.remove.
  describe('orphan-president flagging', () => {
    it('checks every chapter membership held before anonymize for the President role', async () => {
      mockUserRepo.findById.mockResolvedValue(liveUser);
      mockMemberRepo.findByUser.mockResolvedValue([
        membership('chapter-a', ['role-president']),
        membership('chapter-b', ['role-member']),
      ]);

      await service.deleteAccount('user-1');

      expect(mockRbacService.flagIfPresidentRemoved).toHaveBeenCalledTimes(2);
      expect(mockRbacService.flagIfPresidentRemoved).toHaveBeenCalledWith(
        'chapter-a',
        ['role-president'],
        null,
      );
      expect(mockRbacService.flagIfPresidentRemoved).toHaveBeenCalledWith(
        'chapter-b',
        ['role-member'],
        null,
      );
    });

    it('runs the check after anonymize (so it reads the pre-deletion membership snapshot) and before analytics forget', async () => {
      mockUserRepo.findById.mockResolvedValue(liveUser);
      mockRbacService.flagIfPresidentRemoved.mockImplementation(async () => {
        callOrder.push('flagIfPresidentRemoved');
      });

      await service.deleteAccount('user-1');

      const anonymizeIndex = callOrder.indexOf('anonymize');
      const flagIndex = callOrder.indexOf('flagIfPresidentRemoved');
      const forgetIndex = callOrder.indexOf('forgetUser');
      expect(anonymizeIndex).toBeLessThan(flagIndex);
      expect(flagIndex).toBeLessThan(forgetIndex);
    });

    it('completes deletion when orphan-flagging fails, rather than blocking erasure', async () => {
      mockUserRepo.findById.mockResolvedValue(liveUser);
      mockRbacService.flagIfPresidentRemoved.mockRejectedValue(
        new Error('chapters table down'),
      );

      await expect(service.deleteAccount('user-1')).resolves.toBeUndefined();
      expect(mockAnalytics.forgetUser).toHaveBeenCalledWith('user-1');
      expect(mockAuthAdmin.deleteAuthUser).toHaveBeenCalledWith('auth-1');
    });

    it('still flags every other chapter when one chapter fails, rather than aborting the whole loop', async () => {
      // A President-of-multiple-chapters deleting their account must not have
      // chapter B (and C) silently skipped because chapter A's flag write
      // failed — each membership is isolated in its own try/catch.
      mockUserRepo.findById.mockResolvedValue(liveUser);
      mockMemberRepo.findByUser.mockResolvedValue([
        membership('chapter-a', ['role-president']),
        membership('chapter-b', ['role-president']),
        membership('chapter-c', ['role-president']),
      ]);
      mockRbacService.flagIfPresidentRemoved.mockImplementation(
        async (chapterId: string) => {
          if (chapterId === 'chapter-a') {
            throw new Error('chapters table down for chapter-a');
          }
        },
      );

      await expect(service.deleteAccount('user-1')).resolves.toBeUndefined();

      expect(mockRbacService.flagIfPresidentRemoved).toHaveBeenCalledWith(
        'chapter-a',
        ['role-president'],
        null,
      );
      expect(mockRbacService.flagIfPresidentRemoved).toHaveBeenCalledWith(
        'chapter-b',
        ['role-president'],
        null,
      );
      expect(mockRbacService.flagIfPresidentRemoved).toHaveBeenCalledWith(
        'chapter-c',
        ['role-president'],
        null,
      );
      expect(mockAuthAdmin.deleteAuthUser).toHaveBeenCalledWith('auth-1');
    });

    it('does not check a chapter the member has already left', async () => {
      mockUserRepo.findById.mockResolvedValue(liveUser);
      mockMemberRepo.findByUser.mockResolvedValue([]);

      await service.deleteAccount('user-1');

      expect(mockRbacService.flagIfPresidentRemoved).not.toHaveBeenCalled();
    });
  });
});
