import { randomBytes } from 'node:crypto';
import { validateGoogleCalendarEnv } from './google-calendar-config';

const KEY = `k1:${randomBytes(32).toString('base64')}`;

describe('validateGoogleCalendarEnv', () => {
  it('accepts none of the settings, and all three', () => {
    expect(validateGoogleCalendarEnv({})).toEqual([]);
    expect(
      validateGoogleCalendarEnv({
        GOOGLE_CALENDAR_CLIENT_ID: 'id',
        GOOGLE_CALENDAR_CLIENT_SECRET: 'secret',
        GOOGLE_CALENDAR_TOKEN_KEY: KEY,
      }),
    ).toEqual([]);
  });

  it('refuses some without the others, naming what is missing', () => {
    expect(
      validateGoogleCalendarEnv({
        GOOGLE_CALENDAR_CLIENT_ID: 'id',
        GOOGLE_CALENDAR_CLIENT_SECRET: 'secret',
      }),
    ).toEqual([
      'Google Calendar needs GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_TOKEN_KEY together; missing GOOGLE_CALENDAR_TOKEN_KEY.',
    ]);
  });

  it('names a malformed key by its own setting, never echoing it', () => {
    const problems = validateGoogleCalendarEnv({
      GOOGLE_CALENDAR_CLIENT_ID: 'id',
      GOOGLE_CALENDAR_CLIENT_SECRET: 'secret',
      GOOGLE_CALENDAR_TOKEN_KEY: 'k1:dG9vLXNob3J0',
    });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /^GOOGLE_CALENDAR_TOKEN_KEY: key "k1" must be 32 bytes/,
    );
    expect(problems[0]).not.toContain('dG9vLXNob3J0');
  });
});
