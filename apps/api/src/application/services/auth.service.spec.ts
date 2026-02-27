import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { USER_REPOSITORY } from '../../domain/repositories/user.repository.interface';
import type { IUserRepository } from '../../domain/repositories/user.repository.interface';

describe('AuthService', () => {
  let service: AuthService;
  let mockRepo: jest.Mocked<IUserRepository>;

  beforeEach(async () => {
    mockRepo = {
      findById: jest.fn(),
      findByIds: jest.fn(),
      findBySupabaseAuthId: jest.fn(),
      findByEmail: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
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
});
