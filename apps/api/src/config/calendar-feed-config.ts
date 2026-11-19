import type { AiTextKeyRing } from '#domain/utils/ai-text-cipher';
import { keyRingProblems, keyRingSetting } from './key-ring-config';

type Env = Record<string, unknown>;

const TOKEN_KEY = 'CALENDAR_FEED_TOKEN_KEY';

/**
 * The keys that seal calendar subscription links' tokens at rest
 * (`spec/behavior/events.md` § Calendar subscription):
 * `CALENDAR_FEED_TOKEN_KEY`, the same `<key id>:<base64 of 32 bytes>` format
 * and AES-256-GCM cipher as `AI_STORED_TEXT_KEY`, older keys after it
 * separated by commas. The first key seals; every key opens. A sealed link
 * never ages out, so a key can go only once no link is sealed with it: drop
 * it and the links it sealed are reissued the next time their member opens
 * the menu, which empties the calendars subscribed to the old ones.
 *
 * Null when unset. Links already handed out keep working (a fetch looks a
 * link up by its hash), a link from before sealing can still be shown, and
 * Reset still cuts a link off, but no new link can be made or a sealed one
 * shown: those answer 503. Throws when set and wrong.
 */
export function calendarFeedTokenKeyRing(
  env: Env = process.env,
): AiTextKeyRing | null {
  return keyRingSetting(env, TOKEN_KEY);
}

/** Boot-time check, called from `validateEnv`. Never echoes a value. */
export function validateCalendarFeedEnv(env: Env): string[] {
  return keyRingProblems(env, TOKEN_KEY);
}
