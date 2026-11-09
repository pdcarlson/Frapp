import { TimeZoneSyncService } from '../../application/services/time-zone-sync.service';
import { TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ChapterGuard } from '../guards/chapter.guard';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import { InviteController } from './invite.controller';
import { InviteService } from '../../application/services/invite.service';
import { AuthService } from '../../application/services/auth.service';
import {
  CreateInviteDto,
  BatchCreateInvitesDto,
  BulkEmailInviteDto,
  RedeemInviteDto,
} from '../dtos/invite.dto';

describe('InviteController', () => {
  let controller: InviteController;
  let inviteService: InviteService;

  beforeEach(async () => {
    const mockInviteService = {
      create: jest.fn(),
      createBatch: jest.fn(),
      createWithEmails: jest.fn(),
      redeem: jest.fn(),
      findByChapter: jest.fn(),
      findPendingForVerifiedEmail: jest.fn(),
      revoke: jest.fn(),
    };

    const mockAuthService = {
      // Mock any methods if needed
    };

    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [InviteController],
      providers: [
        {
          provide: InviteService,
          useValue: mockInviteService,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        { provide: TimeZoneSyncService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    controller = module.get<InviteController>(InviteController);
    inviteService = module.get<InviteService>(InviteService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('create', () => {
    it('should call inviteService.create with correct arguments', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const dto: CreateInviteDto = { role: 'Member' };
      const expectedResult = { token: 'invite-token-1' };

      jest
        .spyOn(inviteService, 'create')
        .mockResolvedValue(expectedResult as any);

      const result = await controller.create(chapterId, userId, dto);

      expect(inviteService.create).toHaveBeenCalledWith(
        chapterId,
        userId,
        dto.role,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('createBatch', () => {
    it('should call inviteService.createBatch with correct arguments', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const dto: BatchCreateInvitesDto = { role: 'Member', count: 5 };
      const expectedResult = [
        { token: 'invite-token-1' },
        { token: 'invite-token-2' },
      ];

      jest
        .spyOn(inviteService, 'createBatch')
        .mockResolvedValue(expectedResult as any);

      const result = await controller.createBatch(chapterId, userId, dto);

      expect(inviteService.createBatch).toHaveBeenCalledWith(
        chapterId,
        userId,
        dto.role,
        dto.count,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('createWithEmails', () => {
    it('should call inviteService.createWithEmails with correct arguments', async () => {
      const chapterId = 'chapter-1';
      const userId = 'user-1';
      const dto: BulkEmailInviteDto = {
        role: 'Member',
        emails: ['a@example.com', 'b@example.com'],
      };
      const expectedResult = {
        invites: [{ token: 'invite-token-1' }, { token: 'invite-token-2' }],
        failed: [],
      };

      jest
        .spyOn(inviteService, 'createWithEmails')
        .mockResolvedValue(expectedResult as any);

      const result = await controller.createWithEmails(chapterId, userId, dto);

      expect(inviteService.createWithEmails).toHaveBeenCalledWith(
        chapterId,
        userId,
        dto.role,
        dto.emails,
      );
      expect(result).toEqual(expectedResult);
    });
  });

  describe('redeem', () => {
    it('should call inviteService.redeem with correct arguments', async () => {
      const userId = 'user-1';
      const dto: RedeemInviteDto = { token: 'invite-token-1' };
      const expectedResult = { chapterId: 'chapter-1', memberId: 'member-1' };

      jest.spyOn(inviteService, 'redeem').mockResolvedValue(expectedResult);

      const result = await controller.redeem(userId, dto);

      // No checkbox sent: the service checks for an existing acceptance.
      expect(inviteService.redeem).toHaveBeenCalledWith(
        dto.token,
        userId,
        false,
      );
      expect(result).toEqual(expectedResult);
    });

    it('passes the Terms checkbox through to the service (#2302)', async () => {
      const dto: RedeemInviteDto = {
        token: 'invite-token-1',
        accept_terms_privacy: true,
      };
      jest
        .spyOn(inviteService, 'redeem')
        .mockResolvedValue({ chapterId: 'chapter-1', memberId: 'member-1' });

      await controller.redeem('user-1', dto);

      expect(inviteService.redeem).toHaveBeenCalledWith(
        'invite-token-1',
        'user-1',
        true,
      );
    });
  });

  describe('list', () => {
    it('should call inviteService.findByChapter with correct arguments', async () => {
      const chapterId = 'chapter-1';
      const expectedResult = [
        { id: 'inv-1', token: 'token-1', chapter_id: 'chapter-1' },
      ];

      jest
        .spyOn(inviteService, 'findByChapter')
        .mockResolvedValue(expectedResult as any);

      const result = await controller.list(chapterId);

      expect(inviteService.findByChapter).toHaveBeenCalledWith(chapterId);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('listMine (#3776)', () => {
    /** The route's own params, resolved against a request the way Nest does. */
    const resolveParams = (request: unknown) => {
      const ctx = {
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext;
      const args = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        InviteController,
        'listMine',
      ) as Record<
        string,
        {
          index: number;
          data?: unknown;
          factory?: (data: unknown, ctx: ExecutionContext) => unknown;
        }
      >;
      return Object.values(args)
        .sort((a, b) => a.index - b.index)
        .map((arg) => arg.factory!(arg.data, ctx));
    };

    it('passes the caller and their verified address to the service', async () => {
      jest
        .spyOn(inviteService, 'findPendingForVerifiedEmail')
        .mockResolvedValue([]);
      await controller.listMine('user-1', 'a@school.edu');
      expect(inviteService.findPendingForVerifiedEmail).toHaveBeenCalledWith(
        'a@school.edu',
        'user-1',
      );
    });

    it("reads the address Auth verified, never the request's own", () => {
      const params = resolveParams({
        appUser: { id: 'user-1' },
        supabaseUser: {
          email: 'a@school.edu',
          email_confirmed_at: '2026-11-01T00:00:00Z',
        },
        body: { email: 'victim@school.edu' },
        query: { email: 'victim@school.edu' },
      });
      expect(params).toEqual(['user-1', 'a@school.edu']);
    });

    it('reads no address while the account is unconfirmed', () => {
      const params = resolveParams({
        appUser: { id: 'user-1' },
        supabaseUser: { email: 'a@school.edu', email_confirmed_at: null },
      });
      expect(params).toEqual(['user-1', null]);
    });

    it('needs no chapter: a member of none can read it', () => {
      const guards =
        (Reflect.getMetadata(
          GUARDS_METADATA,
          InviteController.prototype.listMine,
        ) as unknown[] | undefined) ?? [];
      expect(guards).not.toContain(ChapterGuard);
    });
  });

  describe('revoke', () => {
    it('should call inviteService.revoke with correct arguments and return success', async () => {
      const chapterId = 'chapter-1';
      const inviteId = 'inv-1';

      jest.spyOn(inviteService, 'revoke').mockResolvedValue(undefined);

      const result = await controller.revoke(chapterId, inviteId);

      expect(inviteService.revoke).toHaveBeenCalledWith(inviteId, chapterId);
      expect(result).toEqual({ success: true });
    });
  });
});
