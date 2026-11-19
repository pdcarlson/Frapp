import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Event } from '#domain/entities/event.entity';
import type { Meeting } from '#domain/entities/meeting.entity';
import type {
  IMeetingMinutesRequestRepository,
  MinutesRequestOutcome,
} from '#domain/repositories/meeting-minutes-request.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { EventService } from './event.service';
import type { MeetingService } from './meeting.service';
import type { NotificationService } from './notification.service';
import type { RbacService } from './rbac.service';
import {
  MINUTES_REQUEST_COOLDOWN_SECONDS,
  MeetingMinutesRequestService,
  minutesRequestedBody,
} from './meeting-minutes-request.service';

const CHAPTER = 'chapter-1';
const ASKER = 'asker';
const AUTHOR = 'author';
const CREATOR = 'creator';
const EDITOR = 'editor';
const OUTSIDER = 'outsider';

const meeting = (over: Partial<Meeting> = {}): Meeting =>
  ({
    id: 'meeting-1',
    chapter_id: CHAPTER,
    event_id: 'event-1',
    event_name: 'Chapter meeting',
    event_start_time: '2026-11-17T23:00:00.000Z',
    meeting_type: 'chapter',
    status: 'draft',
    created_by: AUTHOR,
    ...over,
  }) as Meeting;

const event = (over: Partial<Event> = {}): Event =>
  ({
    id: 'event-1',
    chapter_id: CHAPTER,
    name: 'Chapter meeting',
    start_time: '2026-11-17T23:00:00.000Z',
    end_time: '2026-11-18T00:00:00.000Z',
    created_by: CREATOR,
    ...over,
  }) as Event;

