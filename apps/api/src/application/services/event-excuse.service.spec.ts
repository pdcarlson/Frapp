import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventExcuseService } from './event-excuse.service';
import { AttendanceService } from './attendance.service';
import { NotificationService } from './notification.service';
import { RbacService } from './rbac.service';
import { EVENT_EXCUSE_REPOSITORY } from '#domain/repositories/event-excuse.repository.interface';
import { EVENT_REPOSITORY } from '#domain/repositories/event.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { Event } from '#domain/entities/event.entity';
import type { EventExcuse } from '#domain/entities/event-excuse.entity';
import { SystemPermissions } from '#domain/constants/permissions';

const HOUR = 60 * 60 * 1000;

describe('EventExcuseService', () => {
  let service: EventExcuseService;
  let excuseRepo: {
    findByEvent: jest.Mock;
    findByEventAndUser: jest.Mock;
    findUserIdsByEventAndStatus: jest.Mock;
    create: jest.Mock;
    decideAtomic: jest.Mock;
    withdrawAtomic: jest.Mock;
  };
  let eventRepo: { findById: jest.Mock };
  let memberRepo: { findByUserAndChapter: jest.Mock; findByChapter: jest.Mock };
  let attendanceRepo: { findByEventAndUser: jest.Mock };
  let userRepo: { findDisplayIdentitiesByIds: jest.Mock };
  let attendance: { requiresMember: jest.Mock };
  let rbac: {
    memberHasAnyPermission: jest.Mock;
    findUserIdsWithPermissions: jest.Mock;
  };
  let notifications: { notifyUser: jest.Mock; notifyMembers: jest.Mock };

  /** An event starting `startsInHours` from now, an hour long. */
  const eventAt = (startsInHours: number, over: Partial<Event> = {}): Event => {
    const start = new Date(Date.now() + startsInHours * HOUR);
    return {
      id: 'evt-1',
      chapter_id: 'ch-1',
      name: 'Chapter meeting',
      description: null,
      location: null,
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + HOUR).toISOString(),
      point_value: 10,
      is_mandatory: true,
      recurrence_rule: null,
      parent_event_id: null,
      required_role_ids: null,
      optional_role_ids: null,
      excluded_role_ids: null,
      others_invited: true,
      notes: null,
      check_in_zone: null,
      check_in_zone_name: null,
      check_in_opens_minutes: 10,
      event_type_id: null,
      agenda: [],
      attachments: [],
      created_by: 'creator',
      created_at: '2026-11-01T00:00:00.000Z',
      ...over,
    };
  };

  const excuse = (over: Partial<EventExcuse> = {}): EventExcuse => ({
    id: 'exc-1',
    chapter_id: 'ch-1',
    event_id: 'evt-1',
    user_id: 'member',
    reason: 'Exam review',
    status: 'PENDING',
    decided_by: null,
    decided_at: null,
    created_at: '2026-11-10T00:00:00.000Z',
    updated_at: '2026-11-10T00:00:00.000Z',
    ...over,
  });

  beforeEach(async () => {
    excuseRepo = {
      findByEvent: jest.fn().mockResolvedValue([]),
      findByEventAndUser: jest.fn().mockResolvedValue(null),
      findUserIdsByEventAndStatus: jest.fn().mockResolvedValue([]),
      create: jest
        .fn()
        .mockImplementation((row) => Promise.resolve(excuse({ ...row }))),
      decideAtomic: jest.fn(),
      withdrawAtomic: jest.fn().mockResolvedValue(excuse()),
    };
    eventRepo = { findById: jest.fn().mockResolvedValue(eventAt(72)) };
    memberRepo = {
      findByChapter: jest.fn().mockResolvedValue(
        ['member', 'creator', 'officer-1'].map((user_id) => ({
          user_id,
          role_ids: ['role-member'],
        })),
      ),
      findByUserAndChapter: jest
        .fn()
        .mockImplementation((userId: string) =>
          Promise.resolve({ user_id: userId, role_ids: ['role-member'] }),
        ),
    };
    attendanceRepo = { findByEventAndUser: jest.fn().mockResolvedValue(null) };
    userRepo = {
      findDisplayIdentitiesByIds: jest
        .fn()
        .mockImplementation((ids: string[]) =>
          Promise.resolve(
            ids.map((id) => ({
              id,
              display_name: id === 'creator' ? 'Jake' : 'Sam',
              avatar_url: null,
            })),
          ),
        ),
    };
    attendance = { requiresMember: jest.fn().mockResolvedValue(true) };
    rbac = {
      memberHasAnyPermission: jest.fn().mockResolvedValue(false),
      findUserIdsWithPermissions: jest
        .fn()
        .mockResolvedValue(['officer-1', 'officer-2']),
    };
    notifications = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      notifyMembers: jest.fn().mockResolvedValue(undefined),
    };

    const mod = await Test.createTestingModule({
      providers: [
        EventExcuseService,
        { provide: EVENT_EXCUSE_REPOSITORY, useValue: excuseRepo },
        { provide: EVENT_REPOSITORY, useValue: eventRepo },
        { provide: MEMBER_REPOSITORY, useValue: memberRepo },
        { provide: ATTENDANCE_REPOSITORY, useValue: attendanceRepo },
        { provide: USER_REPOSITORY, useValue: userRepo },
        { provide: AttendanceService, useValue: attendance },
        { provide: RbacService, useValue: rbac },
        { provide: NotificationService, useValue: notifications },
      ],
    }).compile();
    service = mod.get(EventExcuseService);
  });

  describe('submit', () => {
    it('stores a pending excuse with the trimmed reason and pushes the creator', async () => {
      const result = await service.submit(
        'evt-1',
        'member',
        'ch-1',
        '  Exam review ',
      );

      expect(result.status).toBe('PENDING');
      expect(excuseRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        event_id: 'evt-1',
        user_id: 'member',
        reason: 'Exam review',
      });
      expect(notifications.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['creator'],
        expect.objectContaining({
          title: "Sam can't make Chapter meeting",
          body: 'Exam review',
          category: 'events',
        }),
      );
    });

    it('goes to the events:update holders when the creator has left', async () => {
      memberRepo.findByUserAndChapter.mockImplementation((userId: string) =>
        Promise.resolve(
          userId === 'creator' ? null : { user_id: userId, role_ids: [] },
        ),
      );

      await service.submit('evt-1', 'member', 'ch-1', 'Sick');

      expect(rbac.findUserIdsWithPermissions).toHaveBeenCalledWith('ch-1', [
        SystemPermissions.EVENTS_UPDATE,
      ]);
      expect(notifications.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['officer-1', 'officer-2'],
        expect.anything(),
      );
    });

    it('goes to the officers when the creator excuses their own event', async () => {
      await service.submit('evt-1', 'creator', 'ch-1', 'Sick');

      expect(notifications.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['officer-1', 'officer-2'],
        expect.anything(),
      );
    });

    it('goes to the officers when the creator can no longer see the event', async () => {
      // Required of members only; the creator holds another role and no
      // events:update, so every excuse route would 404 them.
      eventRepo.findById.mockResolvedValue(
        eventAt(72, {
          is_mandatory: false,
          others_invited: false,
          required_role_ids: ['role-member'],
        }),
      );
      memberRepo.findByUserAndChapter.mockImplementation((userId: string) =>
        Promise.resolve({
          user_id: userId,
          role_ids: userId === 'creator' ? ['role-alumni'] : ['role-member'],
        }),
      );

      await service.submit('evt-1', 'member', 'ch-1', 'Sick');

      expect(notifications.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['officer-1', 'officer-2'],
        expect.anything(),
      );
    });

    it('refuses an excuse over an ABSENT an officer set', async () => {
      eventRepo.findById.mockResolvedValue(eventAt(-5));
      attendanceRepo.findByEventAndUser.mockResolvedValue({
        status: 'ABSENT',
        marked_by: 'officer-1',
      });

      await expect(
        service.submit('evt-1', 'member', 'ch-1', 'Sick'),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses an event that does not require the member', async () => {
      attendance.requiresMember.mockResolvedValue(false);

      await expect(
        service.submit('evt-1', 'member', 'ch-1', 'Sick'),
      ).rejects.toThrow(BadRequestException);
      expect(excuseRepo.create).not.toHaveBeenCalled();
    });

    it('accepts an excuse a day after the event, and refuses one past 48 hours', async () => {
      eventRepo.findById.mockResolvedValue(eventAt(-25));
      await expect(
        service.submit('evt-1', 'member', 'ch-1', 'Sick'),
      ).resolves.toBeDefined();

      eventRepo.findById.mockResolvedValue(eventAt(-50));
      await expect(
        service.submit('evt-1', 'member', 'ch-1', 'Sick'),
      ).rejects.toThrow(
        'Excuses for this event closed 48 hours after it ended',
      );
    });

    it('accepts a late excuse over an ABSENT the sweep wrote', async () => {
      eventRepo.findById.mockResolvedValue(eventAt(-5));
      attendanceRepo.findByEventAndUser.mockResolvedValue({ status: 'ABSENT' });

      await expect(
        service.submit('evt-1', 'member', 'ch-1', 'Sick'),
      ).resolves.toBeDefined();
    });

    it.each(['PRESENT', 'LATE', 'EXCUSED'])(
      'refuses a member whose attendance is already %s',
      async (status) => {
        attendanceRepo.findByEventAndUser.mockResolvedValue({ status });

        await expect(
          service.submit('evt-1', 'member', 'ch-1', 'Sick'),
        ).rejects.toThrow(ConflictException);
      },
    );

    it('409s a second excuse', async () => {
      excuseRepo.create.mockResolvedValue(null);

      await expect(
        service.submit('evt-1', 'member', 'ch-1', 'Sick'),
      ).rejects.toThrow('You already sent an excuse for this event');
    });

    it('404s an event the member cannot see', async () => {
      eventRepo.findById.mockResolvedValue(
        eventAt(72, { others_invited: false, required_role_ids: ['role-x'] }),
      );

      await expect(
        service.submit('evt-1', 'member', 'ch-1', 'Sick'),
      ).rejects.toThrow(NotFoundException);
    });

    it('still succeeds when the push fails', async () => {
      notifications.notifyMembers.mockRejectedValue(new Error('down'));

      await expect(
        service.submit('evt-1', 'member', 'ch-1', 'Sick'),
      ).resolves.toBeDefined();
    });
  });

  describe('getMine', () => {
    it('names the creator as the receiver', async () => {
      excuseRepo.findByEventAndUser.mockResolvedValue(excuse());

      await expect(service.getMine('evt-1', 'member', 'ch-1')).resolves.toEqual(
        {
          excuse: excuse(),
          receiver: { user_id: 'creator', display_name: 'Jake' },
        },
      );
    });

    it('names nobody on the caller’s own event', async () => {
      const mine = await service.getMine('evt-1', 'creator', 'ch-1');
      expect(mine.receiver).toBeNull();
    });
  });

  describe('withdraw', () => {
    it('withdraws a pending excuse before the event', async () => {
      excuseRepo.findByEventAndUser.mockResolvedValue(excuse());

      await service.withdraw('evt-1', 'member', 'ch-1');

      expect(excuseRepo.withdrawAtomic).toHaveBeenCalledWith(
        'ch-1',
        'evt-1',
        'member',
      );
    });

    it('refuses once check-in has closed', async () => {
      eventRepo.findById.mockResolvedValue(eventAt(-3));
      excuseRepo.findByEventAndUser.mockResolvedValue(excuse());

      await expect(service.withdraw('evt-1', 'member', 'ch-1')).rejects.toThrow(
        ConflictException,
      );
      expect(excuseRepo.withdrawAtomic).not.toHaveBeenCalled();
    });

    it('refuses a declined excuse', async () => {
      excuseRepo.findByEventAndUser.mockResolvedValue(
        excuse({ status: 'DECLINED', decided_at: 'x' }),
      );

      await expect(service.withdraw('evt-1', 'member', 'ch-1')).rejects.toThrow(
        'A declined excuse cannot be withdrawn',
      );
    });
  });

  describe('decide', () => {
    beforeEach(() => {
      excuseRepo.findByEventAndUser.mockResolvedValue(excuse());
      excuseRepo.decideAtomic.mockImplementation(
        (_id, _ch, decision: 'APPROVED' | 'DECLINED') =>
          Promise.resolve(excuse({ status: decision, decided_at: 'now' })),
      );
    });

    it('lets the creator approve, and tells the member', async () => {
      const result = await service.decide(
        'evt-1',
        'member',
        'ch-1',
        'creator',
        'APPROVED',
      );

      expect(result.status).toBe('APPROVED');
      expect(excuseRepo.decideAtomic).toHaveBeenCalledWith(
        'exc-1',
        'ch-1',
        'APPROVED',
        'creator',
        false,
      );
      expect(notifications.notifyUser).toHaveBeenCalledWith(
        'member',
        'ch-1',
        expect.objectContaining({
          title: 'Excused',
          body: "You're excused from Chapter meeting.",
        }),
      );
    });

    it('marks absent on a decline after check-in closed, not before', async () => {
      await service.decide('evt-1', 'member', 'ch-1', 'creator', 'DECLINED');
      expect(excuseRepo.decideAtomic).toHaveBeenLastCalledWith(
        'exc-1',
        'ch-1',
        'DECLINED',
        'creator',
        false,
      );

      eventRepo.findById.mockResolvedValue(eventAt(-3));
      excuseRepo.findByEventAndUser.mockResolvedValue(excuse());
      await service.decide('evt-1', 'member', 'ch-1', 'creator', 'DECLINED');
      expect(excuseRepo.decideAtomic).toHaveBeenLastCalledWith(
        'exc-1',
        'ch-1',
        'DECLINED',
        'creator',
        true,
      );
      expect(notifications.notifyUser).toHaveBeenLastCalledWith(
        'member',
        'ch-1',
        expect.objectContaining({
          body: "You're marked absent for Chapter meeting.",
        }),
      );
    });

    it('does not mark absent on a late decline once the event no longer requires them', async () => {
      eventRepo.findById.mockResolvedValue(eventAt(-3));
      attendance.requiresMember.mockResolvedValue(false);

      await service.decide('evt-1', 'member', 'ch-1', 'creator', 'DECLINED');

      expect(excuseRepo.decideAtomic).toHaveBeenLastCalledWith(
        'exc-1',
        'ch-1',
        'DECLINED',
        'creator',
        false,
      );
    });

    it('409s a member who checked in, and an approval over an officer ABSENT', async () => {
      attendanceRepo.findByEventAndUser.mockResolvedValueOnce({
        status: 'PRESENT',
      });
      await expect(
        service.decide('evt-1', 'member', 'ch-1', 'creator', 'APPROVED'),
      ).rejects.toThrow('This member checked in to the event');

      attendanceRepo.findByEventAndUser.mockResolvedValueOnce({
        status: 'ABSENT',
        marked_by: 'officer-1',
      });
      await expect(
        service.decide('evt-1', 'member', 'ch-1', 'creator', 'APPROVED'),
      ).rejects.toThrow(ConflictException);
      expect(excuseRepo.decideAtomic).not.toHaveBeenCalled();
    });

    it('409s an excuse from someone who left the chapter', async () => {
      memberRepo.findByUserAndChapter.mockImplementation((userId: string) =>
        Promise.resolve(
          userId === 'member' ? null : { user_id: userId, role_ids: [] },
        ),
      );

      await expect(
        service.decide('evt-1', 'member', 'ch-1', 'creator', 'APPROVED'),
      ).rejects.toThrow('This member is no longer in the chapter');
    });

    it('lets an events:update holder decide an event they did not make', async () => {
      rbac.memberHasAnyPermission.mockResolvedValue(true);

      await expect(
        service.decide('evt-1', 'member', 'ch-1', 'officer-1', 'APPROVED'),
      ).resolves.toBeDefined();
    });

    it('refuses anyone else', async () => {
      await expect(
        service.decide('evt-1', 'member', 'ch-1', 'someone', 'APPROVED'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a creator deciding their own excuse', async () => {
      await expect(
        service.decide('evt-1', 'creator', 'ch-1', 'creator', 'APPROVED'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('409s an excuse already decided, and one decided in the meantime', async () => {
      excuseRepo.findByEventAndUser.mockResolvedValueOnce(
        excuse({ status: 'APPROVED', decided_at: 'x' }),
      );
      await expect(
        service.decide('evt-1', 'member', 'ch-1', 'creator', 'DECLINED'),
      ).rejects.toThrow('This excuse has already been decided');

      excuseRepo.decideAtomic.mockResolvedValueOnce(null);
      await expect(
        service.decide('evt-1', 'member', 'ch-1', 'creator', 'DECLINED'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('list', () => {
    it('returns the excuses with their senders’ names to the creator', async () => {
      excuseRepo.findByEvent.mockResolvedValue([excuse()]);

      await expect(service.list('evt-1', 'ch-1', 'creator')).resolves.toEqual([
        { ...excuse(), display_name: 'Sam' },
      ]);
    });

    it('leaves out excuses from members who have left', async () => {
      excuseRepo.findByEvent.mockResolvedValue([
        excuse(),
        excuse({ id: 'exc-2', user_id: 'gone' }),
      ]);

      const rows = await service.list('evt-1', 'ch-1', 'creator');
      expect(rows.map((r) => r.id)).toEqual(['exc-1']);
    });

    it('refuses a member who is neither the creator nor an officer', async () => {
      await expect(service.list('evt-1', 'ch-1', 'member')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('remindPending', () => {
    it('pushes the creator once with the count', async () => {
      excuseRepo.findUserIdsByEventAndStatus.mockResolvedValue(['a', 'b']);

      await service.remindPending('evt-1', 'ch-1');

      expect(notifications.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['creator'],
        expect.objectContaining({
          body: '2 excuses for Chapter meeting still need a decision.',
        }),
      );
    });

    it('reminds the officers when the creator has left', async () => {
      excuseRepo.findUserIdsByEventAndStatus.mockResolvedValue(['member']);
      memberRepo.findByUserAndChapter.mockImplementation((userId: string) =>
        Promise.resolve(
          userId === 'creator' ? null : { user_id: userId, role_ids: [] },
        ),
      );

      await service.remindPending('evt-1', 'ch-1');

      expect(notifications.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['officer-1', 'officer-2'],
        expect.anything(),
      );
    });

    it("reminds the officers, not the creator, about the creator's own excuse", async () => {
      excuseRepo.findUserIdsByEventAndStatus.mockResolvedValue(['creator']);

      await service.remindPending('evt-1', 'ch-1');

      expect(notifications.notifyMembers).toHaveBeenCalledWith(
        'ch-1',
        ['officer-1', 'officer-2'],
        expect.anything(),
      );
    });

    it('sends nothing when no excuse is pending', async () => {
      await service.remindPending('evt-1', 'ch-1');
      expect(notifications.notifyMembers).not.toHaveBeenCalled();
    });

    it('never throws', async () => {
      excuseRepo.findUserIdsByEventAndStatus.mockRejectedValue(new Error('x'));
      await expect(
        service.remindPending('evt-1', 'ch-1'),
      ).resolves.toBeUndefined();
    });
  });
});
