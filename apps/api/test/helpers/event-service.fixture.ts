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
  notes: null,
  check_in_zone: null,
  check_in_zone_name: null,
  created_at: '2026-02-26T00:00:00.000Z',
};

export async function createEventServiceFixture() {
  const mockEventRepo: jest.Mocked<IEventRepository> = {
    findById: jest.fn(),
    findByChapter: jest.fn(),
    findChildren: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue([]),
    delete: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue(undefined),
  };

  const mockNotificationService: jest.Mocked<
    Pick<NotificationService, 'notifyUser' | 'notifyChapter'>
  > = {
    notifyUser: jest.fn().mockResolvedValue(undefined),
    notifyChapter: jest.fn().mockResolvedValue(undefined),
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
  const mockRbacService: { memberHasAnyPermission: jest.Mock } = {
    memberHasAnyPermission: jest.fn().mockResolvedValue(false),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EventService,
      EventSeriesService,
      EventAnnouncementService,
      { provide: EVENT_REPOSITORY, useValue: mockEventRepo },
      { provide: NotificationService, useValue: mockNotificationService },
      { provide: USER_REPOSITORY, useValue: mockUserRepo },
      { provide: MEMBER_REPOSITORY, useValue: mockMemberRepo },
      { provide: ChatService, useValue: mockChatService },
      { provide: RbacService, useValue: mockRbacService },
    ],
  }).compile();

  return {
    service: module.get(EventService),
    series: module.get(EventSeriesService),
    announcements: module.get(EventAnnouncementService),
    mockEventRepo,
    mockNotificationService,
    mockUserRepo,
    mockMemberRepo,
    mockChatService,
    mockRbacService,
  };
}

export type EventServiceFixture = Awaited<
  ReturnType<typeof createEventServiceFixture>
>;
