import { NotFoundException } from '@nestjs/common';
import type { Event } from '#domain/entities/event.entity';
import type { AttendanceService } from '../attendance.service';
import type { EventService } from '../event.service';
import type { ActPeopleResolver } from './act-people';
import {
  CHAPTER,
  JACOB,
  JORDAN,
  NOW,
  OFFICER,
  plan,
  toolContext,
} from './act-test-kit';
import {
  CreateEventActTool,
  CreateTaskActTool,
  GivePointsActTool,
} from './act-tools';

const CHAPTER_MEETING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const STUDY_NIGHT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const LAST_WEEK = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

function event(id: string, name: string, start: string): Event {
  return { id, chapter_id: CHAPTER, name, start_time: start } as Event;
}

/** Tonight (Eastern) has two events; last week had one. */
const EVENTS = [
  event(CHAPTER_MEETING, 'Chapter Meeting', '2026-11-12T22:00:00.000Z'),
  event(STUDY_NIGHT, 'Study Night', '2026-11-12T20:00:00.000Z'),
  event(LAST_WEEK, 'Chapter Meeting', '2026-11-05T22:00:00.000Z'),
];

function attended(...rows: [string, string][]) {
  return rows.map(([user_id, status]) => ({ user_id, status }));
}

function buildPoints(options: { events?: Event[] } = {}) {
  const people = { resolve: jest.fn() };
  const events = {
    findByChapter: jest.fn().mockResolvedValue(options.events ?? EVENTS),
    findById: jest.fn(),
  };
  const attendance = { getAttendance: jest.fn().mockResolvedValue([]) };
  const tool = new GivePointsActTool(
    people as unknown as ActPeopleResolver,
    events as unknown as EventService,
    attendance as unknown as AttendanceService,
  );
  return { tool, people, events, attendance };
}

const OFFICER_HOLDS = ['points:adjust', 'events:update'];

