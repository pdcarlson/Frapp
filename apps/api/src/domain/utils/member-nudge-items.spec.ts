import {
  chatItems,
  checkNudgeLine,
  eventItems,
  hoursAndMinutes,
  minutesItems,
  officerQueueItem,
  orderNudgeItems,
  relativeDayTime,
  signupItems,
  studyItem,
  taskItem,
  type NudgeEventSource,
} from './member-nudge-items';

// Wednesday 18 November 2026, 2:00 PM in New York.
const NOW = new Date('2026-11-18T19:00:00.000Z');
const TZ = 'America/New_York';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

function event(overrides: Partial<NudgeEventSource> = {}): NudgeEventSource {
  return {
    id: 'event-1',
    name: 'Chapter Meeting',
    location: 'Chapter House',
    start_time: at(5 * HOUR), // 7:00 PM tonight
    end_time: at(7 * HOUR),
    attendance: 'required',
    point_value: 0,
    checked_in: null,
    snoozed_until: null,
    ...overrides,
  };
}

describe('relativeDayTime', () => {
  it('says tonight from 5 PM, today before, and tomorrow', () => {
    expect(relativeDayTime(NOW.getTime() + 5 * HOUR, NOW, TZ)).toBe(
      'Tonight 7:00 PM',
    );
    expect(relativeDayTime(NOW.getTime() + HOUR, NOW, TZ)).toBe(
      'Today 3:00 PM',
    );
    expect(relativeDayTime(NOW.getTime() + DAY, NOW, TZ)).toBe(
      'Tomorrow 2:00 PM',
    );
    expect(relativeDayTime(NOW.getTime() + 2 * DAY, NOW, TZ)).toBe(
      'Friday 2:00 PM',
    );
  });

  it('writes hours and minutes', () => {
    expect(hoursAndMinutes(150)).toBe('2h 30m');
    expect(hoursAndMinutes(45)).toBe('45m');
    expect(hoursAndMinutes(360)).toBe('6h');
  });
});

describe('eventItems', () => {
  it('raises an event tonight the member has not checked in to', () => {
    const [item] = eventItems([event()], NOW, TZ);
    expect(item).toMatchObject({
      kind: 'event_soon',
      subjectKey: 'event-1',
      headline: 'Chapter Meeting',
      meta: 'Tonight 7:00 PM · Chapter House · Required',
      urgent: true,
      chip: 'Tonight',
      target: { type: 'event', id: 'event-1' },
    });
    expect(item?.expiresAt).toBe(at(7 * HOUR));
  });

  it('ranks tomorrow below today, and leaves out later days', () => {
    const items = eventItems(
      [
        event({
          id: 'tomorrow',
          start_time: at(DAY),
          end_time: at(DAY + HOUR),
        }),
        event({
          id: 'friday',
          start_time: at(2 * DAY),
          end_time: at(2 * DAY + HOUR),
        }),
      ],
      NOW,
      TZ,
    );
    expect(items.map((item) => item.subjectKey)).toEqual(['tomorrow']);
    expect(items[0]?.chip).toBe('Tomorrow');
  });

  it('leaves out an event checked in to, snoozed, or over', () => {
    expect(
      eventItems(
        [
          event({ checked_in: true }),
          event({ snoozed_until: at(DAY) }),
          event({ start_time: at(-3 * HOUR), end_time: at(-HOUR) }),
        ],
        NOW,
        TZ,
      ),
    ).toEqual([]);
  });

  it('keeps one happening now until it ends', () => {
    const [item] = eventItems(
      [event({ start_time: at(-HOUR), end_time: at(HOUR) })],
      NOW,
      TZ,
    );
    expect(item?.meta.startsWith('Happening now')).toBe(true);
    expect(item?.chip).toBe('Now');
  });
});

