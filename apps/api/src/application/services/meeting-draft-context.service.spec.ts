import { NotFoundException } from '@nestjs/common';
import type { Meeting } from '#domain/entities/meeting.entity';
import type { Event } from '#domain/entities/event.entity';
import type { MinutesRosterMember } from '#domain/utils/minutes-draft';
import { CARRIED_HEADING } from '#domain/utils/minutes-context';
import {
  MeetingDraftContextService,
  sameAudience,
} from './meeting-draft-context.service';
import type { MeetingService } from './meeting.service';
import type { EventService } from './event.service';

const CHAPTER = 'ch-1';
const SECRETARY = 'u-secretary';
const PRIYA = '0a000000-0000-4000-8000-00000000000b';

const event = (id: string, overrides: Partial<Event> = {}): Event =>
  ({
    id,
    chapter_id: CHAPTER,
    name: 'Chapter meeting',
    start_time: '2026-11-10T00:00:00.000Z',
    parent_event_id: 'series-1',
    required_role_ids: [],
    optional_role_ids: [],
    excluded_role_ids: [],
    others_invited: null,
    agenda: [],
    ...overrides,
  }) as Event;

const minutes = (
  id: string,
  eventId: string | null,
  date: string,
  overrides: Partial<Meeting> = {},
): Meeting => ({
  id,
  chapter_id: CHAPTER,
  event_id: eventId,
  event_name: 'Chapter meeting',
  event_start_time: `${date}T00:00:00.000Z`,
  meeting_type: 'chapter',
  other_label: null,
  status: 'posted',
  content: {
    officer_reports: `Treasurer: report for ${id}`,
    discussion_log: `Topic of ${id}\n- a point`,
    action_items: [
      { text: `Do the thing from ${id}`, owner_user_id: PRIYA, due_date: null },
    ],
  },
  created_by: SECRETARY,
  updated_by: SECRETARY,
  posted_by: SECRETARY,
  posted_at: null,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-01T00:00:00.000Z',
  transcript: null,
  ...overrides,
});

const ROSTER: MinutesRosterMember[] = [
  {
    userId: PRIYA,
    name: 'Priya Natarajan',
    roles: ['Treasurer'],
    checkedIn: true,
  },
];

const TONIGHT = minutes('tonight', 'evt-tonight', '2026-11-10', {
  status: 'draft',
  content: {},
});

function setup(options: {
  earlier: Meeting[];
  events: Event[];
  tonight?: Event | null;
}) {
  const meetings = {
    listPostedBefore: jest.fn().mockResolvedValue(options.earlier),
  };
  const tonight =
    options.tonight === undefined
      ? event('evt-tonight', {
          agenda: [
            { id: 'a1', text: 'Treasurer report', done: false },
            { id: 'a2', text: '  ', done: false },
            { id: 'a3', text: 'Formal', done: false },
          ],
        })
      : options.tonight;
  const events = {
    findById: jest.fn(() =>
      tonight
        ? Promise.resolve(tonight)
        : Promise.reject(new NotFoundException('Event not found')),
    ),
    findVisibleByIds: jest.fn((ids: string[]) =>
      Promise.resolve(options.events.filter((e) => ids.includes(e.id))),
    ),
  };
  const service = new MeetingDraftContextService(
    meetings as unknown as MeetingService,
    events as unknown as EventService,
  );
  return { service, meetings, events };
}