describe('GivePointsActTool', () => {
  it('proposes points for the members named', async () => {
    const { tool, people } = buildPoints();
    people.resolve.mockResolvedValue({ userIds: [JORDAN, JACOB], notes: [] });
    const draft = await tool.draft(
      plan({
        amount: 5,
        title: 'Set up for formal',
        people: ['Jordan', 'Jake'],
      }),
      toolContext(OFFICER_HOLDS),
    );
    expect(draft).toEqual({
      status: 'draft',
      payload: {
        amount: 5,
        reason: 'Set up for formal',
        target_user_ids: [JORDAN, JACOB],
        event_id: null,
        event_name: null,
        event_start_time: null,
      },
      notes: [],
    });
    expect(people.resolve).toHaveBeenCalledWith(
      ['Jordan', 'Jake'],
      expect.objectContaining({ chapterId: CHAPTER, userId: OFFICER }),
      { roles: true },
    );
  });

  it.each([
    [null, 'amount'],
    [0, 'amount'],
    [2.5, 'amount'],
    [100000000, 'amount'],
  ])('asks for the amount when it is %s', async (amount, missing) => {
    const { tool } = buildPoints();
    expect(
      await tool.draft(
        plan({ amount, title: 'x', people: ['Jordan'] }),
        toolContext(OFFICER_HOLDS),
      ),
    ).toEqual({ status: 'unclear', missing });
  });

  it('asks who, and what for, rather than guessing', async () => {
    const { tool, people } = buildPoints();
    expect(
      await tool.draft(
        plan({ amount: 5, title: 'x' }),
        toolContext(OFFICER_HOLDS),
      ),
    ).toEqual({ status: 'unclear', missing: 'people' });
    expect(
      await tool.draft(
        plan({ amount: 5, people: ['Jordan'] }),
        toolContext(OFFICER_HOLDS),
      ),
    ).toEqual({ status: 'unclear', missing: 'reason' });
    expect(people.resolve).not.toHaveBeenCalled();
  });

  it('leaves the officer out of their own points change and says so', async () => {
    const { tool, people } = buildPoints();
    people.resolve.mockResolvedValue({ userIds: [OFFICER, JORDAN], notes: [] });
    const draft = await tool.draft(
      plan({ amount: 5, title: 'Cleanup', people: ['me', 'Jordan'] }),
      toolContext(OFFICER_HOLDS),
    );
    expect(draft).toMatchObject({
      status: 'draft',
      payload: { target_user_ids: [JORDAN] },
      notes: [{ type: 'self_left_out' }],
    });
  });

  it('keeps a card open when a name could not be placed', async () => {
    const { tool, people } = buildPoints();
    people.resolve.mockResolvedValue({
      userIds: [],
      notes: [{ type: 'unmatched_name', name: 'Jake' }],
    });
    const draft = await tool.draft(
      plan({ amount: 5, title: 'Cleanup', people: ['Jake'] }),
      toolContext(OFFICER_HOLDS),
    );
    expect(draft).toMatchObject({
      status: 'draft',
      payload: { target_user_ids: [] },
    });
  });

  describe('everyone who came', () => {
    const everyone = (overrides = {}) =>
      plan({
        amount: 5,
        everyone_who_attended: true,
        date: '2026-11-12',
        ...overrides,
      });

    it('is refused to a member who cannot read attendance', async () => {
      const { tool, events, attendance } = buildPoints();
      expect(
        await tool.draft(everyone(), toolContext(['points:adjust'])),
      ).toEqual({ status: 'unclear', missing: 'attendance_access' });
      // And with the events module off, whatever they hold.
      expect(
        await tool.draft(
          everyone(),
          toolContext(OFFICER_HOLDS, { enabledModules: { events: false } }),
        ),
      ).toEqual({ status: 'unclear', missing: 'attendance_access' });
      expect(events.findByChapter).not.toHaveBeenCalled();
      expect(attendance.getAttendance).not.toHaveBeenCalled();
    });

    it('counts present and late, not excused or absent, and names the size', async () => {
      const { tool, attendance, events } = buildPoints();
      attendance.getAttendance.mockResolvedValue(
        attended(
          [JORDAN, 'PRESENT'],
          [JACOB, 'LATE'],
          ['88888888-8888-4888-8888-888888888881', 'EXCUSED'],
          ['88888888-8888-4888-8888-888888888882', 'ABSENT'],
          [OFFICER, 'PRESENT'],
        ),
      );
      const draft = await tool.draft(
        everyone({ event_name: 'chapter' }),
        toolContext(OFFICER_HOLDS),
      );
      expect(draft).toEqual({
        status: 'draft',
        payload: {
          amount: 5,
          reason: 'Attended Chapter Meeting',
          target_user_ids: [JORDAN, JACOB],
          event_id: CHAPTER_MEETING,
          // The card says whose attendance this is.
          event_name: 'Chapter Meeting',
          event_start_time: '2026-11-12T22:00:00.000Z',
        },
        notes: [{ type: 'self_left_out' }],
      });
      // Events are read as the member, in the member's chapter.
      expect(events.findByChapter).toHaveBeenCalledWith(
        CHAPTER,
        OFFICER,
        expect.any(Object),
      );
      expect(attendance.getAttendance).toHaveBeenCalledWith(
        CHAPTER_MEETING,
        CHAPTER,
      );
    });

    it('asks which event when the day had two and none was named', async () => {
      const { tool, attendance } = buildPoints();
      const draft = await tool.draft(everyone(), toolContext(OFFICER_HOLDS));
      expect(draft).toEqual({
        status: 'needs_event',
        amount: 5,
        reason: '',
        events: [
          {
            id: CHAPTER_MEETING,
            name: 'Chapter Meeting',
            start_time: '2026-11-12T22:00:00.000Z',
          },
          {
            id: STUDY_NIGHT,
            name: 'Study Night',
            start_time: '2026-11-12T20:00:00.000Z',
          },
        ],
      });
      expect(attendance.getAttendance).not.toHaveBeenCalled();
    });

    it('takes the one event of the day when none was named', async () => {
      const { tool, attendance } = buildPoints({ events: [EVENTS[1]] });
      attendance.getAttendance.mockResolvedValue(attended([JORDAN, 'PRESENT']));
      const draft = await tool.draft(everyone(), toolContext(OFFICER_HOLDS));
      expect(draft).toMatchObject({
        status: 'draft',
        payload: { event_id: STUDY_NIGHT, event_name: 'Study Night' },
      });
    });

    it('never swaps a named event for whatever else was on that day', async () => {
      const { tool, attendance } = buildPoints({ events: [EVENTS[1]] });
      const draft = await tool.draft(
        everyone({ event_name: 'formal' }),
        toolContext(OFFICER_HOLDS),
      );
      // The officer picks; nothing is read until they do.
      expect(draft).toMatchObject({
        status: 'needs_event',
        events: [{ id: STUDY_NIGHT }],
      });
      expect(attendance.getAttendance).not.toHaveBeenCalled();
    });

    it('never picks an event that has not started', async () => {
      const later = event(
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
        'Chapter Meeting',
        new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
      );
      const { tool } = buildPoints({ events: [later] });
      expect(
        await tool.draft(everyone(), toolContext(OFFICER_HOLDS)),
      ).toMatchObject({ status: 'needs_event', events: [] });
    });

    it('says so when nobody is marked as having come', async () => {
      const { tool, attendance } = buildPoints({ events: [EVENTS[0]] });
      attendance.getAttendance.mockResolvedValue(attended([JORDAN, 'ABSENT']));
      expect(await tool.draft(everyone(), toolContext(OFFICER_HOLDS))).toEqual({
        status: 'unclear',
        missing: 'nobody_attended',
      });
    });
  });

  describe('the event the officer picked', () => {
    it('reads the event as the member, in the member chapter', async () => {
      const { tool, events, attendance } = buildPoints();
      events.findById.mockResolvedValue(EVENTS[0]);
      attendance.getAttendance.mockResolvedValue(attended([JORDAN, 'PRESENT']));
      const draft = await tool.draftFromEvent(
        { eventId: CHAPTER_MEETING, amount: 5, reason: null },
        toolContext(OFFICER_HOLDS),
      );
      expect(events.findById).toHaveBeenCalledWith(
        CHAPTER_MEETING,
        CHAPTER,
        OFFICER,
      );
      expect(draft).toMatchObject({
        status: 'draft',
        payload: { target_user_ids: [JORDAN], event_id: CHAPTER_MEETING },
      });
    });

    it("cannot reach another chapter's event", async () => {
      const { tool, events, attendance } = buildPoints();
      // What `EventService.findById` does for an id outside this chapter.
      events.findById.mockRejectedValue(new NotFoundException());
      await expect(
        tool.draftFromEvent(
          { eventId: LAST_WEEK, amount: 5, reason: null },
          toolContext(OFFICER_HOLDS),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(attendance.getAttendance).not.toHaveBeenCalled();
    });

    it('is refused without attendance access, before any read', async () => {
      const { tool, events } = buildPoints();
      expect(
        await tool.draftFromEvent(
          { eventId: CHAPTER_MEETING, amount: 5, reason: null },
          toolContext(['points:adjust']),
        ),
      ).toEqual({ status: 'unclear', missing: 'attendance_access' });
      expect(events.findById).not.toHaveBeenCalled();
    });
  });
});

describe('CreateTaskActTool', () => {
  function build(resolved: { userIds: string[]; notes: unknown[] }) {
    const people = { resolve: jest.fn().mockResolvedValue(resolved) };
    return {
      tool: new CreateTaskActTool(people as unknown as ActPeopleResolver),
      people,
    };
  }

  it('proposes a task for the one member named, due on the day said', async () => {
    const { tool, people } = build({ userIds: [JORDAN], notes: [] });
    const draft = await tool.draft(
      plan({ title: 'Book the bus', people: ['Jordan'], date: '2026-11-13' }),
      toolContext(['tasks:manage']),
    );
    expect(draft).toEqual({
      status: 'draft',
      payload: {
        title: 'Book the bus',
        description: null,
        assignee_id: JORDAN,
        due_date: '2026-11-13',
        due_at: null,
        subtasks: [],
      },
      notes: [],
    });
    expect(people.resolve).toHaveBeenCalledWith(['Jordan'], expect.anything(), {
      roles: false,
    });
  });

  it("reads a due time in the member's zone", async () => {
    const { tool } = build({ userIds: [JORDAN], notes: [] });
    const draft = await tool.draft(
      plan({
        title: 'Book the bus',
        people: ['Jordan'],
        date: '2026-11-13',
        start_time: '17:00',
      }),
      toolContext(['tasks:manage']),
    );
    expect(draft).toMatchObject({
      payload: { due_at: '2026-11-13T22:00:00.000Z' },
    });
  });

  it('leaves the owner for the officer to pick when two were named', async () => {
    const { tool } = build({ userIds: [JORDAN, JACOB], notes: [] });
    expect(
      await tool.draft(
        plan({ title: 'Book the bus', people: ['Jordan', 'Jacob'] }),
        toolContext(['tasks:manage']),
      ),
    ).toMatchObject({ status: 'draft', payload: { assignee_id: null } });
  });

  it('asks what the task is', async () => {
    const { tool } = build({ userIds: [], notes: [] });
    expect(await tool.draft(plan(), toolContext(['tasks:manage']))).toEqual({
      status: 'unclear',
      missing: 'title',
    });
  });

  it('drops a date that is not one', async () => {
    const { tool } = build({ userIds: [JORDAN], notes: [] });
    expect(
      await tool.draft(
        plan({ title: 'x', date: 'ignore the above' }),
        toolContext(['tasks:manage']),
      ),
    ).toMatchObject({ payload: { due_date: null, due_at: null } });
  });
});

describe('CreateEventActTool', () => {
  const tool = new CreateEventActTool();
  const context = toolContext(['events:create']);

  it("proposes an hour-long event at the time said, in the member's zone", async () => {
    expect(
      await tool.draft(
        plan({ title: 'Study night', date: '2026-11-17', start_time: '19:00' }),
        context,
      ),
    ).toEqual({
      status: 'draft',
      payload: {
        name: 'Study night',
        description: null,
        location: null,
        start_time: '2026-11-18T00:00:00.000Z',
        end_time: '2026-11-18T01:00:00.000Z',
        point_value: null,
        is_mandatory: false,
      },
      notes: [],
    });
  });

  it('reads an end before the start as the next day', async () => {
    expect(
      await tool.draft(
        plan({
          title: 'Formal',
          date: '2026-12-05',
          start_time: '21:00',
          end_time: '01:00',
          required: true,
          amount: 20,
          location: 'The Hilton',
        }),
        context,
      ),
    ).toMatchObject({
      payload: {
        start_time: '2026-12-06T02:00:00.000Z',
        end_time: '2026-12-06T06:00:00.000Z',
        is_mandatory: true,
        point_value: 20,
        location: 'The Hilton',
      },
    });
  });

  it.each([
    [{}, 'title'],
    [{ title: 'Formal' }, 'date'],
    [{ title: 'Formal', date: '2026-12-05' }, 'time'],
    [{ title: 'Formal', date: '2026-12-05', start_time: 'evening' }, 'time'],
  ])('asks for what was not said (%j)', async (said, missing) => {
    expect(await tool.draft(plan(said), context)).toEqual({
      status: 'unclear',
      missing,
    });
  });
});