describe('signupItems', () => {
  const card = {
    kind: 'signup' as const,
    message_id: 'msg-1',
    channel_id: 'ch-1',
    channel_name: 'philanthropy',
    channel_type: 'PUBLIC',
    title: 'Food drive shifts',
    item_count: 6,
    closes_at: null,
    snoozed_until: null,
  };

  it('names the channel and when it closes', () => {
    const [item] = signupItems(
      [{ ...card, closes_at: at(20 * HOUR) }],
      NOW,
      TZ,
    );
    expect(item).toMatchObject({
      kind: 'signup_open',
      headline: 'Food drive shifts',
      meta: '#philanthropy · Closes Tomorrow 10:00 AM',
      urgent: true,
      chip: 'Closing',
      action: 'Sign up',
      target: { type: 'message', id: 'msg-1', channelId: 'ch-1' },
    });
  });

  it('never names a direct message, and drops closed or snoozed sheets', () => {
    expect(
      signupItems(
        [{ ...card, channel_type: 'DM', channel_name: 'dm-a-b' }],
        NOW,
        TZ,
      )[0]?.meta,
    ).toBe('In a direct message');
    expect(
      signupItems(
        [
          { ...card, closes_at: at(-HOUR) },
          { ...card, snoozed_until: at(HOUR) },
        ],
        NOW,
        TZ,
      ),
    ).toEqual([]);
  });
});

describe('chatItems', () => {
  const channels = [
    { id: 'gen', name: 'general', type: 'PUBLIC', is_announcements: false },
    {
      id: 'ann',
      name: 'announcements',
      type: 'PUBLIC',
      is_announcements: true,
    },
    { id: 'dm', name: 'dm-a-b', type: 'DM', is_announcements: false },
    { id: 'exec', name: 'exec', type: 'PRIVATE', is_announcements: false },
  ];
  const latest = [
    {
      channel_id: 'ann',
      message_id: 'm-ann',
      author_name: 'Priya',
      content: 'Composite photos are Thursday.',
    },
    {
      channel_id: 'exec',
      message_id: 'm-exec',
      author_name: 'Jordan',
      content: 'Budget?',
    },
  ];

  it('raises mentions, most first, and the announcements channel', () => {
    const items = chatItems({
      channels,
      latest,
      now: NOW,
      unread: [
        { channel_id: 'gen', unread_count: 4, mention_count: 1 },
        { channel_id: 'exec', unread_count: 3, mention_count: 2 },
        { channel_id: 'ann', unread_count: 1, mention_count: 0 },
      ],
    });
    expect(items.map((item) => [item.kind, item.headline, item.chip])).toEqual([
      ['mention_unread', '#exec', '2'],
      ['mention_unread', '#general', '1'],
      ['announcement_unread', '#announcements', '1'],
    ]);
    expect(items[0]?.subjectKey).toBe('exec:m-exec');
    expect(items[2]?.meta).toBe('Priya: Composite photos are Thursday.');
  });

  it('leaves out direct messages and busy channels with no mention', () => {
    expect(
      chatItems({
        channels,
        latest,
        now: NOW,
        unread: [
          { channel_id: 'dm', unread_count: 5, mention_count: 5 },
          { channel_id: 'gen', unread_count: 40, mention_count: 0 },
        ],
      }),
    ).toEqual([]);
  });
});

describe('officerQueueItem', () => {
  it('counts what waits and names the oldest', () => {
    const item = officerQueueItem(
      {
        tasks: [
          { id: 't1', completed_at: at(-2 * DAY), created_at: at(-9 * DAY) },
        ],
        hours: [
          { id: 'h1', created_at: at(-5 * DAY) },
          { id: 'h2', created_at: at(-HOUR) },
        ],
      },
      NOW,
    );
    expect(item).toMatchObject({
      kind: 'officer_queue',
      subjectKey: 'queue:h1',
      headline: '3 waiting on you',
      meta: 'Oldest: service hours, 5 days',
      urgent: true,
      chip: '3',
    });
  });

  it('is nothing when nothing waits', () => {
    expect(officerQueueItem({ tasks: [], hours: [] }, NOW)).toBeNull();
  });
});

