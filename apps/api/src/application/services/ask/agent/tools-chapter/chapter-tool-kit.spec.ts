import { askerContext } from '#test/helpers/agent-tool.fixture';
import {
  duration,
  fitRows,
  listSourceId,
  localWeekStart,
  matchByName,
  matchPerson,
  People,
  percent,
  quoted,
  readWindow,
  TEXT_BUDGET,
} from './chapter-tool-kit';

const context = askerContext();
const defaults = { backDays: 30, aheadDays: 120, maxDays: 366 };
const iso = (window: { start: Date; end: Date }) => [
  window.start.toISOString(),
  window.end.toISOString(),
];

describe('readWindow', () => {
  it('reads whole days in the asker’s zone', () => {
    expect(
      iso(
        readWindow({ from: '2026-11-01', to: '2026-11-30' }, context, defaults),
      ),
    ).toEqual(['2026-11-01T04:00:00.000Z', '2026-12-01T05:00:00.000Z']);
  });

  it('reads on from a day far ahead, and back from a day long past', () => {
    const ahead = readWindow({ from: '2027-06-01', to: '' }, context, defaults);
    expect(ahead.start.toISOString()).toBe('2027-06-01T04:00:00.000Z');
    expect(ahead.end > ahead.start).toBe(true);
    const behind = readWindow(
      { from: '', to: '2026-01-31' },
      context,
      defaults,
    );
    expect(behind.end.toISOString()).toBe('2026-02-01T05:00:00.000Z');
    expect(behind.start < behind.end).toBe(true);
  });

  it('puts a backwards range the right way round', () => {
    const window = readWindow(
      { from: '2026-11-30', to: '2026-11-01' },
      context,
      defaults,
    );
    // Both named days are read, as they are the right way round.
    expect(iso(window)).toEqual(
      iso(
        readWindow({ from: '2026-11-01', to: '2026-11-30' }, context, defaults),
      ),
    );
  });

  it('reads the whole of a day the clocks go back, as one day', () => {
    // November 1, 2026 is 25 hours long in New York.
    const window = readWindow(
      { from: '2026-11-01', to: '2026-11-01' },
      context,
      { backDays: 0, aheadDays: 0, maxDays: 1 },
    );
    expect(iso(window)).toEqual([
      '2026-11-01T04:00:00.000Z',
      '2026-11-02T05:00:00.000Z',
    ]);
    expect(window.shortened).toBe(false);
  });

  it('starts the week on Sunday where the asker is', () => {
    expect(localWeekStart(context).toISOString()).toBe(
      '2026-11-08T05:00:00.000Z',
    );
    // 5 PM Saturday in Los Angeles is already Sunday in UTC.
    expect(
      localWeekStart(
        askerContext({
          now: new Date('2026-11-15T01:00:00.000Z'),
          timeZone: 'America/Los_Angeles',
        }),
      ).toISOString(),
    ).toBe('2026-11-08T08:00:00.000Z');
  });

  it('never reads longer than the tool allows', () => {
    const window = readWindow(
      { from: '2000-01-01', to: '2030-01-01' },
      context,
      defaults,
    );
    expect(window.shortened).toBe(true);
    expect(window.end.getTime() - window.start.getTime()).toBe(
      366 * 86_400_000,
    );
  });

  it('takes a day that does not exist for no day at all', () => {
    expect(
      iso(readWindow({ from: '2026-02-30', to: '' }, context, defaults)),
    ).toEqual(iso(readWindow({ from: '', to: '' }, context, defaults)));
  });
});

describe('matchByName', () => {
  const names = ['Jordan Lee', 'Jordan Park', 'Lee Ann Cho', 'José Álvarez'];
  const match = (query: string) => matchByName(names, (name) => name, query);

  it('prefers the exact name, then a part of it, then its words in any order', () => {
    expect(match('jordan lee')).toEqual(['Jordan Lee']);
    expect(match('Jordan')).toEqual(['Jordan Lee', 'Jordan Park']);
    expect(match('Lee Jordan')).toEqual(['Jordan Lee']);
    expect(match('jose alvarez')).toEqual(['José Álvarez']);
    expect(match('  ')).toEqual([]);
    expect(match('Sam')).toEqual([]);
  });
});

