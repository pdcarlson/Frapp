import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';

const AUTH_ID_UNIQUE_VIOLATION = {
  code: '23505',
  message:
    'duplicate key value violates unique constraint "users_supabase_auth_id_key"',
};

describe('AuthService', () => {
  let service: AuthService;
  let mockRepo: jest.Mocked<IUserRepository>;

  beforeEach(async () => {
    mockRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findDisplayIdentitiesByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      anonymize: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: USER_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('should return existing user when already synced', async () => {
    const existingUser = {
      id: 'user-1',
      supabase_auth_id: 'auth-123',
      email: 'test@example.com',
      display_name: 'test',
      avatar_url: null,
      bio: null,
      graduation_year: null,
      current_city: null,
      current_company: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockRepo.findBySupabaseAuthId.mockResolvedValue(existingUser);

    const result = await service.syncUser('auth-123', 'test@example.com');

    expect(mockRepo.findBySupabaseAuthId).toHaveBeenCalledWith('auth-123');
    expect(mockRepo.create).not.toHaveBeenCalled();
    expect(result).toEqual({ id: 'user-1' });
  });

  it('should create new user when not synced', async () => {
    mockRepo.findBySupabaseAuthId.mockResolvedValue(null);
    const newUser = {
      id: 'user-2',
      supabase_auth_id: 'auth-456',
      email: 'new@example.com',
      display_name: 'new',
      avatar_url: null,
      bio: null,
      graduation_year: null,
      current_city: null,
      current_company: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockRepo.create.mockResolvedValue(newUser);

    const result = await service.syncUser('auth-456', 'new@example.com');

    expect(mockRepo.findBySupabaseAuthId).toHaveBeenCalledWith('auth-456');
    expect(mockRepo.create).toHaveBeenCalledWith({
      supabase_auth_id: 'auth-456',
      email: 'new@example.com',
      display_name: 'new',
    });
    expect(result).toEqual({ id: 'user-2' });
  });

  it('should use email prefix as display_name for new users', async () => {
    mockRepo.findBySupabaseAuthId.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue({
      id: 'user-3',
      supabase_auth_id: 'auth-789',
      email: 'jane.doe@company.org',
      display_name: 'jane.doe',
      avatar_url: null,
      bio: null,
      graduation_year: null,
      current_city: null,
      current_company: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    await service.syncUser('auth-789', 'jane.doe@company.org');

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        display_name: 'jane.doe',
      }),
    );
  });

  it('returns the winner when a parallel first-request insert collides', async () => {
    const racedUser = {
      id: 'user-4',
      supabase_auth_id: 'auth-race',
      email: 'race@example.com',
      display_name: 'race',
      avatar_url: null,
      bio: null,
      graduation_year: null,
      current_city: null,
      current_company: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockRepo.findBySupabaseAuthId
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(racedUser);
    mockRepo.create.mockRejectedValue(AUTH_ID_UNIQUE_VIOLATION);

    const result = await service.syncUser('auth-race', 'race@example.com');

    expect(result).toEqual({ id: 'user-4' });
    expect(mockRepo.create).toHaveBeenCalledTimes(1);
    expect(mockRepo.findBySupabaseAuthId).toHaveBeenCalledTimes(2);
  });

  it('rethrows a unique violation if the colliding row cannot be read back', async () => {
    const collision = AUTH_ID_UNIQUE_VIOLATION;
    mockRepo.findBySupabaseAuthId.mockResolvedValue(null);
    mockRepo.create.mockRejectedValue(collision);

    await expect(
      service.syncUser('auth-missing', 'missing@example.com'),
    ).rejects.toEqual(collision);
  });

  it('rethrows non-unique insert errors', async () => {
    const boom = { code: '42501', message: 'permission denied' };
    mockRepo.findBySupabaseAuthId.mockResolvedValue(null);
    mockRepo.create.mockRejectedValue(boom);

    await expect(
      service.syncUser('auth-denied', 'denied@example.com'),
    ).rejects.toEqual(boom);
    expect(mockRepo.findBySupabaseAuthId).toHaveBeenCalledTimes(1);
  });

  it('stores a placeholder email when Apple omits one', async () => {
    mockRepo.findBySupabaseAuthId.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue({
      id: 'user-5',
      supabase_auth_id: 'auth-apple',
      email: 'noreply+auth-apple@users.invalid',
      display_name: 'Ada Lovelace',
      avatar_url: null,
      bio: null,
      graduation_year: null,
      current_city: null,
      current_company: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    await service.syncUser('auth-apple', '', { full_name: 'Ada Lovelace' });

    expect(mockRepo.create).toHaveBeenCalledWith({
      supabase_auth_id: 'auth-apple',
      email: 'noreply+auth-apple@users.invalid',
      display_name: 'Ada Lovelace',
    });
  });

  it('names a private-relay user Member when Auth sent no display name', async () => {
    mockRepo.findBySupabaseAuthId.mockResolvedValue(null);
    mockRepo.create.mockResolvedValue({
      id: 'user-6',
      supabase_auth_id: 'auth-relay',
      email: 'n@privaterelay.appleid.com',
      display_name: 'Member',
      avatar_url: null,
      bio: null,
      graduation_year: null,
      current_city: null,
      current_company: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    await service.syncUser('auth-relay', 'n@privaterelay.appleid.com');

    expect(mockRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'n@privaterelay.appleid.com',
        display_name: 'Member',
      }),
    );
  });

  it('adopts a real email onto a placeholder row and never the reverse', async () => {
    const placeholderUser = {
      id: 'user-7',
      supabase_auth_id: 'auth-adopt',
      email: 'noreply+auth-adopt@users.invalid',
      display_name: 'Member',
      avatar_url: null,
      bio: null,
      graduation_year: null,
      current_city: null,
      current_company: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };
    mockRepo.findBySupabaseAuthId.mockResolvedValue(placeholderUser);
    mockRepo.update.mockResolvedValue({
      ...placeholderUser,
      email: 'officer@university.edu',
    });

    await service.syncUser('auth-adopt', 'officer@university.edu');

    expect(mockRepo.update).toHaveBeenCalledWith('user-7', {
      email: 'officer@university.edu',
    });
  });

  it('does not replace a university email with Apple Hide My Email', async () => {
    mockRepo.findBySupabaseAuthId.mockResolvedValue({
      id: 'user-8',
      supabase_auth_id: 'auth-keep',
      email: 'officer@university.edu',
      display_name: 'officer',
      avatar_url: null,
      bio: null,
      graduation_year: null,
      current_city: null,
      current_company: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    await service.syncUser('auth-keep', 'n@privaterelay.appleid.com', {
      full_name: 'Ada Lovelace',
    });

    expect(mockRepo.update).not.toHaveBeenCalled();
    expect(mockRepo.create).not.toHaveBeenCalled();
  });

  it('fills an empty display_name on a later request without touching email', async () => {
    mockRepo.findBySupabaseAuthId.mockResolvedValue({
      id: 'user-9',
      supabase_auth_id: 'auth-name',
      email: 'officer@university.edu',
      display_name: '',
      avatar_url: null,
      bio: null,
      graduation_year: null,
      current_city: null,
      current_company: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });
    mockRepo.update.mockResolvedValue({
      id: 'user-9',
      supabase_auth_id: 'auth-name',
      email: 'officer@university.edu',
      display_name: 'Ada Lovelace',
      avatar_url: null,
      bio: null,
      graduation_year: null,
      current_city: null,
      current_company: null,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    });

    await service.syncUser('auth-name', 'officer@university.edu', {
      full_name: 'Ada Lovelace',
    });

    expect(mockRepo.update).toHaveBeenCalledWith('user-9', {
      display_name: 'Ada Lovelace',
    });
  });
});
