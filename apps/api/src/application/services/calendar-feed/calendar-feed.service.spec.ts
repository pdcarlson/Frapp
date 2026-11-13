import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CalendarFeedService } from './calendar-feed.service';
import type { ICalendarFeedRepository } from '#domain/repositories/calendar-feed.repository.interface';
import type { CalendarFeed } from '#domain/entities/calendar-feed.entity';
import type { Event } from '#domain/entities/event.entity';
import { TaskStatus, type TaskView } from '#domain/entities/task.entity';
import type { EventService } from '../event.service';
import type { TaskService } from '../task.service';
import type { RbacService } from '../rbac.service';

const CHAPTER = 'chapter-1';
const USER = 'user-1';
const TOKEN = 'a'.repeat(43);
const NOW = new Date('2026-11-12T19:00:00.000Z');

function feedRow(overrides: Partial<CalendarFeed> = {}): CalendarFeed {
  return {
    id: 'feed-1',
    user_id: USER,
    chapter_id: CHAPTER,
    token: TOKEN,
    created_at: '2026-11-12T00:00:00.000Z',
    revoked_at: null,
    ...overrides,
  };
}

function event(overrides: Partial<Event> = {}): Event {
  return {
    id: 'event-1',
    chapter_id: CHAPTER,
    name: 'Chapter meeting',
    description: 'Bring your dues form',
    location: 'House',
    start_time: '2026-11-14T00:00:00.000Z',
    end_time: '2026-11-14T01:00:00.000Z',
    point_value: 10,
    is_mandatory: true,
    recurrence_rule: null,
    parent_event_id: null,
    required_role_ids: null,
    optional_role_ids: null,
    excluded_role_ids: null,
    others_invited: null,
    notes: 'Officer-only notes',
    check_in_zone: null,
    check_in_zone_name: null,
    check_in_opens_minutes: 15,
    event_type_id: null,
    agenda: [],
    attachments: [],
    created_by: USER,
    created_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function task(overrides: Partial<TaskView> = {}): TaskView {
  return {
    id: 'task-1',
    chapter_id: CHAPTER,
    title: 'Clean the kitchen',
    description: null,
    assignee_id: USER,
    created_by: 'officer',
    due_date: '2026-11-30',
    due_at: null,
    status: TaskStatus.TODO,
    stored_status: TaskStatus.TODO,
    point_reward: 5,
    points_awarded: false,
    completed_at: null,
    confirmed_at: null,
    sent_back_at: null,
    proof_kind: 'none',
    proof_link: null,
    sent_back_reason: null,
    completion_note: null,
    created_at: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

interface SetupOptions {
  apiUrl?: string;
  feed?: CalendarFeed | null;
  member?: { role_ids: string[] } | null;
  canRead?: boolean;
  enabledModules?: Record<string, boolean> | null;
  events?: Event[];
  tasks?: TaskView[];
}

function setup({
  apiUrl = 'https://api.frapp.live',
  feed = feedRow(),
  member = { role_ids: ['brothers'] },
  canRead = true,
  enabledModules = null,
  events = [event()],
  tasks = [task()],
}: SetupOptions = {}) {
  const feeds: jest.Mocked<ICalendarFeedRepository> = {
    findByToken: jest.fn().mockResolvedValue(feed),
    findLive: jest.fn().mockResolvedValue(null),
    create: jest
      .fn()
      .mockImplementation(async (data) => feedRow({ ...data, id: 'new' })),
    revokeLive: jest.fn().mockResolvedValue(undefined),
  };
  const chapters = {
    findById: jest.fn().mockResolvedValue({
      id: CHAPTER,
      name: 'Phi Gamma Delta',
      enabled_modules: enabledModules,
    }),
  };
  const members = {
    findByUserAndChapter: jest.fn().mockResolvedValue(member),
  };
  const rbac = {
    memberHasAnyPermission: jest.fn().mockResolvedValue(canRead),
    getAlumniRoleId: jest.fn().mockResolvedValue('alumni'),
  };
  const eventService = {
    findByChapter: jest.fn().mockResolvedValue(events),
  };
  const taskService = { list: jest.fn().mockResolvedValue(tasks) };
  const config = {
    get: (key: string) =>
      ({ API_URL: apiUrl, APP_URL: 'https://app.frapp.live' })[key],
  } as unknown as ConfigService;

  const service = new CalendarFeedService(
    feeds,
    chapters as never,
    members as never,
    rbac as unknown as RbacService,
    eventService as unknown as EventService,
    taskService as unknown as TaskService,
    config,
  );
  return { service, feeds, eventService, taskService, rbac };
}

describe('CalendarFeedService.ensure / reset', () => {
  it('returns the live link without making another', async () => {
    const { service, feeds } = setup();
    feeds.findLive.mockResolvedValue(feedRow());
    const link = await service.ensure(CHAPTER, USER);
    expect(link).toEqual({
      url: `https://api.frapp.live/v1/calendar-feed/feed.ics?token=${TOKEN}`,
      webcal_url: `webcal://api.frapp.live/v1/calendar-feed/feed.ics?token=${TOKEN}`,
    });
    expect(feeds.create).not.toHaveBeenCalled();
  });

  it('makes a link with a 256-bit url-safe token on first ask', async () => {
    const { service, feeds } = setup();
    const link = await service.ensure(CHAPTER, USER);
    const token = feeds.create.mock.calls[0][0].token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(feeds.create).toHaveBeenCalledWith({
      chapter_id: CHAPTER,
      user_id: USER,
      token,
    });
    expect(link.url).toContain(`token=${token}`);
  });

  it('hands back the link a racing request made', async () => {
    const { service, feeds } = setup();
    feeds.create.mockRejectedValue(new Error('duplicate key'));
    feeds.findLive
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(feedRow({ token: 'b'.repeat(43) }));
    const link = await service.ensure(CHAPTER, USER);
    expect(link.url).toContain(`token=${'b'.repeat(43)}`);
  });

  it('drops a stray /v1 from API_URL', async () => {
    const { service } = setup({ apiUrl: 'https://api.frapp.live/v1/' });
    const link = await service.ensure(CHAPTER, USER);
    expect(
      link.url.startsWith('https://api.frapp.live/v1/calendar-feed/'),
    ).toBe(true);
  });

  it('refuses without API_URL rather than hand out a dead link', async () => {
    const { service, feeds } = setup({ apiUrl: '' });
    await expect(service.ensure(CHAPTER, USER)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(feeds.create).not.toHaveBeenCalled();
  });

  it('reset hands back the link a racing request made', async () => {
    const { service, feeds } = setup();
    feeds.create.mockRejectedValue(new Error('duplicate key'));
    feeds.findLive
      .mockResolvedValueOnce(feedRow())
      .mockResolvedValueOnce(feedRow({ token: 'b'.repeat(43) }));
    const link = await service.reset(CHAPTER, USER);
    expect(link.url).toContain(`token=${'b'.repeat(43)}`);
  });

  it('reset revokes the live link before making a new one', async () => {
    const { service, feeds } = setup();
    await service.reset(CHAPTER, USER);
    expect(feeds.revokeLive).toHaveBeenCalledWith(CHAPTER, USER);
    expect(feeds.revokeLive.mock.invocationCallOrder[0]).toBeLessThan(
      feeds.create.mock.invocationCallOrder[0],
    );
  });
});

describe('CalendarFeedService.fetch', () => {
  it('404s an unknown token', async () => {
    const { service } = setup({ feed: null });
    await expect(service.fetch(TOKEN, NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('serves the member-visible events and open tasks, linked back', async () => {
    const { service, eventService, taskService } = setup({
      tasks: [
        task(),
        task({ id: 'done', status: TaskStatus.COMPLETED, title: 'Done one' }),
        task({
          id: 'timed',
          title: 'Turn in the form',
          due_at: '2026-11-20T22:00:00.000Z',
        }),
      ],
    });
    const ics = await service.fetch(TOKEN, NOW);

    // The app's own read rules, as this member.
    expect(eventService.findByChapter).toHaveBeenCalledWith(CHAPTER, USER, {
      endsAfter: '2026-09-13T19:00:00.000Z',
      startsBefore: '2027-11-13T19:00:00.000Z',
    });
    expect(taskService.list).toHaveBeenCalledWith(CHAPTER, USER, false, {
      confirmed: false,
      limit: 500,
    });

    expect(ics).toContain('X-WR-CALNAME:Phi Gamma Delta (Frapp)');
    expect(ics).toContain('UID:event-event-1@frapp.live');
    expect(ics).toContain('URL:https://app.frapp.live/events?event=event-1');
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded).toContain(
      'DESCRIPTION:Open in Frapp: https://app.frapp.live/events?event=event-1\\n\\nRequired\\n\\nBring your dues form',
    );
    expect(ics).toContain('SUMMARY:Due: Clean the kitchen');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261130');
    expect(ics).toContain('DTSTART:20261120T220000Z');
    // A moment with no length has no DTEND, which must follow DTSTART.
    expect(ics).not.toContain('DTEND:20261120T220000Z');
    expect(ics).not.toContain('Done one');
  });

  it('keeps points and meeting notes in Frapp', async () => {
    const { service } = setup();
    const ics = await service.fetch(TOKEN, NOW);
    expect(ics).not.toContain('Officer-only notes');
    expect(ics).not.toMatch(/points?/i);
  });

  it('does not mark an optional event Required', async () => {
    const { service } = setup({ events: [event({ is_mandatory: false })] });
    const ics = await service.fetch(TOKEN, NOW);
    expect(ics).not.toContain('Required');
  });

  it.each([
    [
      'the link was reset',
      { feed: feedRow({ revoked_at: NOW.toISOString() }) },
    ],
    ['the member left the chapter', { member: null }],
    ['the member lost members:view', { canRead: false }],
  ])('serves an empty calendar when %s', async (_why, options) => {
    const { service, eventService, taskService } = setup(options);
    const ics = await service.fetch(TOKEN, NOW);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).not.toContain('BEGIN:VEVENT');
    expect(eventService.findByChapter).not.toHaveBeenCalled();
    expect(taskService.list).not.toHaveBeenCalled();
  });

  it('leaves out events when the chapter switched them off', async () => {
    const { service, eventService, taskService } = setup({
      enabledModules: { events: false },
    });
    const ics = await service.fetch(TOKEN, NOW);
    expect(eventService.findByChapter).not.toHaveBeenCalled();
    expect(taskService.list).toHaveBeenCalled();
    expect(ics).not.toContain('UID:event-');
  });

  it('renders a link once per window, however often it is fetched', async () => {
    const { service, feeds } = setup();
    await service.fetch(TOKEN, NOW);
    await service.fetch(TOKEN, new Date(NOW.getTime() + 60_000));
    expect(feeds.findByToken).toHaveBeenCalledTimes(1);
    await service.fetch(TOKEN, new Date(NOW.getTime() + 6 * 60_000));
    expect(feeds.findByToken).toHaveBeenCalledTimes(2);
  });

  it('stops serving the old render once the link is reset', async () => {
    const { service, feeds } = setup();
    await service.fetch(TOKEN, NOW);
    feeds.findLive.mockResolvedValue(feedRow());
    await service.reset(CHAPTER, USER);
    feeds.findByToken.mockResolvedValue(
      feedRow({ revoked_at: NOW.toISOString() }),
    );
    const ics = await service.fetch(TOKEN, NOW);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('leaves out a module the chapter switched off', async () => {
    const { service, eventService, taskService } = setup({
      enabledModules: { tasks: false },
    });
    const ics = await service.fetch(TOKEN, NOW);
    expect(eventService.findByChapter).toHaveBeenCalled();
    expect(taskService.list).not.toHaveBeenCalled();
    expect(ics).not.toContain('Due:');
  });
});
