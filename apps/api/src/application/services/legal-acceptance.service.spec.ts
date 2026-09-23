import { GoneException, NotFoundException } from '@nestjs/common';
import {
  LEGAL_ACCEPTANCE_REQUIRED_CODE,
  LegalAcceptanceService,
} from './legal-acceptance.service';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import type { User } from '#domain/entities/user.entity';

jest.mock('@repo/validation', () => ({
  LEGAL_POLICY_VERSION: 'current-version',
}));

const baseUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  supabase_auth_id: 'auth-1',
  email: 'member@example.com',
  display_name: 'Member',
  avatar_url: null,
  bio: null,
  graduation_year: null,
  current_city: null,
  current_company: null,
  active_chapter_id: null,
  deleted_at: null,
  legal_accepted_at: null,
  legal_policy_version: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('LegalAcceptanceService (#2302)', () => {
  let userRepo: jest.Mocked<Pick<IUserRepository, 'findById' | 'update'>>;
  let service: LegalAcceptanceService;

  beforeEach(() => {
    userRepo = {
      findById: jest.fn(),
      update: jest.fn((id: string, data: Partial<User>) =>
        Promise.resolve(baseUser({ id, ...data })),
      ),
    };
    service = new LegalAcceptanceService(
      userRepo as unknown as IUserRepository,
    );
  });

  describe('status', () => {
    it('requires acceptance from a user who never accepted', async () => {
      userRepo.findById.mockResolvedValue(baseUser());

      await expect(service.status('user-1')).resolves.toEqual({
        current_version: 'current-version',
        accepted_version: null,
        accepted_at: null,
        required: true,
      });
    });

    it('requires acceptance again when the version changed', async () => {
      userRepo.findById.mockResolvedValue(
        baseUser({
          legal_policy_version: 'older-version',
          legal_accepted_at: '2026-03-01T00:00:00.000Z',
        }),
      );

      await expect(service.status('user-1')).resolves.toMatchObject({
        accepted_version: 'older-version',
        required: true,
      });
    });

    it('does not ask a user who accepted the current version', async () => {
      userRepo.findById.mockResolvedValue(
        baseUser({
          legal_policy_version: 'current-version',
          legal_accepted_at: '2026-09-23T00:00:00.000Z',
        }),
      );

      await expect(service.status('user-1')).resolves.toMatchObject({
        accepted_at: '2026-09-23T00:00:00.000Z',
        required: false,
      });
    });

    it('treats a row that predates the columns as never accepted', async () => {
      const legacy = baseUser();
      delete legacy.legal_accepted_at;
      delete legacy.legal_policy_version;
      userRepo.findById.mockResolvedValue(legacy);

      await expect(service.status('user-1')).resolves.toMatchObject({
        accepted_version: null,
        accepted_at: null,
        required: true,
      });
    });
  });

  describe('accept', () => {
    it('stamps the server version and clock, never anything from the caller', async () => {
      userRepo.findById.mockResolvedValue(baseUser());
      const before = Date.now();

      const status = await service.accept('user-1');

      expect(userRepo.update).toHaveBeenCalledTimes(1);
      const [id, written] = userRepo.update.mock.calls[0];
      expect(id).toBe('user-1');
      expect(Object.keys(written).sort()).toEqual([
        'legal_accepted_at',
        'legal_policy_version',
      ]);
      expect(written.legal_policy_version).toBe('current-version');
      const stamped = new Date(written.legal_accepted_at!).getTime();
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(Date.now());
      expect(status.required).toBe(false);
    });

    it('re-stamps a user whose acceptance is for an older version', async () => {
      userRepo.findById.mockResolvedValue(
        baseUser({ legal_policy_version: 'older-version' }),
      );

      await service.accept('user-1');

      expect(userRepo.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ legal_policy_version: 'current-version' }),
      );
    });

    it('keeps the first timestamp when the current version is accepted again', async () => {
      userRepo.findById.mockResolvedValue(
        baseUser({
          legal_policy_version: 'current-version',
          legal_accepted_at: '2026-09-23T00:00:00.000Z',
        }),
      );

      const status = await service.accept('user-1');

      expect(userRepo.update).not.toHaveBeenCalled();
      expect(status.accepted_at).toBe('2026-09-23T00:00:00.000Z');
    });

    it('refuses a deleted account without writing to it', async () => {
      userRepo.findById.mockResolvedValue(
        baseUser({ deleted_at: '2026-09-01T00:00:00.000Z' }),
      );

      await expect(service.accept('user-1')).rejects.toBeInstanceOf(
        GoneException,
      );
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('answers 404 for a user that does not exist', async () => {
      userRepo.findById.mockResolvedValue(null);

      await expect(service.accept('user-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('requireOrAccept', () => {
    it('records the acceptance when the checkbox was ticked', async () => {
      userRepo.findById.mockResolvedValue(baseUser());

      await service.requireOrAccept('user-1', true);

      expect(userRepo.update).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ legal_policy_version: 'current-version' }),
      );
    });

    it('refuses with legal.acceptance_required when nothing was accepted', async () => {
      userRepo.findById.mockResolvedValue(baseUser());

      await expect(
        service.requireOrAccept('user-1', false),
      ).rejects.toMatchObject({
        status: 403,
        response: expect.objectContaining({
          code: LEGAL_ACCEPTANCE_REQUIRED_CODE,
        }),
      });
      expect(userRepo.update).not.toHaveBeenCalled();
    });

    it('refuses a user whose acceptance is for an older version', async () => {
      userRepo.findById.mockResolvedValue(
        baseUser({ legal_policy_version: 'older-version' }),
      );

      await expect(
        service.requireOrAccept('user-1', false),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('lets a user who accepted the current version through without the checkbox', async () => {
      userRepo.findById.mockResolvedValue(
        baseUser({ legal_policy_version: 'current-version' }),
      );

      await expect(
        service.requireOrAccept('user-1', false),
      ).resolves.toBeUndefined();
      expect(userRepo.update).not.toHaveBeenCalled();
    });
  });
});