describe('minutesItems', () => {
  it('raises minutes someone else posted in the last three days', () => {
    const items = minutesItems(
      [
        {
          id: 'm1',
          event_name: 'Chapter Meeting',
          posted_at: at(-DAY),
          posted_by: 'sec',
        },
        { id: 'm2', event_name: 'Exec', posted_at: at(-DAY), posted_by: 'me' },
        {
          id: 'm3',
          event_name: 'Old',
          posted_at: at(-4 * DAY),
          posted_by: 'sec',
        },
      ],
      'me',
      NOW,
      TZ,
    );
    expect(items.map((item) => [item.headline, item.meta])).toEqual([
      ['Minutes: Chapter Meeting', 'Posted yesterday'],
    ]);
  });
});

describe('studyItem', () => {
  const weekStart = at(-3 * DAY); // three days in

  it('raises a goal more than an hour behind the pace', () => {
    // Pace after 3 of 7 days of a 7h goal: 3h. Logged 1h 30m.
    const item = studyItem(
      { minutes: 90, week_start: weekStart, goal_minutes: 420 },
      NOW,
    );
    expect(item).toMatchObject({
      kind: 'study_behind',
      headline: 'Study hours',
      meta: '1h 30m of 7h this week',
      chip: '5h 30m',
    });
  });

  it('says nothing early in the week, near the pace, or with no goal', () => {
    expect(
      studyItem({ minutes: 0, week_start: at(-DAY), goal_minutes: 420 }, NOW),
    ).toBeNull();
    expect(
      studyItem(
        { minutes: 140, week_start: weekStart, goal_minutes: 420 },
        NOW,
      ),
    ).toBeNull();
    expect(
      studyItem({ minutes: 0, week_start: weekStart, goal_minutes: null }, NOW),
    ).toBeNull();
  });
});

describe('orderNudgeItems', () => {
  const tonight = eventItems([event()], NOW, TZ);
  const mention = chatItems({
    channels: [
      { id: 'gen', name: 'general', type: 'PUBLIC', is_announcements: false },
    ],
    unread: [{ channel_id: 'gen', unread_count: 1, mention_count: 1 }],
    latest: [],
    now: NOW,
  });
  const task = taskItem(
    'task_overdue',
    {
      id: 'task-1',
      title: 'Dues report',
      due_date: '2026-11-12',
      due_at: null,
    },
    NOW,
    TZ,
    at(DAY),
  );

  it('puts tonight first, then a mention, then an overdue task', () => {
    const ordered = orderNudgeItems([task, ...mention, ...tonight], []);
    expect(ordered.map((item) => item.kind)).toEqual([
      'event_soon',
      'mention_unread',
      'task_overdue',
    ]);
  });

  it('never raises a subject the member waved off', () => {
    const ordered = orderNudgeItems(
      [...tonight, task],
      [{ kind: 'event_soon', subject_key: 'event-1' }],
    );
    expect(ordered.map((item) => item.kind)).toEqual(['task_overdue']);
  });

  it('writes a task card the same way as every other', () => {
    expect(task).toMatchObject({
      headline: 'Dues report',
      meta: 'Was due Thursday',
      chip: 'Overdue',
      action: 'See the task',
      target: { type: 'task', id: 'task-1' },
    });
  });
});

describe('checkNudgeLine', () => {
  const facts = [
    'Event: Chapter Meeting',
    'When: Tonight 7:00 PM',
    'Points for coming: 5',
  ];
  const today = 'Wednesday, November 18, 2026';

  it('keeps one plain sentence whose numbers are in the facts', () => {
    expect(
      checkNudgeLine(
        { line: '  Being there counts for 5 points tonight. ' },
        facts,
        today,
      ),
    ).toBe('Being there counts for 5 points tonight.');
  });

  it.each([
    ['a number not in the facts', 'Bring 12 friends along.'],
    ['two sentences', 'It matters. Be there.'],
    ['an exclamation mark', 'See you there!'],
    ['blame', 'Do not let the chapter down.'],
    ['markup', 'Read **this** first.'],
    ['too long', 'x'.repeat(121)],
  ])('refuses %s', (_label, line) => {
    expect(checkNudgeLine({ line }, facts, today)).toBeNull();
  });
});