function setup(
  options: {
    meeting?: Meeting | null;
    event?: Event;
    /** Who the event shows itself to; everyone but OUTSIDER by default. */
    seenBy?: (userId: string) => boolean;
    members?: string[];
    editors?: string[];
    outcome?: MinutesRequestOutcome;
    requested?: boolean;
    notifyFails?: boolean;
  } = {},
) {
  const row = options.meeting === undefined ? meeting() : options.meeting;
  const ev = options.event ?? event();
  const seenBy = options.seenBy ?? ((id: string) => id !== OUTSIDER);
  const editors = options.editors ?? [EDITOR];
  const members = options.members ?? [ASKER, AUTHOR, CREATOR, EDITOR];

  const requests = {
    hasRequested: jest.fn().mockResolvedValue(options.requested ?? false),
    request: jest
      .fn()
      .mockResolvedValue(
        options.outcome ?? { requested: true, ping: true, asked: 1 },
      ),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const memberRepo = {
    findChapterMemberIdentities: jest.fn().mockResolvedValue(
      members.map((id) => ({
        user_id: id,
        display_name: id === ASKER ? 'Shawn Klein' : id,
        role_ids: [],
      })),
    ),
  };
  // `MeetingService`'s read rule, as `readable` states it: an editor, or the
  // author while the event shows itself to them, opens a draft.
  const canOpen = (m: Meeting, userId: string) =>
    editors.includes(userId) ||
    (m.status === 'posted' && seenBy(userId)) ||
    (m.created_by === userId && seenBy(userId));
  const meetings = {
    draftsVisibleTo: jest.fn((_c: string, userId: string) =>
      Promise.resolve(
        row && row.status === 'draft' && seenBy(userId) ? [row] : [],
      ),
    ),
    noteTakingView: jest.fn(() =>
      row
        ? Promise.resolve({ meeting: row })
        : Promise.reject(new NotFoundException('Minutes not found')),
    ),
    eventShowsTo: jest.fn((_c: string, _m: Meeting, userId: string) =>
      Promise.resolve(seenBy(userId)),
    ),
    canRead: jest.fn((_c: string, _id: string, userId: string) =>
      Promise.resolve(row ? canOpen(row, userId) : false),
    ),
  };
  const events = { findById: jest.fn().mockResolvedValue(ev) };
  const rbac = {
    findUserIdsWithPermissions: jest.fn().mockResolvedValue(editors),
  };
  const notifications = {
    notifyMembers: options.notifyFails
      ? jest.fn().mockRejectedValue(new Error('push down'))
      : jest.fn().mockResolvedValue(undefined),
  };
  const service = new MeetingMinutesRequestService(
    requests,
    memberRepo as unknown as IMemberRepository,
    meetings as unknown as MeetingService,
    events as unknown as EventService,
    rbac as unknown as RbacService,
    notifications as unknown as NotificationService,
  );
  return { service, requests, notifications };
}

describe('MeetingMinutesRequestService (#5471)', () => {
  describe('state', () => {
    it('offers the ask to a member who can’t open the draft, once the meeting has ended', async () => {
      const { service } = setup({ requested: true });
      await expect(service.state(CHAPTER, ASKER, 'event-1')).resolves.toEqual([
        { meeting_id: 'meeting-1', event_id: 'event-1', requested: true },
      ]);
    });

    it.each([
      ['the event has no minutes', { meeting: null }, ASKER],
      [
        'the minutes are posted',
        { meeting: meeting({ status: 'posted' }) },
        ASKER,
      ],
      ['the caller wrote them', {}, AUTHOR],
      ['the caller can edit any minutes', {}, EDITOR],
      ['the event leaves the caller out', {}, OUTSIDER],
      [
        'they are Standards minutes',
        {
          meeting: meeting({
            meeting_type: 'standards' as Meeting['meeting_type'],
          }),
        },
        ASKER,
      ],
      [
        'the meeting hasn’t ended',
        { event: event({ end_time: '2999-01-01T00:00:00.000Z' }) },
        ASKER,
      ],
    ])('offers nothing when %s', async (_why, options, caller) => {
      const { service } = setup(options);
      await expect(service.state(CHAPTER, caller, 'event-1')).resolves.toEqual(
        [],
      );
    });
  });

  describe('request', () => {
    it('records the ask under the daily guard and reminds the minutes’ author, naming who asked', async () => {
      const { service, requests, notifications } = setup();
      await expect(
        service.request(CHAPTER, 'meeting-1', ASKER),
      ).resolves.toEqual({
        meeting_id: 'meeting-1',
        event_id: 'event-1',
        requested: true,
        pinged: true,
      });
      expect(requests.request).toHaveBeenCalledWith(
        CHAPTER,
        'meeting-1',
        ASKER,
        MINUTES_REQUEST_COOLDOWN_SECONDS,
      );
      expect(MINUTES_REQUEST_COOLDOWN_SECONDS).toBe(86_400);
      expect(notifications.notifyMembers).toHaveBeenCalledTimes(1);
      expect(notifications.notifyMembers).toHaveBeenCalledWith(
        CHAPTER,
        [AUTHOR],
        expect.objectContaining({
          title: 'Minutes requested',
          body: "Shawn Klein asked for the minutes from Chapter meeting. Post them when they're ready.",
          category: 'events',
          priority: 'NORMAL',
          data: {
            target: {
              screen: 'events',
              eventId: 'event-1',
              meetingId: 'meeting-1',
            },
          },
        }),
      );
    });

    it('sends nothing when the guard holds the ask back, and says so', async () => {
      const { service, notifications } = setup({
        outcome: { requested: true, ping: false, asked: 0 },
      });
      await expect(
        service.request(CHAPTER, 'meeting-1', ASKER),
      ).resolves.toMatchObject({ requested: true, pinged: false });
      expect(notifications.notifyMembers).not.toHaveBeenCalled();
    });

    it('sends nothing when the member had already asked', async () => {
      const { service, notifications } = setup({
        outcome: { requested: false, ping: false, asked: 0 },
        requested: true,
      });
      await expect(
        service.request(CHAPTER, 'meeting-1', ASKER),
      ).resolves.toMatchObject({ requested: true, pinged: false });
      expect(notifications.notifyMembers).not.toHaveBeenCalled();
    });

    it('answers 409 when the minutes were posted between the check and the guard', async () => {
      const { service, notifications } = setup({
        outcome: { requested: false, ping: false, asked: 0 },
        requested: false,
      });
      await expect(
        service.request(CHAPTER, 'meeting-1', ASKER),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(notifications.notifyMembers).not.toHaveBeenCalled();
    });

    it('undoes the guard when the reminder can’t be sent, so the member can ask again', async () => {
      const { service, requests } = setup({ notifyFails: true });
      await expect(
        service.request(CHAPTER, 'meeting-1', ASKER),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(requests.release).toHaveBeenCalledWith(
        CHAPTER,
        'meeting-1',
        ASKER,
      );
    });

    it('counts the asks the guard held back into the next reminder', async () => {
      const { service, notifications } = setup({
        outcome: { requested: true, ping: true, asked: 3 },
      });
      await service.request(CHAPTER, 'meeting-1', ASKER);
      expect(notifications.notifyMembers.mock.calls[0][2].body).toBe(
        "Shawn Klein and 2 others asked for the minutes from Chapter meeting. Post them when they're ready.",
      );
    });

    it('reminds the event’s creator when the author has left the chapter, without opening a draft they can’t read', async () => {
      const { service, notifications } = setup({
        members: [ASKER, CREATOR, EDITOR],
      });
      await service.request(CHAPTER, 'meeting-1', ASKER);
      expect(notifications.notifyMembers).toHaveBeenCalledWith(
        CHAPTER,
        [CREATOR],
        expect.objectContaining({
          data: { target: { screen: 'events', eventId: 'event-1' } },
        }),
      );
    });

    it('reminds the editors when neither the author nor the creator can be reached, never the member asking', async () => {
      const { service, notifications } = setup({
        meeting: meeting({ created_by: null }),
        event: event({ created_by: ASKER }),
        editors: [EDITOR, 'editor-2'],
      });
      await service.request(CHAPTER, 'meeting-1', ASKER);
      expect(notifications.notifyMembers).toHaveBeenCalledWith(
        CHAPTER,
        [EDITOR, 'editor-2'],
        expect.objectContaining({
          data: {
            target: {
              screen: 'events',
              eventId: 'event-1',
              meetingId: 'meeting-1',
            },
          },
        }),
      );
    });

    it('skips an author the event no longer shows itself to', async () => {
      const { service, notifications } = setup({
        seenBy: (id) => id !== AUTHOR,
      });
      await service.request(CHAPTER, 'meeting-1', ASKER);
      expect(notifications.notifyMembers.mock.calls[0][1]).toEqual([CREATOR]);
    });

    it('answers a member the event leaves out with the 404 a missing id gets', async () => {
      const { service, requests } = setup();
      await expect(
        service.request(CHAPTER, 'meeting-1', OUTSIDER),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(requests.request).not.toHaveBeenCalled();
    });

    it('refuses posted minutes and a meeting still going on with a 409', async () => {
      const posted = setup({ meeting: meeting({ status: 'posted' }) });
      await expect(
        posted.service.request(CHAPTER, 'meeting-1', ASKER),
      ).rejects.toBeInstanceOf(ConflictException);
      const ongoing = setup({
        event: event({ end_time: '2999-01-01T00:00:00.000Z' }),
      });
      await expect(
        ongoing.service.request(CHAPTER, 'meeting-1', ASKER),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(ongoing.requests.request).not.toHaveBeenCalled();
    });
  });

  it('words one, two and several askers', () => {
    expect(minutesRequestedBody('Ann', 2, 'GM')).toBe(
      "Ann and 1 other asked for the minutes from GM. Post them when they're ready.",
    );
  });
});
