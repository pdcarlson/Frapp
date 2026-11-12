import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EMPTY_MEETING_CONTENT } from '@repo/validation';
import type { IMeetingRepository } from '#domain/repositories/meeting.repository.interface';
import type { IAttendanceRepository } from '#domain/repositories/attendance.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { Meeting } from '#domain/entities/meeting.entity';
import type { Event } from '#domain/entities/event.entity';
import type { Member } from '#domain/entities/member.entity';
import { MeetingService } from './meeting.service';
import type { EventService } from './event.service';
import type { RbacService } from './rbac.service';
import type { NotificationService } from './notification.service';
import { isInvited } from './event-role-targeting';

const CHAPTER = 'ch-1';
const EXEC_ROLE = 'role-exec';
const MEMBER_ROLE = 'role-member';

// The secretary holds the exec role and writes minutes; the president holds
// everything; Jake is an ordinary member.
const SECRETARY = 'user-secretary';
const PRESIDENT = 'user-president';
const JAKE = '00000000-0000-4000-8000-00000000000a';
const VP = 'user-vp';

const PERMISSIONS: Record<string, string[]> = {
  [SECRETARY]: ['members:view', 'meetings:record', 'events:create'],
  [VP]: ['members:view', 'meetings:record'],
  [PRESIDENT]: ['*'],
  [JAKE]: ['members:view'],
};

const member = (userId: string, roleIds: string[]): Member =>
  ({
    id: `m-${userId}`,
    user_id: userId,
    chapter_id: CHAPTER,
    role_ids: roleIds,
  }) as unknown as Member;

const MEMBERS: Member[] = [
  member(SECRETARY, [EXEC_ROLE]),
  member(VP, [EXEC_ROLE]),
  member(PRESIDENT, [EXEC_ROLE]),
  member(JAKE, [MEMBER_ROLE]),
];

const event = (overrides: Partial<Event> = {}): Event => ({
  id: 'evt-chapter',
  chapter_id: CHAPTER,
  name: 'Chapter meeting',
  description: null,
  location: null,
  start_time: '2026-11-10T00:00:00.000Z',
  end_time: '2026-11-10T01:00:00.000Z',
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
  created_by: SECRETARY,
  created_at: '2026-11-01T00:00:00.000Z',
  ...overrides,
});

const CHAPTER_EVENT = event();
// Invites only the exec roles, the way an Exec meeting is set up.
const EXEC_EVENT = event({
  id: 'evt-exec',
  name: 'Exec meeting',
  others_invited: false,
  required_role_ids: [EXEC_ROLE],
});

const meeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: 'mtg-1',
  chapter_id: CHAPTER,
  event_id: CHAPTER_EVENT.id,
  event_name: CHAPTER_EVENT.name,
  event_start_time: CHAPTER_EVENT.start_time,
  meeting_type: 'chapter',
  other_label: null,
  status: 'draft',
  content: { ...EMPTY_MEETING_CONTENT },
  created_by: SECRETARY,
  updated_by: SECRETARY,
  posted_by: null,
  posted_at: null,
  created_at: '2026-11-10T02:00:00.000Z',
  updated_at: '2026-11-10T02:00:00.000Z',
  ...overrides,
});

