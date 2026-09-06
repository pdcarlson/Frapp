import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ChapterAuditLogService } from './chapter-audit-log.service';
import {
  CHAPTER_AUDIT_LOG_REPOSITORY,
  type IChapterAuditLogRepository,
} from '#domain/repositories/chapter-audit-log.repository.interface';
import {
  ROLE_REPOSITORY,
  type IRoleRepository,
} from '#domain/repositories/role.repository.interface';
import { SystemRoleKeys } from '#domain/constants/permissions';
import type { Role } from '#domain/entities/role.entity';

// The chapter's seeded President role. Every `list` case below reads as the
// President unless it says otherwise, so the visibility assertions on the
// existing filter tests keep meaning "no visibility filter was added".
const PRESIDENT_ROLE: Role = {
  id: 'role-president-1',
  chapter_id: 'chapter-1',
  name: 'President',
  permissions: ['*'],
  is_system: true,
  system_key: SystemRoleKeys.PRESIDENT,
  display_order: 0,
  color: null,
  created_at: '2026-01-01T00:00:00.000Z',
};
const PRESIDENT = { roleIds: [PRESIDENT_ROLE.id] };
const OFFICER = { roleIds: ['role-treasurer-1'] };

describe('ChapterAuditLogService', () => {
  let service: ChapterAuditLogService;
  let mockRepo: jest.Mocked<IChapterAuditLogRepository>;
  let mockRoleRepo: jest.Mocked<IRoleRepository>;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn(),
      findByChapter: jest.fn(),
    };
    mockRoleRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findByIds: jest.fn(),
      findByChapterAndName: jest.fn(),
      findByChapterAndSystemKey: jest.fn().mockResolvedValue(PRESIDENT_ROLE),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterAuditLogService,
        { provide: CHAPTER_AUDIT_LOG_REPOSITORY, useValue: mockRepo },
        { provide: ROLE_REPOSITORY, useValue: mockRoleRepo },
      ],
    }).compile();

    service = module.get(ChapterAuditLogService);
  });

  describe('record', () => {
    it('writes an insert-only row scoped to the given chapter', async () => {
      mockRepo.create.mockResolvedValue({
        id: 'audit-1',
        chapter_id: 'chapter-1',
        actor_user_id: 'actor-1',
        action: 'member_removed',
        target_type: 'member',
        target_id: 'member-1',
        scope: 'chapter',
        diff: {},
        member_visible: true,
        created_at: '2026-01-01T00:00:00.000Z',
      });

      await service.record({
        chapterId: 'chapter-1',
        actorUserId: 'actor-1',
        action: 'member_removed',
        targetType: 'member',
        targetId: 'member-1',
        diff: { user_id: 'user-1' },
      });

      expect(mockRepo.create).toHaveBeenCalledWith({
        chapter_id: 'chapter-1',
        actor_user_id: 'actor-1',
        action: 'member_removed',
        target_type: 'member',
        target_id: 'member-1',
        scope: 'chapter',
        diff: { user_id: 'user-1' },
        member_visible: true,
      });
    });

    it('defaults diff to {} and member_visible to true when omitted', async () => {
      mockRepo.create.mockResolvedValue({
        id: 'audit-2',
        chapter_id: 'chapter-1',
        actor_user_id: null,
        action: 'system_action',
        target_type: 'chapter',
        target_id: null,
        scope: 'chapter',
        diff: {},
        member_visible: true,
        created_at: '2026-01-01T00:00:00.000Z',
      });

      await service.record({
        chapterId: 'chapter-1',
        actorUserId: null,
        action: 'system_action',
        targetType: 'chapter',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ diff: {}, member_visible: true }),
      );
    });

    it('propagates a repository failure rather than swallowing it', async () => {
      mockRepo.create.mockRejectedValue(new Error('insert failed'));

      await expect(
        service.record({
          chapterId: 'chapter-1',
          actorUserId: 'actor-1',
          action: 'member_removed',
          targetType: 'member',
        }),
      ).rejects.toThrow('insert failed');
    });
  });

  describe('list', () => {
    it('scopes the read to the given chapter and clamps limit to the default', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      await service.list('chapter-1', PRESIDENT, {});

      expect(mockRepo.findByChapter).toHaveBeenCalledWith('chapter-1', {
        before: undefined,
        actorUserId: undefined,
        action: undefined,
        startDate: undefined,
        endDate: undefined,
        memberVisibleOnly: false,
        limit: 50,
      });
    });

    // #1773. The table has no SELECT policy; this service is the visibility
    // filter the migration comment promised. Exec-only rows are for the
    // President — identified by the chapter's seeded `PRESIDENT` role, never by
    // a permission a custom role could be minted with.
    describe('exec-only visibility (#1773)', () => {
      beforeEach(() => {
        mockRepo.findByChapter.mockResolvedValue([]);
      });

      it('lets the President read exec-only rows', async () => {
        await service.list('chapter-1', PRESIDENT, {});

        expect(mockRoleRepo.findByChapterAndSystemKey).toHaveBeenCalledWith(
          'chapter-1',
          SystemRoleKeys.PRESIDENT,
        );
        expect(mockRepo.findByChapter).toHaveBeenCalledWith(
          'chapter-1',
          expect.objectContaining({ memberVisibleOnly: false }),
        );
      });

      it('restricts every other officer to member-visible rows', async () => {
        await service.list('chapter-1', OFFICER, { action: 'member_removed' });

        expect(mockRepo.findByChapter).toHaveBeenCalledWith(
          'chapter-1',
          expect.objectContaining({
            action: 'member_removed',
            memberVisibleOnly: true,
          }),
        );
      });

      it('restricts a viewer holding the President role of ANOTHER chapter', async () => {
        // The lookup is chapter-scoped by construction: the role resolved is
        // chapter-1's President, and a foreign role id simply is not it.
        mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue({
          ...PRESIDENT_ROLE,
          id: 'role-president-of-chapter-1',
        });

        await service.list(
          'chapter-1',
          { roleIds: ['role-president-of-chapter-2'] },
          {},
        );

        expect(mockRepo.findByChapter).toHaveBeenCalledWith(
          'chapter-1',
          expect.objectContaining({ memberVisibleOnly: true }),
        );
      });

      it('fails closed when the chapter has no President role', async () => {
        mockRoleRepo.findByChapterAndSystemKey.mockResolvedValue(null);

        await service.list('chapter-1', PRESIDENT, {});

        expect(mockRepo.findByChapter).toHaveBeenCalledWith(
          'chapter-1',
          expect.objectContaining({ memberVisibleOnly: true }),
        );
      });

      it('does not look roles up for a viewer with no seeded roles', async () => {
        await service.list('chapter-1', { roleIds: [] }, {});

        expect(mockRoleRepo.findByChapterAndSystemKey).not.toHaveBeenCalled();
        expect(mockRepo.findByChapter).toHaveBeenCalledWith(
          'chapter-1',
          expect.objectContaining({ memberVisibleOnly: true }),
        );
      });
    });

    it('clamps an over-large limit to the max', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      await service.list('chapter-1', PRESIDENT, { limit: 10_000 });

      expect(mockRepo.findByChapter).toHaveBeenCalledWith(
        'chapter-1',
        expect.objectContaining({ limit: 200 }),
      );
    });

    it('clamps a zero/negative limit up to the min', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      await service.list('chapter-1', PRESIDENT, { limit: 0 });

      expect(mockRepo.findByChapter).toHaveBeenCalledWith(
        'chapter-1',
        expect.objectContaining({ limit: 1 }),
      );
    });

    it('passes a valid before cursor through unchanged', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      // Deliberately microsecond-precision and not a round, millisecond-only
      // instant: reformatting this through `new Date(x).toISOString()` would
      // truncate it to '...123Z' and could drop a same-millisecond row off
      // the cursor — the exact regression this test pins against.
      await service.list('chapter-1', PRESIDENT, {
        before: '2026-01-01T00:00:00.123456+00:00',
      });

      expect(mockRepo.findByChapter).toHaveBeenCalledWith(
        'chapter-1',
        expect.objectContaining({ before: '2026-01-01T00:00:00.123456+00:00' }),
      );
    });

    it('passes each filter through to the repository', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      await service.list('chapter-1', PRESIDENT, {
        actorUserId: 'actor-1',
        action: 'member_removed',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-02-01T00:00:00.000Z',
      });

      expect(mockRepo.findByChapter).toHaveBeenCalledWith(
        'chapter-1',
        expect.objectContaining({
          actorUserId: 'actor-1',
          action: 'member_removed',
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-02-01T00:00:00.000Z',
        }),
      );
    });

    // Same regression as the `before` pin below, extended to the window: the
    // bounds are parsed to compare them and must reach the repository as the
    // caller's original strings. `new Date(x).toISOString()` would truncate
    // these to millisecond precision.
    it('passes window bounds through byte-for-byte, microseconds intact', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      await service.list('chapter-1', PRESIDENT, {
        startDate: '2026-01-01T00:00:00.123456+00:00',
        endDate: '2026-02-01T00:00:00.654321+00:00',
      });

      expect(mockRepo.findByChapter).toHaveBeenCalledWith(
        'chapter-1',
        expect.objectContaining({
          startDate: '2026-01-01T00:00:00.123456+00:00',
          endDate: '2026-02-01T00:00:00.654321+00:00',
        }),
      );
    });

    it('rejects an inverted window rather than returning nothing', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      await expect(
        service.list('chapter-1', PRESIDENT, {
          startDate: '2026-02-01T00:00:00.000Z',
          endDate: '2026-01-01T00:00:00.000Z',
        }),
        // The TYPE is asserted, not just the message: a plain `Error` here
        // would surface as a 500 and every message-only assertion would still
        // pass, which is the opposite of what this test is for.
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.list('chapter-1', PRESIDENT, {
          startDate: '2026-02-01T00:00:00.000Z',
          endDate: '2026-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow('start_date must not be after end_date');

      // The point of the 400: Postgres would accept the inverted range and
      // return zero rows, which reads as "nothing happened".
      expect(mockRepo.findByChapter).not.toHaveBeenCalled();
    });

    it('accepts an equal-instant window written with different offsets', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      // Compared as instants, not as strings: '…Z' sorts after '…+00:00'
      // lexicographically, so a string comparison would 400 this valid range.
      await expect(
        service.list('chapter-1', PRESIDENT, {
          startDate: '2026-01-01T00:00:00.000Z',
          endDate: '2026-01-01T00:00:00.000+00:00',
        }),
      ).resolves.toEqual([]);
    });

    // Every one of these is a value the API must NOT accept, and the reason is
    // the same in each case: a bound the server cannot evaluate used to be
    // dropped, and a dropped bound WIDENS the result set. The caller receives
    // rows from outside the window they asked for, behind a 200, with nothing
    // to tell them. Rejecting is the only answer that cannot mislead.
    it.each([
      ['gibberish', 'not-a-date'],
      // Passes a non-strict ISO8601 check and JS rolls it to March 2 rather
      // than failing, so it used to reach Postgres and raise 22008 — a 500 on
      // what is plainly a 400.
      ['a day that does not exist', '2026-02-30T00:00:00.000Z'],
      // Reaches a timestamptz column as midnight, so an "inclusive" upper
      // bound would silently drop the whole final day.
      ['a bare date', '2026-01-31'],
      // Resolved in the Node process zone by JS and the session zone by
      // Postgres: the value compares as one instant and filters as another.
      ['a time with no offset', '2026-01-31T12:00:00'],
      // All legal ISO 8601 and all `Invalid Date` in JS.
      ['an hour-only offset', '2026-01-31T12:00:00+05'],
      ['an ordinal date', '2026-045T12:00:00Z'],
      ['a week date', '2026-W05-3T12:00:00Z'],
      ['basic format', '20260131T120000Z'],
      ['an impossible hour', '2026-01-31T24:00:00Z'],
    ])(
      'rejects %s as a window bound rather than ignoring it',
      async (_why, value) => {
        mockRepo.findByChapter.mockResolvedValue([]);

        await expect(
          service.list('chapter-1', PRESIDENT, { startDate: value }),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.list('chapter-1', PRESIDENT, { endDate: value }),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.list('chapter-1', PRESIDENT, { before: value }),
        ).rejects.toThrow(BadRequestException);

        expect(mockRepo.findByChapter).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['seconds and Zulu', '2026-01-31T12:00:00Z'],
      ['milliseconds and Zulu', '2026-01-31T12:00:00.000Z'],
      // The form PostgREST actually returns, at the precision the cursor
      // exists to preserve.
      ['microseconds and a numeric offset', '2026-01-31T12:00:00.123456+00:00'],
      ['a non-UTC offset', '2026-01-31T12:00:00-05:00'],
      ['no seconds', '2026-01-31T12:00Z'],
      ['a real leap day', '2028-02-29T12:00:00Z'],
    ])('accepts %s', async (_why, value) => {
      mockRepo.findByChapter.mockResolvedValue([]);

      await expect(
        service.list('chapter-1', PRESIDENT, {
          startDate: value,
          before: value,
        }),
      ).resolves.toEqual([]);
    });
  });
});
