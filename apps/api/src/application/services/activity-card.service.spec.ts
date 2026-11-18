import { ActivityCardService } from './activity-card.service';
import type { ActivityService } from './activity.service';
import type { ActivityStandingService } from './activity-standing.service';
import type { ChatService } from './chat.service';
import type { MeetingService } from './meeting.service';
import type { MemberNudgeService } from './member-nudge/member-nudge.service';

// Wednesday 18 November 2026, 2:00 PM in New York.
const NOW = new Date('2026-11-18T19:00:00.000Z');
const HOUR = 3_600_000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

function setup(
  options: { chatFails?: boolean; modules?: Record<string, boolean> } = {},
) {
  const activity = {
    getActivity: jest.fn().mockResolvedValue({
      coming_up: [
        {
          id: 'event-1',
          name: 'Chapter Meeting',
          location: null,
          start_time: at(5 * HOUR),
          end_time: at(7 * HOUR),
          attendance: 'optional',
          point_value: 0,
          checked_in: null,
          snoozed_until: null,
        },
      ],
      needs_you: {
        cards: [],
        task_confirmations: [],
        hours_approvals: [{ id: 'h1', created_at: at(-HOUR) }],
      },
    }),
  };
  const standing = {
    getStanding: jest.fn().mockResolvedValue({
      study: { minutes: 0, week_start: at(-4 * 24 * HOUR), goal_minutes: 600 },
    }),
  };
  const chat = {
    getChannels: options.chatFails
      ? jest.fn().mockRejectedValue(new Error('down'))
      : jest.fn().mockResolvedValue([
          {
            id: 'ann',
            name: 'announcements',
            type: 'PUBLIC',
            is_read_only: true,
          },
        ]),
    getUnreadCounts: jest
      .fn()
      .mockResolvedValue([
        { channel_id: 'ann', unread_count: 2, mention_count: 0 },
      ]),
    getLatestMessages: jest.fn().mockResolvedValue([]),
  };
  const meetings = {
    listPostedSince: jest.fn().mockResolvedValue([
      {
        id: 'm1',
        event_name: 'Chapter Meeting',
        posted_at: at(-HOUR),
        posted_by: 'sec',
      },
    ]),
  };
  const nudges = {
    card: jest.fn().mockResolvedValue({ card: null, tray: [] }),
  };
  const service = new ActivityCardService(
    activity as unknown as ActivityService,
    standing as unknown as ActivityStandingService,
    chat as unknown as ChatService,
    meetings as unknown as MeetingService,
    nudges as unknown as MemberNudgeService,
  );
  const run = () =>
    service.card({
      chapterId: 'chapter-1',
      userId: 'user-1',
      enabledModules: options.modules ?? null,
      timeZone: 'America/New_York',
      now: NOW,
    });
  return { run, nudges, meetings, standing };
}

describe('ActivityCardService', () => {
  it('hands every source to the pick, as items', async () => {
    const { run, nudges } = setup();
    await run();
    const [input] = nudges.card.mock.calls[0] as [
      { items: { kind: string }[]; tasksOn: boolean },
    ];
    expect(input.items.map((item) => item.kind).sort()).toEqual([
      'announcement_unread',
      'event_soon',
      'minutes_new',
      'officer_queue',
      'study_behind',
    ]);
    expect(input.tasksOn).toBe(true);
  });

  it('leaves a source out when its read fails, and still picks', async () => {
    const { run, nudges } = setup({ chatFails: true });
    await run();
    const [input] = nudges.card.mock.calls[0] as [
      { items: { kind: string }[] },
    ];
    expect(input.items.map((item) => item.kind)).not.toContain(
      'announcement_unread',
    );
    expect(input.items.length).toBeGreaterThan(0);
  });

  it('reads nothing a module the chapter has off would own', async () => {
    const { run, nudges, meetings, standing } = setup({
      modules: { meetings: false, study: false, tasks: false },
    });
    await run();
    expect(meetings.listPostedSince).not.toHaveBeenCalled();
    expect(standing.getStanding).not.toHaveBeenCalled();
    const [input] = nudges.card.mock.calls[0] as [{ tasksOn: boolean }];
    expect(input.tasksOn).toBe(false);
  });
});