describe('MeetingService', () => {
  let events: Map<string, Event>;
  let rows: Map<string, Meeting>;
  let repo: jest.Mocked<IMeetingRepository>;
  let attendance: jest.Mocked<Pick<IAttendanceRepository, 'findByEvent'>>;
  let eventService: jest.Mocked<
    Pick<EventService, 'findById' | 'findVisibleByIds' | 'create'>
  >;
  let notifyMembers: jest.Mock;
  let service: MeetingService;

  const has = (userId: string, permission: string) => {
    const held = PERMISSIONS[userId] ?? [];
    return held.includes('*') || held.includes(permission);
  };
  // The event read rule as `EventService` applies it (`isEventVisibleTo`).
  const sees = (userId: string, row: Event) =>
    has(userId, 'events:update') ||
    isInvited(row, MEMBERS.find((m) => m.user_id === userId)?.role_ids ?? []);

  beforeEach(() => {
    events = new Map([
      [CHAPTER_EVENT.id, CHAPTER_EVENT],
      [EXEC_EVENT.id, EXEC_EVENT],
    ]);
    rows = new Map();
    repo = {
      findById: jest.fn(async (_chapterId, id) => rows.get(id) ?? null),
      findByEvent: jest.fn(
        async (_chapterId, eventId) =>
          [...rows.values()].find((row) => row.event_id === eventId) ?? null,
      ),
      findByChapter: jest.fn(async (_chapterId: string, _limit: number) => [
        ...rows.values(),
      ]),
      create: jest.fn(async (data) => {
        const row = meeting({ ...data, id: `mtg-${rows.size + 1}` });
        rows.set(row.id, row);
        return row;
      }),
      update: jest.fn(async (_chapterId, id, expected, data) => {
        const row = rows.get(id);
        if (!row || row.updated_at !== expected) return null;
        const next = {
          ...row,
          ...data,
          updated_at: new Date(Date.parse(row.updated_at) + 1000).toISOString(),
        };
        rows.set(id, next);
        return next;
      }),
      delete: jest.fn(async (_chapterId, id) => {
        rows.delete(id);
      }),
      findTemplate: jest.fn().mockResolvedValue(null),
      upsertTemplate: jest.fn(async (chapterId, sections, updatedBy) => ({
        chapter_id: chapterId,
        sections,
        updated_by: updatedBy,
        updated_at: '2026-11-10T00:00:00.000Z',
      })),
    };
    attendance = {
      findByEvent: jest.fn().mockResolvedValue([
        { user_id: JAKE, status: 'PRESENT' },
        { user_id: VP, status: 'LATE' },
        { user_id: PRESIDENT, status: 'EXCUSED' },
        { user_id: 'user-absent', status: 'ABSENT' },
      ]),
    };
    eventService = {
      findById: jest.fn(
        async (id: string, _chapterId: string, viewer?: string) => {
          const row = events.get(id);
          if (!row || (viewer && !sees(viewer, row))) {
            throw new NotFoundException('Event not found');
          }
          return row;
        },
      ),
      findVisibleByIds: jest.fn(
        async (ids: string[], _chapterId: string, viewer: string) =>
          ids
            .map((id) => events.get(id))
            .filter((row): row is Event => !!row && sees(viewer, row)),
      ),
      create: jest.fn(async (input) => {
        const row = event({
          ...input,
          id: 'evt-new',
          notes: null,
        });
        events.set(row.id, row);
        return row;
      }),
    };
    notifyMembers = jest.fn().mockResolvedValue(undefined);
    const rbac = {
      getEffectivePermissions: jest.fn(
        async (_chapterId: string, userId: string) => PERMISSIONS[userId] ?? [],
      ),
      memberHasAnyPermission: jest.fn(
        async (_chapterId: string, userId: string, wanted: string[]) =>
          wanted.some((permission) => has(userId, permission)),
      ),
      findByChapter: jest
        .fn()
        .mockResolvedValue([{ id: EXEC_ROLE }, { id: MEMBER_ROLE }]),
    };
    const memberRepo = {
      findByChapter: jest.fn().mockResolvedValue(MEMBERS),
    };
    service = new MeetingService(
      repo,
      attendance as unknown as IAttendanceRepository,
      memberRepo as unknown as IMemberRepository,
      eventService as unknown as EventService,
      rbac as unknown as RbacService,
      { notifyMembers } as unknown as NotificationService,
    );
  });

  describe('Standards meetings', () => {
    it('refuses to start one, before anything is stored', async () => {
      await expect(
        service.start(CHAPTER, SECRETARY, {
          meeting_type: 'standards',
          event_id: CHAPTER_EVENT.id,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
      expect(eventService.findById).not.toHaveBeenCalled();
    });

    it('refuses to retype minutes as Standards', async () => {
      rows.set('mtg-1', meeting());
      await expect(
        service.update(CHAPTER, 'mtg-1', SECRETARY, {
          expected_updated_at: meeting().updated_at,
          meeting_type: 'standards',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('start', () => {
    it('leaves attendees out when the chapter turned that section off', async () => {
      repo.findTemplate.mockResolvedValue({
        chapter_id: CHAPTER,
        sections: ['summary', 'decisions'],
        updated_by: PRESIDENT,
        updated_at: '2026-11-10T00:00:00.000Z',
      });
      const view = await service.start(CHAPTER, SECRETARY, {
        meeting_type: 'chapter',
        event_id: CHAPTER_EVENT.id,
      });
      expect(view.attendees).toBeNull();
      expect(attendance.findByEvent).not.toHaveBeenCalled();
    });

    it('starts a draft for the event, carrying the event notes into the summary', async () => {
      events.set(CHAPTER_EVENT.id, event({ notes: 'Budget passed 30-2.' }));
      const view = await service.start(CHAPTER, SECRETARY, {
        meeting_type: 'chapter',
        event_id: CHAPTER_EVENT.id,
      });
      expect(view.meeting.status).toBe('draft');
      expect(view.content.summary).toBe('Budget passed 30-2.');
      expect(view.attendees).toEqual({
        present: [JAKE],
        late: [VP],
        excused: [PRESIDENT],
      });
      expect(view.can_edit).toBe(true);
    });

    it('refuses a second start without naming minutes the viewer may not read', async () => {
      rows.set('mtg-1', meeting());
      await expect(
        service.start(CHAPTER, VP, {
          meeting_type: 'chapter',
          event_id: CHAPTER_EVENT.id,
        }),
      ).rejects.toMatchObject({
        response: { code: 'meeting.already_started' },
      });
      const refusal = await service
        .start(CHAPTER, VP, {
          meeting_type: 'chapter',
          event_id: CHAPTER_EVENT.id,
        })
        .catch((error: { getResponse(): object }) => error.getResponse());
      expect(refusal).not.toHaveProperty('meeting_id');
    });

    it('refuses an event the officer cannot see', async () => {
      PERMISSIONS['user-chair'] = ['members:view', 'meetings:record'];
      MEMBERS.push(member('user-chair', [MEMBER_ROLE]));
      try {
        await expect(
          service.start(CHAPTER, 'user-chair', {
            meeting_type: 'exec',
            event_id: EXEC_EVENT.id,
          }),
        ).rejects.toBeInstanceOf(NotFoundException);
      } finally {
        MEMBERS.pop();
        delete PERMISSIONS['user-chair'];
      }
    });

    it('makes a quiet event, nobody required, for a meeting that had none', async () => {
      await service.start(CHAPTER, SECRETARY, {
        meeting_type: 'exec',
        new_event: {
          name: 'Exec meeting',
          start_time: '2026-11-11T00:00:00.000Z',
          end_time: '2026-11-11T01:00:00.000Z',
          role_ids: [EXEC_ROLE],
        },
      });
      expect(eventService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          point_value: 0,
          is_mandatory: false,
          others_invited: false,
          optional_role_ids: [EXEC_ROLE],
          silent: true,
        }),
      );
    });

    it('needs events:create to make an event', async () => {
      await expect(
        service.start(CHAPTER, VP, {
          meeting_type: 'chapter',
          new_event: {
            name: 'Chapter meeting',
            start_time: '2026-11-11T00:00:00.000Z',
            end_time: '2026-11-11T01:00:00.000Z',
          },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(eventService.create).not.toHaveBeenCalled();
    });

    it('refuses a role from another chapter', async () => {
      await expect(
        service.start(CHAPTER, SECRETARY, {
          meeting_type: 'exec',
          new_event: {
            name: 'Exec meeting',
            start_time: '2026-11-11T00:00:00.000Z',
            end_time: '2026-11-11T01:00:00.000Z',
            role_ids: ['role-elsewhere'],
          },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('who can read minutes', () => {
    it('keeps a draft to its author and officers who can edit any minutes', async () => {
      rows.set('mtg-1', meeting());
      await expect(service.canRead(CHAPTER, 'mtg-1', SECRETARY)).resolves.toBe(
        true,
      );
      await expect(service.canRead(CHAPTER, 'mtg-1', PRESIDENT)).resolves.toBe(
        true,
      );
      await expect(service.canRead(CHAPTER, 'mtg-1', VP)).resolves.toBe(false);
      await expect(service.canRead(CHAPTER, 'mtg-1', JAKE)).resolves.toBe(
        false,
      );
      await expect(service.get(CHAPTER, 'mtg-1', JAKE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(await service.list(CHAPTER, JAKE)).toEqual([]);
    });

    it('lets everyone the event invites read posted minutes', async () => {
      rows.set(
        'mtg-1',
        meeting({ status: 'posted', posted_at: '2026-11-10T03:00:00.000Z' }),
      );
      await expect(service.canRead(CHAPTER, 'mtg-1', JAKE)).resolves.toBe(true);
      const view = await service.get(CHAPTER, 'mtg-1', JAKE);
      expect(view.can_edit).toBe(false);
      expect(view.can_delete).toBe(false);
      expect((await service.list(CHAPTER, JAKE)).map((row) => row.id)).toEqual([
        'mtg-1',
      ]);
    });

    it('never opens an Exec meeting’s minutes to a member the event leaves out', async () => {
      rows.set(
        'mtg-exec',
        meeting({
          id: 'mtg-exec',
          event_id: EXEC_EVENT.id,
          event_name: EXEC_EVENT.name,
          meeting_type: 'exec',
          status: 'posted',
          posted_at: '2026-11-10T03:00:00.000Z',
        }),
      );
      await expect(
        service.get(CHAPTER, 'mtg-exec', JAKE),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.canRead(CHAPTER, 'mtg-exec', JAKE)).resolves.toBe(
        false,
      );
      expect(await service.list(CHAPTER, JAKE)).toEqual([]);
      // Nor can he learn it exists by trying to change or delete it.
      await expect(
        service.update(CHAPTER, 'mtg-exec', JAKE, {
          expected_updated_at: meeting().updated_at,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.delete(CHAPTER, 'mtg-exec', JAKE),
      ).rejects.toBeInstanceOf(NotFoundException);
      // The exec board reads them.
      await expect(service.canRead(CHAPTER, 'mtg-exec', VP)).resolves.toBe(
        true,
      );
    });

    it('follows the event when its audience changes', async () => {
      rows.set(
        'mtg-1',
        meeting({ status: 'posted', posted_at: '2026-11-10T03:00:00.000Z' }),
      );
      events.set(
        CHAPTER_EVENT.id,
        event({ others_invited: false, required_role_ids: [EXEC_ROLE] }),
      );
      await expect(service.canRead(CHAPTER, 'mtg-1', JAKE)).resolves.toBe(
        false,
      );
    });

    it('shows minutes whose event was deleted only to officers who can edit minutes', async () => {
      rows.set(
        'mtg-1',
        meeting({
          event_id: null,
          status: 'posted',
          posted_at: '2026-11-10T03:00:00.000Z',
        }),
      );
      await expect(service.canRead(CHAPTER, 'mtg-1', JAKE)).resolves.toBe(
        false,
      );
      const view = await service.get(CHAPTER, 'mtg-1', PRESIDENT);
      expect(view.attendees).toBeNull();
      expect(view.event_end_time).toBeNull();
    });

    it('is false for an id that is not there', async () => {
      await expect(service.canRead(CHAPTER, 'nope', PRESIDENT)).resolves.toBe(
        false,
      );
    });
  });

  describe('update', () => {
    beforeEach(() => rows.set('mtg-1', meeting()));

    it('merges the sections sent onto the ones stored', async () => {
      const first = await service.update(CHAPTER, 'mtg-1', SECRETARY, {
        expected_updated_at: meeting().updated_at,
        content: { summary: 'Recruitment plan approved.' },
      });
      const second = await service.update(CHAPTER, 'mtg-1', SECRETARY, {
        expected_updated_at: first.meeting.updated_at,
        content: {
          action_items: [
            { text: 'Book the bus', owner_user_id: JAKE, due_date: null },
            { text: 'Find a caterer', owner_user_id: null, due_date: null },
          ],
        },
      });
      expect(second.content.summary).toBe('Recruitment plan approved.');
      expect(second.content.action_items).toHaveLength(2);
    });

    it('refuses a save over newer minutes', async () => {
      await expect(
        service.update(CHAPTER, 'mtg-1', SECRETARY, {
          expected_updated_at: '2026-01-01T00:00:00.000Z',
          content: { summary: 'Mine' },
        }),
      ).rejects.toMatchObject({ response: { code: 'meeting.stale' } });
    });

    it('refuses an owner who is not in the chapter', async () => {
      await expect(
        service.update(CHAPTER, 'mtg-1', SECRETARY, {
          expected_updated_at: meeting().updated_at,
          content: {
            action_items: [
              {
                text: 'Book the bus',
                owner_user_id: 'user-stranger',
                due_date: null,
              },
            ],
          },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('lets another recorder see nothing and change nothing in a draft that is not theirs', async () => {
      await expect(
        service.update(CHAPTER, 'mtg-1', VP, {
          expected_updated_at: meeting().updated_at,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('tells a reader of posted minutes they cannot change them', async () => {
      rows.set(
        'mtg-1',
        meeting({ status: 'posted', posted_at: '2026-11-10T03:00:00.000Z' }),
      );
      await expect(
        service.update(CHAPTER, 'mtg-1', JAKE, {
          expected_updated_at: meeting().updated_at,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets the president edit anyone’s minutes', async () => {
      const view = await service.update(CHAPTER, 'mtg-1', PRESIDENT, {
        expected_updated_at: meeting().updated_at,
        meeting_type: 'other',
        other_label: ' Alumni board ',
      });
      expect(view.meeting.other_label).toBe('Alumni board');
      expect(view.meeting.updated_by).toBe(PRESIDENT);
    });
  });

  describe('post', () => {
    it('posts once and tells the event’s audience, never the poster', async () => {
      rows.set('mtg-1', meeting());
      const view = await service.post(
        CHAPTER,
        'mtg-1',
        SECRETARY,
        meeting().updated_at,
      );
      expect(view.meeting.status).toBe('posted');
      expect(view.meeting.posted_by).toBe(SECRETARY);
      expect(notifyMembers).toHaveBeenCalledTimes(1);
      const [, audience, payload] = notifyMembers.mock.calls[0];
      expect([...audience].sort()).toEqual([JAKE, PRESIDENT, VP].sort());
      expect(payload.data).toEqual({
        target: {
          screen: 'events',
          eventId: CHAPTER_EVENT.id,
          meetingId: 'mtg-1',
        },
      });

      // Posting again tells nobody again.
      await service.post(CHAPTER, 'mtg-1', SECRETARY, view.meeting.updated_at);
      expect(notifyMembers).toHaveBeenCalledTimes(1);
    });

    it('tells only the members an Exec meeting invites', async () => {
      rows.set(
        'mtg-exec',
        meeting({
          id: 'mtg-exec',
          event_id: EXEC_EVENT.id,
          meeting_type: 'exec',
        }),
      );
      await service.post(CHAPTER, 'mtg-exec', SECRETARY, meeting().updated_at);
      const [, audience] = notifyMembers.mock.calls[0];
      expect(audience).not.toContain(JAKE);
    });
  });

  describe('delete', () => {
    it('lets the author throw away their own draft', async () => {
      rows.set('mtg-1', meeting());
      await service.delete(CHAPTER, 'mtg-1', SECRETARY);
      expect(rows.has('mtg-1')).toBe(false);
    });

    it("keeps another officer's draft out of reach of one who only records", async () => {
      rows.set('mtg-1', meeting());
      await expect(service.delete(CHAPTER, 'mtg-1', VP)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        service.delete(CHAPTER, 'mtg-1', JAKE),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(rows.has('mtg-1')).toBe(true);
    });

    it('refuses the author once the event no longer shows itself to them', async () => {
      rows.set(
        'mtg-exec',
        meeting({ id: 'mtg-exec', event_id: EXEC_EVENT.id, created_by: JAKE }),
      );
      await expect(
        service.delete(CHAPTER, 'mtg-exec', JAKE),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        service.post(CHAPTER, 'mtg-exec', JAKE, meeting().updated_at),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(rows.has('mtg-exec')).toBe(true);
    });

    it('keeps posted minutes from their author', async () => {
      rows.set(
        'mtg-1',
        meeting({ status: 'posted', posted_at: '2026-11-10T03:00:00.000Z' }),
      );
      await expect(
        service.delete(CHAPTER, 'mtg-1', SECRETARY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await service.delete(CHAPTER, 'mtg-1', PRESIDENT);
      expect(rows.has('mtg-1')).toBe(false);
    });
  });

  describe('template', () => {
    it('reads the default sections when the chapter saved none', async () => {
      await expect(service.getTemplate(CHAPTER)).resolves.toEqual([
        'attendees',
        'summary',
        'announcements',
        'decisions',
        'action_items',
      ]);
    });

    it('stores known sections in template order', async () => {
      await service.setTemplate(CHAPTER, PRESIDENT, [
        'discussion_log',
        'summary',
        'summary',
      ]);
      expect(repo.upsertTemplate).toHaveBeenCalledWith(
        CHAPTER,
        ['summary', 'discussion_log'],
        PRESIDENT,
      );
    });
  });

  it('never conflicts silently when two officers start the same minutes', async () => {
    repo.create.mockImplementationOnce(async () => {
      rows.set('mtg-race', meeting({ id: 'mtg-race' }));
      return null;
    });
    await expect(
      service.start(CHAPTER, SECRETARY, {
        meeting_type: 'chapter',
        event_id: CHAPTER_EVENT.id,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
