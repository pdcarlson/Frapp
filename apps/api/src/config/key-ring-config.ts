import {
  parseAiTextKeyRing,
  type AiTextKeyRing,
} from '#domain/utils/ai-text-cipher';
import { envSetting } from './ai-config';

type Env = Record<string, unknown>;

/**
 * A key ring setting (`AI_STORED_TEXT_KEY`, `GOOGLE_CALENDAR_TOKEN_KEY`,
 * `CALENDAR_FEED_TOKEN_KEY`): `<key id>:<base64 of 32 bytes>`, older keys
 * after it separated by commas, for the `ai-text-cipher.ts` cipher. Null when
 * unset; throws, naming the setting and never the value, when set and wrong.
 */
export function keyRingSetting(env: Env, name: string): AiTextKeyRing | null {
  return parseAiTextKeyRing(envSetting(env, name), name);
}

/** The boot failure a malformed key ring setting makes, if any. */
export function keyRingProblems(env: Env, name: string): string[] {
  try {
    keyRingSetting(env, name);
    return [];
  } catch (error) {
    return [
      error instanceof Error ? error.message : 'A key ring setting is invalid.',
    ];
  }
}
