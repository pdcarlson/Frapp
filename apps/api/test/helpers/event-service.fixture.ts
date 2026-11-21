import { CHAPTER_DOCUMENT_REPOSITORY } from '#domain/repositories/chapter-document.repository.interface';
import { Test, TestingModule } from '@nestjs/testing';
import { EVENT_REPOSITORY } from '#domain/repositories/event.repository.interface';
import type { IEventRepository } from '#domain/repositories/event.repository.interface';
import type { Event } from '#domain/entities/event.entity';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { EventService } from '../../src/application/services/event.service';
import { EventSeriesService } from '../../src/application/services/event-series.service';
import { EventAnnouncementService } from '../../src/application/services/event-announcement.service';
import { NotificationService } from '../../src/application/services/notification.service';
import { ChatService } from '../../src/application/services/chat.service';
import { RbacService } from '../../src/application/services/rbac.service';
import { EventTypeService } from '../../src/application/services/event-type.service';
import {
  EVENT_CHECK_IN_SCREEN_REPOSITORY,
  type IEventCheckInScreenRepository,
} from '#domain/repositories/event-check-in-screen.repository.interface';
import { EVENT_TYPE_REPOSITORY } from '#domain/repositories/event-type.repository.interface';
import type { IEventTypeRepository } from '#domain/repositories/event-type.repository.interface';

/**
 * The shared fixture for the event service specs (#3270): one Nest testing
 * module wiring the real `EventService`, `EventSeriesService` and
 * `EventAnnouncementService` over the same mocked repositories, as
 * `EventModule` wires them. The series and announcement specs drive their
 * cases through `EventService`'s public writes, the entry points the
 * controller calls, so a case keeps asserting the whole flow it did before the
 * split.
 */
export const baseEvent: Event = {
  id: 'evt-1',
  chapter_id: 'ch-1',
  name: 'Chapter Meeting',
  description: null,
  location: null,
  start_time: '2026-02-26T18:00:00.000Z',
  end_time: '2026-02-26T19:00:00.000Z',
  point_value: 10,
  is_mandatory: false,
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
  created_by: null,
  created_at: '2026-02-26T00:00:00.000Z',
};

export async function createEventServiceFixture() {
  const mockEventRepo: jest.Mocked<IEventRepository> = {
    findById: jest.fn(),
    findByChapter: jest.fn(),
    findByIds: jest.fn(),
    findCreatedBy: jest.fn(),
    findChildren: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    // Echoes the rows back with ids, as the real insert's `select()` does.
    createMany: jest.fn(async (rows: Partial<Event>[]) =>
      rows.map((row, i) => ({ ...baseEvent, ...row, id: `occ-${i + 1}` })),
    ),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue([]),
    delete: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue(undefined),
    // No excuse left behind by default (#4620).
    deleteReplacedOccurrences: jest.fn().mockResolvedValue([]),
  };

  const mockNotificationService: jest.Mocked<
    Pick<
      NotificationService,
      'notifyUser' | 'notifyChapter' | 'notifyMembers' | 'timeZoneFor'
    >
  > = {
    notifyUser: jest.fn().mockResolvedValue(undefined),
    notifyChapter: jest.fn().mockResolvedValue(undefined),
    notifyMembers: jest.fn().mockResolvedValue(undefined),
    timeZoneFor: jest.fn().mockResolvedValue(null),
  };

  const mockUserRepo: { findByIds: jest.Mock } = {
    findByIds: jest.fn().mockResolvedValue([]),
  };
  const mockMemberRepo: {
    findByUserAndChapter: jest.Mock;
    findByChapter: jest.Mock;
  } = {
    findByUserAndChapter: jest.fn().mockResolvedValue(null),
    findByChapter: jest.fn().mockResolvedValue([]),
  };
  const mockChatService: { sendMessage: jest.Mock } = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
  };
  const mockRbacService: {
    memberHasAnyPermission: jest.Mock;
    getAlumniRoleId: jest.Mock;
  } = {
    memberHasAnyPermission: jest.fn().mockResolvedValue(false),
    getAlumniRoleId: jest.fn().mockResolvedValue(null),
  };

  // Every type id a test sends is one of the chapter's unless it says not.
  const mockEventTypeRepo: jest.Mocked<IEventTypeRepository> = {
    findByChapter: jest.fn().mockResolvedValue([]),
    findById: jest.fn(async (id: string, chapterId: string) => ({
      id,
      chapter_id: chapterId,
      name: 'Chapter meeting',
      point_value: 10,
      is_mandatory: true,
      position: 1,
      created_at: '2026-11-11T00:00:00.000Z',
      updated_at: '2026-11-11T00:00:00.000Z',
    })),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  // No officer's screen is live unless a test says so (#4808).
  const mockScreenRepo: jest.Mocked<IEventCheckInScreenRepository> = {
    findLive: jest.fn().mockResolvedValue([]),
    recordShown: jest.fn(),
    deleteExpired: jest.fn(),
  };

  // Every document id a test attaches is the chapter's unless it says not
  // (#4934).
  const mockDocumentRepo: { findByIds: jest.Mock } = {
    findByIds: jest.fn(async (ids: string[], chapterId: string) =>
      ids.map((id) => ({ id, chapter_id: chapterId })),
    ),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EventService,
      EventSeriesService,
      EventAnnouncementService,
      EventTypeService,
      { provide: EVENT_TYPE_REPOSITORY, useValue: mockEventTypeRepo },
      { provide: EVENT_REPOSITORY, useValue: mockEventRepo },
      { provide: NotificationService, useValue: mockNotificationService },
      { provide: USER_REPOSITORY, useValue: mockUserRepo },
      { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
      { provide: ChatService, useValue: mockChatService },
      { provide: RbacService, useValue: mockRbacService },
      { provide: EVENT_CHECK_IN_SCREEN_REPOSITORY, useValue: mockScreenRepo },
      { provide: CHAPTER_DOCUMENT_REPOSITORY, useValue: mockDocumentRepo },
    ],
  }).compile();

  return {
    service: module.get(EventService),
    mockEventRepo,
    mockNotificationService,
    mockUserRepo,
    mockMemberRepo,
    mockChatService,
    mockRbacService,
    mockEventTypeRepo,
    mockScreenRepo,
    mockDocumentRepo,
  };
}

export type EventServiceFixture = Awaited<
  ReturnType<typeof createEventServiceFixture>
>;

/**
 * Every occurrence row the series code asked to insert, in order, across all
 * `createMany` calls. Occurrences go out as one array insert (#3235), so a
 * spec that used to count `create` calls counts these rows instead.
 */
export function occurrenceRows(
  repo: jest.Mocked<IEventRepository>,
): Partial<Event>[] {
  return repo.createMany.mock.calls.flatMap(([rows]) => rows);
}
