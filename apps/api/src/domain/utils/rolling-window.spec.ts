import { rollingWindowRoom, waitPhrase } from './rolling-window';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const now = new Date('2026-11-17T12:00:00.000Z');
const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);

describe('rollingWindowRoom', () => {
  it('fits when the window has room, and says how much', () => {
    expect(rollingWindowRoom([ago(1), ago(2)], 5, 3, now, DAY)).toEqual({
      remaining: 3,
      roomAt: null,
    });
  });

  it('ignores writes older than the window, in any order or form', () => {
    expect(
      rollingWindowRoom(
        [ago(30).toISOString(), ago(1), ago(25), 'not a time'],
        2,
        1,
        now,
        DAY,
      ),
    ).toEqual({ remaining: 1, roomAt: null });
  });

  it('names when enough of the oldest age out for the batch', () => {
    // 4 in the window, limit 5, 3 needed: the 2 oldest must go. The second
    // oldest, from 10 hours ago, leaves 14 hours from now.
    const room = rollingWindowRoom(
      [ago(1), ago(20), ago(10), ago(2)],
      5,
      3,
      now,
      DAY,
    );
    expect(room.remaining).toBe(1);
    expect(room.roomAt).toEqual(new Date(now.getTime() + 14 * HOUR));
  });

  it('reads a batch bigger than the limit as room once everything ages out', () => {
    const room = rollingWindowRoom([ago(3)], 2, 5, now, DAY);
    expect(room.roomAt).toEqual(new Date(now.getTime() + 21 * HOUR));
  });
});

describe('waitPhrase', () => {
  const later = (ms: number) => new Date(now.getTime() + ms);

  it('rounds up, in minutes under an hour and hours above', () => {
    expect(waitPhrase(later(1), now)).toBe('about a minute');
    expect(waitPhrase(later(-5_000), now)).toBe('about a minute');
    expect(waitPhrase(later(19 * 60_000 + 1), now)).toBe('about 20 minutes');
    expect(waitPhrase(later(HOUR), now)).toBe('about an hour');
    expect(waitPhrase(later(HOUR + 1), now)).toBe('about 2 hours');
    expect(waitPhrase(later(23 * HOUR), now)).toBe('about 23 hours');
  });
});
