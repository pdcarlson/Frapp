import {
  parseAiTextKeyRing,
  type AiTextKeyRing,
} from '#domain/utils/ai-text-cipher';
import { envSetting } from './ai-config';

type Env = Record<string, unknown>;

const TOKEN_KEY = 'CALENDAR_FEED_TOKEN_KEY';

/**
 * The keys that seal calendar subscription links' tokens at rest
 * (`spec/behavior/events.md` § Calendar subscription):
 * `CALENDAR_FEED_TOKEN_KEY`, the same `<key id>:<base64 of 32 bytes>` format
 * and AES-256-GCM cipher as `AI_STORED_TEXT_KEY`, older keys after it
 * separated by commas. The first key seals; every key opens. Null when unset:
 * links already handed out keep working (a fetch looks a link up by its hash),
 * but none can be shown or made, so the Subscribe menu says links aren't set
 * up. Throws when set and wrong.
 */
export function calendarFeedTokenKeyRing(
  env: Env = process.env,
): AiTextKeyRing | null {
  return parseAiTextKeyRing(envSetting(env, TOKEN_KEY), TOKEN_KEY);
}

/** Boot-time check, called from `validateEnv`. Never echoes a value. */
export function validateCalendarFeedEnv(env: Env): string[] {
  try {
    calendarFeedTokenKeyRing(env);
    return [];
  } catch (error) {
    return [
      error instanceof Error
        ? error.message
        : 'CALENDAR_FEED_TOKEN_KEY is invalid.',
    ];
  }
}