describe('MeetingDraftContextService (#5477)', () => {
  it('reads as the drafting officer: their read rule, their view of the events', async () => {
    const { service, meetings, events } = setup({
      earlier: [minutes('m1', 'evt-1', '2026-11-03')],
      events: [event('evt-1')],
    });
    const context = await service.contextFor(
      CHAPTER,
      TONIGHT,
      SECRETARY,
      ROSTER,
    );

    expect(meetings.listPostedBefore).toHaveBeenCalledWith(
      CHAPTER,
      SECRETARY,
      TONIGHT.event_start_time,
      'chapter',
      expect.any(Number),
    );
    expect(events.findById).toHaveBeenCalledWith(
      'evt-tonight',
      CHAPTER,
      SECRETARY,
    );
    expect(events.findVisibleByIds).toHaveBeenCalledWith(
      ['evt-1'],
      CHAPTER,
      SECRETARY,
    );
    expect(context.agenda).toEqual([
      { text: 'Treasurer report', tabledFrom: null },
      { text: 'Formal', tabledFrom: null },
    ]);
    expect(context.background).toEqual({
      meetings: [
        {
          startTime: '2026-11-03T00:00:00.000Z',
          name: 'Chapter meeting',
          sameSeries: true,
          reports: ['Treasurer'],
          topics: ['Topic of m1'],
        },
      ],
      carried: [
        {
          id: 'F1',
          text: 'Do the thing from m1',
          ownerUserId: PRIYA,
          ownerName: 'Priya Natarajan',
          dueDate: null,
          fromStartTime: '2026-11-03T00:00:00.000Z',
        },
      ],
      standingReports: [
        {
          id: 'R1',
          office: 'Treasurer',
          lastStartTime: '2026-11-03T00:00:00.000Z',
        },
      ],
    });
  });

  it('never carries minutes the officer can’t read, or whose event they can’t see', async () => {
    // `listPostedBefore` already left out what the read rule hides; an event
    // the officer no longer sees leaves its minutes out too.
    const { service } = setup({
      earlier: [minutes('m-hidden-event', 'evt-gone', '2026-11-03')],
      events: [],
    });
    const context = await service.contextFor(
      CHAPTER,
      TONIGHT,
      SECRETARY,
      ROSTER,
    );
    expect(context.background).toBeUndefined();
  });

  it('reads only the same type, never Standards, and never another audience', async () => {
    const { service } = setup({
      earlier: [
        minutes('exec', 'evt-exec', '2026-11-08', { meeting_type: 'exec' }),
        minutes('standards', 'evt-std', '2026-11-07', {
          meeting_type: 'standards' as never,
        }),
        minutes('officers-only', 'evt-off', '2026-11-06'),
        minutes('no-event', null, '2026-11-05'),
        minutes('ok', 'evt-ok', '2026-11-04'),
      ],
      events: [
        event('evt-exec'),
        event('evt-std'),
        event('evt-off', {
          required_role_ids: ['r-officer'],
          others_invited: false,
        }),
        event('evt-ok'),
      ],
    });
    const context = await service.contextFor(
      CHAPTER,
      TONIGHT,
      SECRETARY,
      ROSTER,
    );
    expect(
      context.background?.meetings.map((m) => m.startTime.slice(0, 10)),
    ).toEqual(['2026-11-04']);
    expect(context.background?.carried[0].text).toBe('Do the thing from ok');
  });

  it('prefers the same series, then the newest of the rest, three at most', async () => {
    const { service } = setup({
      earlier: [
        minutes('other-1', 'evt-o1', '2026-11-08'),
        minutes('series-1', 'evt-s1', '2026-11-03'),
        minutes('other-2', 'evt-o2', '2026-11-02'),
        minutes('series-2', 'evt-s2', '2026-10-27'),
      ],
      events: [
        event('evt-o1', { parent_event_id: null }),
        event('evt-s1'),
        event('evt-o2', { parent_event_id: 'series-2' }),
        event('evt-s2'),
      ],
    });
    const context = await service.contextFor(
      CHAPTER,
      TONIGHT,
      SECRETARY,
      ROSTER,
    );
    expect(
      context.background?.meetings.map((m) => m.startTime.slice(0, 10)),
    ).toEqual(['2026-11-03', '2026-10-27', '2026-11-08']);
    // Last meeting is the series' newest, not the newest of any kind.
    expect(context.background?.carried[0].text).toBe(
      'Do the thing from series-1',
    );
  });

  it('reads nothing when tonight’s event is gone or hidden from the officer', async () => {
    const { service, meetings } = setup({
      earlier: [minutes('m1', 'evt-1', '2026-11-03')],
      events: [event('evt-1')],
      tonight: null,
    });
    expect(
      await service.contextFor(CHAPTER, TONIGHT, SECRETARY, ROSTER),
    ).toEqual({
      agenda: [],
    });
    expect(meetings.listPostedBefore).not.toHaveBeenCalled();
    expect(
      await service.contextFor(
        CHAPTER,
        { ...TONIGHT, event_id: null },
        SECRETARY,
        ROSTER,
      ),
    ).toEqual({ agenda: [] });
  });

  it('compares audiences by rule, not by order', () => {
    expect(
      sameAudience(
        event('a', { required_role_ids: ['x', 'y'] }),
        event('b', { required_role_ids: ['y', 'x'] }),
      ),
    ).toBe(true);
    // No answer stored for everyone else reads as the rule's default.
    expect(sameAudience(event('a'), event('b', { others_invited: true }))).toBe(
      true,
    );
    // Each role list counts on its own, everyone else's rule held equal.
    const closed = { others_invited: false };
    expect(
      sameAudience(event('a'), event('b', { excluded_role_ids: ['pledge'] })),
    ).toBe(false);
    expect(
      sameAudience(
        event('a', { ...closed, required_role_ids: ['officers'] }),
        event('b', { ...closed, required_role_ids: ['officers', 'chairs'] }),
      ),
    ).toBe(false);
    expect(
      sameAudience(
        event('a', { ...closed, optional_role_ids: ['officers'] }),
        event('b', { ...closed, optional_role_ids: ['officers', 'chairs'] }),
      ),
    ).toBe(false);
  });

  it('never carries minutes of a narrower audience, even with the same rule for everyone else', async () => {
    const closed = { others_invited: false };
    const { service } = setup({
      earlier: [
        minutes('officers', 'evt-officers', '2026-11-06'),
        minutes('same', 'evt-same', '2026-11-04'),
      ],
      events: [
        event('evt-officers', { ...closed, optional_role_ids: ['officers'] }),
        event('evt-same', {
          ...closed,
          optional_role_ids: ['officers', 'chairs'],
        }),
      ],
      tonight: event('evt-tonight', {
        ...closed,
        optional_role_ids: ['chairs', 'officers'],
      }),
    });
    const context = await service.contextFor(
      CHAPTER,
      TONIGHT,
      SECRETARY,
      ROSTER,
    );
    expect(context.background?.carried.map((item) => item.text)).toEqual([
      'Do the thing from same',
    ]);
  });

  it('reads an Other meeting\u2019s earlier minutes only under the same label', async () => {
    const other = (label: string) => ({
      meeting_type: 'other' as const,
      other_label: label,
    });
    const { service } = setup({
      earlier: [
        minutes('alumni', 'evt-a', '2026-11-06', other('Alumni board')),
        minutes('housing', 'evt-h', '2026-11-04', other('housing corp ')),
      ],
      events: [event('evt-a'), event('evt-h')],
    });
    const context = await service.contextFor(
      CHAPTER,
      { ...TONIGHT, ...other('Housing Corp') },
      SECRETARY,
      ROSTER,
    );
    expect(context.background?.carried.map((item) => item.text)).toEqual([
      'Do the thing from housing',
    ]);
  });

  it('carries again what last meeting carried over and left open', async () => {
    const { service } = setup({
      earlier: [
        minutes('m2', 'evt-2', '2026-11-03', {
          content: {
            action_items: [
              { text: 'Book the DJ', owner_user_id: null, due_date: null },
            ],
            discussion_log: [
              'Formal',
              '- DJ approved',
              '',
              CARRIED_HEADING,
              '- Order the washer (Priya Natarajan): still open, carried over.',
              '- Reserve the bus: not mentioned tonight, confirm before posting.',
              '- Pay the deposit: reported done tonight.',
              // Frapp's line, carried twice: once is enough.
              '- Book the DJ: not mentioned tonight, confirm before posting.',
            ].join('\n'),
          },
        }),
      ],
      events: [event('evt-2')],
    });
    const context = await service.contextFor(
      CHAPTER,
      TONIGHT,
      SECRETARY,
      ROSTER,
    );
    expect(
      context.background?.carried.map((item) => [item.text, item.ownerUserId]),
    ).toEqual([
      ['Book the DJ', null],
      ['Order the washer', PRIYA],
      ['Reserve the bus', null],
    ]);
    // The carried block is not an earlier topic.
    expect(context.background?.meetings[0].topics).toEqual(['Formal']);
  });
});
