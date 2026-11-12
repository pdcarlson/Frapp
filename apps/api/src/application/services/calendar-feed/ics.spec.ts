import {
  buildIcsCalendar,
  escapeIcsText,
  foldIcsLine,
  icsDate,
  icsInstant,
} from './ics';

const NOW = new Date('2026-11-12T19:00:00.000Z');

describe('escapeIcsText', () => {
  it('escapes the TEXT specials', () => {
    expect(escapeIcsText('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
  });

  it('never leaves a raw carriage return, however the line ends', () => {
    // The #1591 defect: a CR inside a property value ends the line early.
    for (const text of ['one\r\ntwo', 'one\rtwo', 'one\ntwo']) {
      const escaped = escapeIcsText(text);
      expect(escaped).toBe('one\\ntwo');
      expect(escaped).not.toMatch(/[\r\n]/);
    }
  });
});

describe('icsInstant / icsDate', () => {
  it('writes UTC date-times and plain dates', () => {
    expect(icsInstant('2026-11-12T19:30:05.123Z')).toBe('20261112T193005Z');
    expect(icsInstant('2026-11-12T14:30:05-05:00')).toBe('20261112T193005Z');
    expect(icsDate('2026-11-12')).toBe('20261112');
  });

  it('refuses what is not a date', () => {
    expect(() => icsInstant('soon')).toThrow(RangeError);
    expect(() => icsDate('2026-11-12T00:00:00Z')).toThrow(RangeError);
  });
});

describe('foldIcsLine', () => {
  it('leaves a short line alone', () => {
    expect(foldIcsLine('SUMMARY:Chapter')).toBe('SUMMARY:Chapter');
  });

  it('folds at 75 octets, continuation lines led by one space', () => {
    const line = `DESCRIPTION:${'x'.repeat(200)}`;
    const folded = foldIcsLine(line);
    const parts = folded.split('\r\n');
    expect(parts[0]).toHaveLength(75);
    for (const part of parts.slice(1)) {
      expect(part.startsWith(' ')).toBe(true);
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
    }
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });

  it('never splits a multi-byte character', () => {
    const line = `SUMMARY:${'é'.repeat(60)}`;
    const parts = foldIcsLine(line).split('\r\n');
    for (const part of parts) {
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
      expect(part).not.toContain('�');
    }
    expect(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });
});

describe('buildIcsCalendar', () => {
  const ics = buildIcsCalendar({
    name: 'Phi Gamma Delta (Frapp)',
    now: NOW,
    items: [
      {
        uid: 'event-1@frapp.live',
        when: {
          kind: 'instant',
          start: '2026-11-14T00:00:00.000Z',
          end: '2026-11-14T01:00:00.000Z',
        },
        summary: 'Chapter meeting',
        location: 'House, upstairs',
        description: 'Open in Frapp: https://app.frapp.live/events?event=1',
        url: 'https://app.frapp.live/events?event=1',
      },
      {
        uid: 'task-2@frapp.live',
        when: { kind: 'day', date: '2026-11-30' },
        summary: 'Due: Clean the kitchen',
        location: null,
        description: null,
        url: 'https://app.frapp.live/tasks',
      },
    ],
  });
  const lines = ics.split('\r\n');

  it('is CRLF throughout and ends with one', () => {
    expect(ics.endsWith('\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });

  it('names the calendar and asks for hourly checks', () => {
    expect(lines.slice(0, 2)).toEqual(['BEGIN:VCALENDAR', 'VERSION:2.0']);
    expect(lines).toContain('X-WR-CALNAME:Phi Gamma Delta (Frapp)');
    expect(lines).toContain('NAME:Phi Gamma Delta (Frapp)');
    expect(lines).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
    expect(lines).toContain('X-PUBLISHED-TTL:PT1H');
    expect(lines.at(-2)).toBe('END:VCALENDAR');
  });

  it('writes a timed event with DTSTAMP, place and link', () => {
    expect(lines).toEqual(
      expect.arrayContaining([
        'UID:event-1@frapp.live',
        'DTSTAMP:20261112T190000Z',
        'DTSTART:20261114T000000Z',
        'DTEND:20261114T010000Z',
        'SUMMARY:Chapter meeting',
        'LOCATION:House\\, upstairs',
        'URL:https://app.frapp.live/events?event=1',
      ]),
    );
  });

  it('writes a dated task as a free all-day item ending the next day', () => {
    expect(lines).toEqual(
      expect.arrayContaining([
        'UID:task-2@frapp.live',
        'DTSTART;VALUE=DATE:20261130',
        'DTEND;VALUE=DATE:20261201',
        'TRANSP:TRANSPARENT',
        'SUMMARY:Due: Clean the kitchen',
      ]),
    );
    expect(lines.filter((l) => l.startsWith('DTSTAMP:'))).toHaveLength(2);
  });

  it('rolls an all-day end over a month and a year', () => {
    const out = buildIcsCalendar({
      name: 'x',
      now: NOW,
      items: [
        {
          uid: 'u',
          when: { kind: 'day', date: '2026-12-31' },
          summary: 's',
          location: null,
          description: null,
          url: 'https://app.frapp.live/tasks',
        },
      ],
    });
    expect(out).toContain('DTEND;VALUE=DATE:20270101');
  });
});
