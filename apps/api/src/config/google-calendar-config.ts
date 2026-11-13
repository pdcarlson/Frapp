import {
  parseAiTextKeyRing,
  type AiTextKeyRing,
} from '#domain/utils/ai-text-cipher';
import { envSetting } from './ai-config';

type Env = Record<string, unknown>;

const TOKEN_KEY = 'GOOGLE_CALENDAR_TOKEN_KEY';
const CLIENT_ID = 'GOOGLE_CALENDAR_CLIENT_ID';
const CLIENT_SECRET = 'GOOGLE_CALENDAR_CLIENT_SECRET';

/**
 * The keys that seal members' Google refresh tokens (#3322, step 2):
 * `GOOGLE_CALENDAR_TOKEN_KEY`, the same `<key id>:<base64 of 32 bytes>`
 * format and AES-256-GCM cipher as `AI_STORED_TEXT_KEY`, older keys after it
 * separated by commas. A key can go only once no row is sealed with it, so
 * rotation means every member connects again; the spec says so. Null when
 * unset, and then Google Calendar is not offered. Throws when set and wrong.
 */
export function googleCalendarTokenKeyRing(
  env: Env = process.env,
): AiTextKeyRing | null {
  return parseAiTextKeyRing(envSetting(env, TOKEN_KEY), TOKEN_KEY);
}

/**
 * Boot-time checks, called from `validateEnv`. Never echoes a value. The
 * three settings go together: the client id and secret without the key would
 * offer a sign-in whose token could not be kept, and the key alone does
 * nothing, so any one set without the others is a boot failure rather than a
 * feature silently missing.
 */
export function validateGoogleCalendarEnv(env: Env): string[] {
  const problems: string[] = [];
  try {
    googleCalendarTokenKeyRing(env);
  } catch (error) {
    problems.push(
      error instanceof Error
        ? error.message
        : 'GOOGLE_CALENDAR_TOKEN_KEY is invalid.',
    );
  }
  const names = [CLIENT_ID, CLIENT_SECRET, TOKEN_KEY];
  const set = names.filter((name) => envSetting(env, name) !== null);
  if (set.length > 0 && set.length < names.length) {
    const missing = names.filter((name) => !set.includes(name));
    problems.push(
      `Google Calendar needs ${names.join(', ')} together; missing ${missing.join(', ')}.`,
    );
  }
  return problems;
}
