import {
  LAST_YEAR_SHIFT_DAYS,
  compareWithLastYear,
  lastYearDedupeKey,
  lastYearWindows,
  sameThing,
  seenThisYear,
  shiftDate,
  titleKey,
  titleTokens,
  type LastYearTaskRecord,
} from './last-year-comparison';

// A new president in March: philanthropy week was the second week of April.
const NOW = new Date('2027-03-08T15:00:00.000Z');

const event = (id: string, name: string, start: string) => ({
  id,
  name,
  start_time: start,
});

const task = (
  id: string,
  title: string,
  due: string,
  extra: Partial<LastYearTaskRecord> = {},
): LastYearTaskRecord => ({
  id,
  title,
  description: null,
  due_date: due,
  completed: true,
  subtasks: [],
  ...extra,
});

describe('lastYearWindows', () => {
  it('looks six weeks ahead, 52 weeks back, and reads this year with slack either side', () => {
    const windows = lastYearWindows(NOW);
    expect(windows.lastYear.from.toISOString()).toBe(
      '2026-03-09T15:00:00.000Z',
    );
    expect(windows.lastYear.to.toISOString()).toBe('2026-04-20T15:00:00.000Z');
    expect(windows.thisYear.from.toISOString()).toBe(
      '2027-01-07T15:00:00.000Z',
    );
    expect(windows.thisYear.to.toISOString()).toBe('2027-06-18T15:00:00.000Z');
  });

  it('keeps the weekday: a Saturday last year lines up with a Saturday', () => {
    const lastYear = new Date('2026-04-11T00:00:00Z'); // a Saturday
    const shifted = new Date(shiftDate('2026-04-11', LAST_YEAR_SHIFT_DAYS));
    expect(shifted.getUTCDay()).toBe(lastYear.getUTCDay());
    expect(shiftDate('2026-04-11', LAST_YEAR_SHIFT_DAYS)).toBe('2027-04-10');
  });
});

describe('titles', () => {
  it('drops years, counts, filler and the term', () => {
    expect(titleTokens('The 3rd Annual Fall Formal 2025')).toEqual(['formal']);
    expect(titleKey('Philanthropy Week!')).toBe('philanthropy week');
  });

  it('keeps the term when it is all a title has', () => {
    expect(titleTokens('Spring 2026')).toEqual(['spring']);
  });

  it('treats a plural as the same word', () => {
    expect(titleKey('Brotherhood Events')).toBe(titleKey('brotherhood event'));
  });

  it('has nothing to compare for a title of only numbers and punctuation', () => {
    expect(titleKey('2026 !!')).toBe('');
    expect(sameThing([], ['formal'])).toBe(false);
  });

  it('sees a thing under a longer or shorter name', () => {
    const thisYear = [
      'Plan philanthropy week',
      'Formal',
      "Founders' Day dinner",
    ].map(titleTokens);
    expect(seenThisYear('Philanthropy Week 2026', thisYear)).toBe(true);
    expect(seenThisYear('Spring Formal', thisYear)).toBe(true);
    expect(seenThisYear('Founders Day', thisYear)).toBe(true);
    expect(seenThisYear('Alumni Golf Outing', thisYear)).toBe(false);
  });

  it('does not match two things that share one word of several', () => {
    expect(
      sameThing(
        titleTokens('Alumni golf outing'),
        titleTokens('Alumni dinner'),
      ),
    ).toBe(false);
  });
});

