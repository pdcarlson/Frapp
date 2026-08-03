import { Test, TestingModule } from '@nestjs/testing';
import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { AccountDeletionService } from './account-deletion.service';
import { AnalyticsService } from './analytics.service';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import type { IStorageProvider } from '../../domain/adapters/storage.interface';
import { AUTH_ADMIN_PROVIDER } from '../../domain/adapters/auth-admin.interface';
import type { IAuthAdminProvider } from '../../domain/adapters/auth-admin.interface';
import type { User } from '../../domain/entities/user.entity';
import type { Member } from '../../domain/entities/member.entity';

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
} as User;

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
} as User;

const membership = (chapterId: string) =>
  ({
    id: `m-${chapterId}`,
    user_id: 'user-1',
    chapter_id: chapterId,
  }) as Member;

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;
  let mockUserRepo: jest.Mocked<IUserRepository>;
  let mockMemberRepo: jest.Mocked<Pick<IMemberRepository, 'findByUser'>>;
  let mockStorage: jest.Mocked<IStorageProvider>;
  let mockAuthAdmin: jest.Mocked<IAuthAdminProvider>;
  let mockAnalytics: { forgetUser: jest.Mock };
  let callOrder: string[];

  beforeEach(async () => {
    callOrder = [];
    mockUserRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
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
      deleteFile: jest.fn(),
      deleteFiles: jest.fn(async () => {
        callOrder.push('deleteFiles');
      }),
      listFiles: jest.fn(async (_bucket: string, prefix: string) => {
        callOrder.push('listFiles');
        return [`${prefix}/pic.png`];
      }),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountDeletionService,
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
        { provide: STORAGE_PROVIDER, useValue: mockStorage },
        { provide: AUTH_ADMIN_PROVIDER, useValue: mockAuthAdmin },
        { provide: AnalyticsService, useValue: mockAnalytics },
      ],
    }).compile();

    service = module.get(AccountDeletionService);
  });

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
      'anonymize',
      'forgetUser',
      'deleteAuthUser',
      'anonymize',
    ]);
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

    expect(mockStorage.listFiles).toHaveBeenCalledTimes(2);
    expect(mockStorage.listFiles).toHaveBeenCalledWith(
      'profiles',
      'chapters/chapter-b/profiles/user-1',
    );
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

    expect(mockStorage.listFiles).toHaveBeenCalledTimes(1);
    expect(mockStorage.listFiles).toHaveBeenCalledWith(
      'profiles',
      'chapters/chapter-a/profiles/user-1',
    );
  });

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
});
