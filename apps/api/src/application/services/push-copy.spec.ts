import { formatDueDate, formatEventWhen, joinFacts } from './push-copy';

const NOW = new Date('2026-11-06T12:00:00Z');
const NY = { timeZone: 'America/New_York', now: NOW };

describe('formatEventWhen', () => {
  it('writes a same-day event the way a calendar does', () => {
    expect(
      formatEventWhen('2026-11-10T01:00:00Z', '2026-11-10T02:00:00Z', NY),
    ).toBe('Mon, Nov 9, 8–9 PM');
  });

  it('keeps minutes only when there are some', () => {
    expect(
      formatEventWhen('2026-11-10T01:30:00Z', '2026-11-10T02:45:00Z', NY),
    ).toBe('Mon, Nov 9, 8:30–9:45 PM');
  });

  it('names both halves of the day when the span crosses noon', () => {
    expect(
      formatEventWhen('2026-11-09T16:00:00Z', '2026-11-09T18:00:00Z', NY),
    ).toBe('Mon, Nov 9, 11 AM–1 PM');
  });

  it("renders in the reader's zone, so the day can change", () => {
    // 04:30Z is Monday night in Los Angeles and Tuesday morning in London.
    const start = '2026-11-10T04:30:00Z';
    const end = '2026-11-10T05:30:00Z';
    expect(
      formatEventWhen(start, end, {
        timeZone: 'America/Los_Angeles',
        now: NOW,
      }),
    ).toBe('Mon, Nov 9, 8:30–9:30 PM');
    expect(
      formatEventWhen(start, end, { timeZone: 'Europe/London', now: NOW }),
    ).toBe('Tue, Nov 10, 4:30–5:30 AM');
  });

  it('writes both ends of an event that spans days', () => {
    expect(
      formatEventWhen('2026-11-07T23:00:00Z', '2026-11-09T17:00:00Z', NY),
    ).toBe('Sat, Nov 7, 6 PM – Mon, Nov 9, 12 PM');
  });

  it('adds the year only when it is not this year', () => {
    expect(
      formatEventWhen('2027-01-15T23:00:00Z', '2027-01-16T00:00:00Z', NY),
    ).toBe('Fri, Jan 15, 2027, 6–7 PM');
  });

  it('labels the zone when it is a guess', () => {
    expect(
      formatEventWhen('2026-11-10T01:00:00Z', '2026-11-10T02:00:00Z', {
        ...NY,
        labelZone: true,
      }),
    ).toBe('Mon, Nov 9, 8–9 PM EST');
  });

  it('writes a series as its pattern', () => {
    const start = '2026-11-10T01:00:00Z';
    const end = '2026-11-10T02:00:00Z';
    expect(formatEventWhen(start, end, { ...NY, recurrence: 'WEEKLY' })).toBe(
      'Every Mon, 8–9 PM, from Nov 9',
    );
    expect(formatEventWhen(start, end, { ...NY, recurrence: 'BIWEEKLY' })).toBe(
      'Every other Mon, 8–9 PM, from Nov 9',
    );
    expect(formatEventWhen(start, end, { ...NY, recurrence: 'MONTHLY' })).toBe(
      'Monthly on the 9th, 8–9 PM, from Nov 9',
    );
  });

  it('writes a structured repeat rule as its pattern (#4488)', () => {
    const start = '2026-11-10T01:00:00Z';
    const end = '2026-11-10T02:00:00Z';
    expect(
      formatEventWhen(start, end, {
        ...NY,
        recurrence:
          'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;COUNT=10;TZID=America/New_York',
      }),
    ).toBe('Every Mon and Thu, 8–9 PM, from Nov 9');
    expect(
      formatEventWhen(start, end, {
        ...NY,
        recurrence:
          'FREQ=MONTHLY;INTERVAL=1;BYDAY=2MO;COUNT=4;TZID=America/New_York',
      }),
    ).toBe('Every month on the second Monday, 8–9 PM, from Nov 9');
  });

  it("names a structured rule's days as the recipient's calendar has them", () => {
    // Mon 10 PM in Los Angeles is Tue 1 AM in New York.
    expect(
      formatEventWhen('2026-11-10T06:00:00Z', '2026-11-10T07:00:00Z', {
        ...NY,
        recurrence:
          'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,TH;COUNT=10;TZID=America/Los_Angeles',
      }),
    ).toBe('Every Tue and Fri, 1–2 AM, from Nov 10');
  });

  it('keeps the pattern for a weekly event that runs past midnight', () => {
    expect(
      formatEventWhen('2026-11-14T03:00:00Z', '2026-11-14T07:00:00Z', {
        ...NY,
        recurrence: 'WEEKLY',
      }),
    ).toBe('Every Fri, 10 PM–2 AM, from Nov 13');
  });

  it('writes a start alone when the end is missing or not after it', () => {
    expect(formatEventWhen('2026-11-10T01:00:00Z', null, NY)).toBe(
      'Mon, Nov 9, 8 PM',
    );
    expect(
      formatEventWhen('2026-11-10T01:00:00Z', '2026-11-10T01:00:00Z', NY),
    ).toBe('Mon, Nov 9, 8 PM');
  });

  it('writes midnight and noon as a clock does', () => {
    expect(
      formatEventWhen('2026-11-10T05:00:00Z', '2026-11-10T17:00:00Z', NY),
    ).toBe('Tue, Nov 10, 12 AM–12 PM');
  });
});

describe('formatDueDate', () => {
  it('writes a calendar date as written, in no zone', () => {
    expect(formatDueDate('2026-11-14', NOW)).toBe('Sat, Nov 14');
    expect(formatDueDate('2027-03-01', NOW)).toBe('Mon, Mar 1, 2027');
  });

  it('passes an unreadable value through', () => {
    expect(formatDueDate('soon', NOW)).toBe('soon');
  });
});

describe('joinFacts', () => {
  it('drops empty facts', () => {
    expect(joinFacts('Required', null, '', undefined, false, 'The Lodge')).toBe(
      'Required · The Lodge',
    );
  });
});