describe('compareWithLastYear', () => {
  it('raises an event held then and not on this year’s record', () => {
    const things = compareWithLastYear({
      now: NOW,
      lastYearEvents: [
        event('e1', 'Philanthropy Week', '2026-04-13T22:00:00.000Z'),
      ],
      tasks: [],
      thisYearTitles: ['Chapter meeting'],
    });
    expect(things).toEqual([
      {
        type: 'event',
        dedupeKey: lastYearDedupeKey(
          'event',
          'philanthropy week',
          new Date('2027-04-12T22:00:00.000Z'),
        ),
        sourceId: 'e1',
        name: 'Philanthropy Week',
        lastYearAt: '2026-04-13T22:00:00.000Z',
        times: 1,
      },
    ]);
  });

  it('stays quiet when this year has it under another name, as an event or a task', () => {
    const lastYearEvents = [
      event('e1', 'Philanthropy Week 2026', '2026-04-13T22:00:00.000Z'),
      event('e2', 'Spring Formal', '2026-04-04T23:00:00.000Z'),
    ];
    expect(
      compareWithLastYear({
        now: NOW,
        lastYearEvents,
        tasks: [],
        thisYearTitles: ['Philanthropy Week', 'Book the formal venue'],
      }),
    ).toEqual([]);
  });

  it('ignores what falls outside the six weeks', () => {
    expect(
      compareWithLastYear({
        now: NOW,
        lastYearEvents: [
          event('early', 'Rush kickoff', '2026-02-01T22:00:00.000Z'),
          event('late', 'Senior send-off', '2026-05-09T22:00:00.000Z'),
        ],
        tasks: [task('t', 'File the insurance renewal', '2026-06-01')],
        thisYearTitles: [],
      }),
    ).toEqual([]);
  });

  it('makes a weekly series one thing, from its first night, and counts it', () => {
    const things = compareWithLastYear({
      now: NOW,
      lastYearEvents: [
        event('c3', 'Chapter Meeting', '2026-03-29T23:00:00.000Z'),
        event('c1', 'Chapter Meeting', '2026-03-15T23:00:00.000Z'),
        event('c2', 'Chapter meeting', '2026-03-22T23:00:00.000Z'),
      ],
      tasks: [],
      thisYearTitles: [],
    });
    expect(things).toHaveLength(1);
    expect(things[0]).toMatchObject({ sourceId: 'c1', times: 3 });
  });

  it('puts the soonest anniversary first, and events before tasks', () => {
    const things = compareWithLastYear({
      now: NOW,
      lastYearEvents: [
        event('later', 'Alumni Golf Outing', '2026-04-18T15:00:00.000Z'),
        event('sooner', 'Parents Weekend', '2026-03-21T15:00:00.000Z'),
      ],
      tasks: [task('t1', 'Submit the housing contract', '2026-03-12')],
      thisYearTitles: [],
    });
    expect(things.map((thing) => thing.sourceId)).toEqual([
      'sooner',
      'later',
      't1',
    ]);
  });

  describe('tasks', () => {
    it('raises a finished task with its checklist, and leaves an unfinished one', () => {
      const things = compareWithLastYear({
        now: NOW,
        lastYearEvents: [],
        tasks: [
          task('done', 'Submit the housing contract', '2026-03-20', {
            description: 'Signed copy to the housing office.',
            subtasks: ['Get signatures', 'Scan and send'],
          }),
          task('never', 'Repaint the letters', '2026-03-22', {
            completed: false,
          }),
        ],
        thisYearTitles: [],
      });
      expect(things).toEqual([
        {
          type: 'task',
          dedupeKey: expect.any(String),
          sourceId: 'done',
          title: 'Submit the housing contract',
          description: 'Signed copy to the housing office.',
          subtasks: ['Get signatures', 'Scan and send'],
          lastYearOn: '2026-03-20',
        },
      ]);
    });

    it('leaves a routine chore: the same title due in three different months', () => {
      const things = compareWithLastYear({
        now: NOW,
        lastYearEvents: [],
        tasks: [
          task('k1', 'Clean the kitchen', '2026-01-10'),
          task('k2', 'Clean the kitchen', '2026-02-10'),
          task('k3', 'Clean the kitchen', '2026-03-10'),
        ],
        thisYearTitles: [],
      });
      expect(things).toEqual([]);
    });

    it('raises a title once however many tasks carried it', () => {
      const things = compareWithLastYear({
        now: NOW,
        lastYearEvents: [],
        tasks: [
          task('a', 'Order formal favors', '2026-03-20'),
          task('b', 'Order Formal Favors', '2026-03-27'),
        ],
        thisYearTitles: [],
      });
      expect(things.map((thing) => thing.sourceId)).toEqual(['a']);
    });

    it('leaves a task for an event that is itself being raised', () => {
      const things = compareWithLastYear({
        now: NOW,
        lastYearEvents: [
          event('e', 'Philanthropy Week', '2026-04-13T22:00:00.000Z'),
        ],
        tasks: [task('t', 'Plan philanthropy week', '2026-03-25')],
        thisYearTitles: [],
      });
      expect(things.map((thing) => thing.sourceId)).toEqual(['e']);
    });
  });

  it('keys a thing by the year of its anniversary, never by its words', () => {
    const a = lastYearDedupeKey('event', 'formal', new Date('2027-04-03'));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).toBe(
      lastYearDedupeKey('event', 'formal', new Date('2027-11-03')),
    );
    expect(a).not.toBe(
      lastYearDedupeKey('event', 'formal', new Date('2028-04-03')),
    );
    expect(a).not.toBe(
      lastYearDedupeKey('task', 'formal', new Date('2027-04-03')),
    );
  });
});