describe('matchPerson', () => {
  const names = ['Lee Park', 'Ashlee Stone', 'Kaylee Wu', 'Jordan Lee'];
  const match = (query: string) => matchPerson(names, (name) => name, query);

  it('takes a whole word over the same letters inside a longer one', () => {
    expect(match('lee')).toEqual(['Lee Park', 'Jordan Lee']);
    expect(match('lee jordan')).toEqual(['Jordan Lee']);
    expect(match('ash')).toEqual(['Ashlee Stone']);
    expect(match('ayle')).toEqual(['Kaylee Wu']);
    expect(match('zz')).toEqual([]);
    expect(match(' . ')).toEqual([]);
  });
});

describe('fitRows', () => {
  it('stops at the limit and at the size one result may be, never mid-row', () => {
    const rows = Array.from({ length: 500 }, (_, index) =>
      `Row ${index} `.padEnd(100, 'x'),
    );
    expect(fitRows([], rows, 10)).toHaveLength(10);
    const fitted = fitRows(['Summary.'], rows, 1_000);
    expect(fitted.length).toBeLessThan(500);
    expect(fitted.join('\n').length).toBeLessThanOrEqual(TEXT_BUDGET);
    expect(fitted.every((row) => row.length === 100)).toBe(true);
  });
});

describe('the words a result is written in', () => {
  it('writes hours, rates and member text one way', () => {
    expect(duration(0)).toBe('0 minutes');
    expect(duration(61)).toBe('1 hour 1 minute');
    expect(duration(120)).toBe('2 hours');
    expect(percent(1, 3)).toBe('33%');
    expect(percent(0, 0)).toBeNull();
    expect(quoted('Say "hi"\nand “bye”')).toBe(`"Say 'hi' and 'bye'"`);
    expect(quoted(null)).toBe('""');
  });

  it('gives two calls with different arguments different source ids', () => {
    expect(listSourceId('events')).toBe('tool:events');
    expect(listSourceId('events', '', '', '')).toBe('tool:events');
    expect(listSourceId('events', '2026-11-01', '', 'Formal!')).toBe(
      'tool:events:2026-11-01::formal',
    );
  });

  it('keeps two long arguments that differ late apart, and the id short', () => {
    const long = 'the formal at the lake house with the alumni board and ';
    const one = listSourceId('events', `${long}dinner`);
    const two = listSourceId('events', `${long}dancing`);
    expect(one).not.toBe(two);
    expect(one.length).toBeLessThan(70);
    expect(listSourceId('events', `${long}dinner`)).toBe(one);
  });

  it('does not take a longer name for the shorter one inside it', () => {
    const people = new People([
      { user_id: 'a', display_name: 'Sam' },
      { user_id: 'b', display_name: 'Sam Lee' },
      { user_id: 'c', display_name: 'Sam Lee' },
    ]);
    people.name('a');
    const text = `${people.name('b')}: here. ${people.name('c')}: here too.`;
    expect(people.entities(text).map((entity) => entity.id)).toEqual([
      'b',
      'c',
    ]);
    expect(people.entities(`${text} Sam: also`)).toHaveLength(3);
  });

  it('names as entities only the members whose names are in the text', () => {
    const people = new People([
      { user_id: 'a', display_name: 'Dana Reyes' },
      { user_id: 'b', display_name: 'Avery Lin' },
    ]);
    const text = `${people.name('a')}: here`;
    people.name('b');
    expect(people.name('nobody')).toBe('A former member');
    expect(people.entities(text)).toEqual([
      { type: 'member', id: 'a', name: 'Dana Reyes' },
    ]);
    // "Dan" is not named by a line about "Dana".
    const short = new People([{ user_id: 'c', display_name: 'Dana' }]);
    short.name('c');
    expect(short.entities('Danae Reyes: here')).toEqual([]);
    expect(short.entities('Place 1: Dana, 5 points')).toHaveLength(1);
  });
});
