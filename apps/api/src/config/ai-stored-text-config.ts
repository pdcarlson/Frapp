import {
  parseAiTextKeyRing,
  type AiTextKeyRing,
} from '#domain/utils/ai-text-cipher';
import { envSetting } from './ai-config';

type Env = Record<string, unknown>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The keys that seal stored AI text (`spec/behavior/ai.md` § Stored AI
 * text): `AI_STORED_TEXT_KEY`, `<key id>:<base64 of 32 bytes>`, older keys
 * after it separated by commas. Null when unset, and then nothing is ever
 * stored: there is no plaintext fallback. Throws when it is set and wrong;
 * `validateAiStoredTextEnv` turns that into a boot failure.
 */
export function aiStoredTextKeyRing(
  env: Env = process.env,
): AiTextKeyRing | null {
  return parseAiTextKeyRing(envSetting(env, 'AI_STORED_TEXT_KEY'));
}

/**
 * The one chapter that may be offered the beta diagnostics window on Ask:
 * `AI_DIAGNOSTICS_CHAPTER_ID`. Unset, no chapter is offered it. The
 * president of that chapter still has to say yes; this only decides who is
 * asked.
 */
export function askDiagnosticsChapterId(env: Env = process.env): string | null {
  const id = envSetting(env, 'AI_DIAGNOSTICS_CHAPTER_ID');
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

/** Boot-time checks, called from `validateEnv`. Never echoes a value. */
export function validateAiStoredTextEnv(env: Env): string[] {
  const problems: string[] = [];
  try {
    aiStoredTextKeyRing(env);
  } catch (error) {
    problems.push(
      error instanceof Error ? error.message : 'AI_STORED_TEXT_KEY is invalid.',
    );
  }
  const chapter = envSetting(env, 'AI_DIAGNOSTICS_CHAPTER_ID');
  if (chapter && !UUID.test(chapter)) {
    problems.push('AI_DIAGNOSTICS_CHAPTER_ID must be a chapter id (a UUID).');
  }
  if (chapter && !envSetting(env, 'AI_STORED_TEXT_KEY')) {
    problems.push(
      'AI_DIAGNOSTICS_CHAPTER_ID needs AI_STORED_TEXT_KEY: stored AI text is always encrypted.',
    );
  }
  return problems;
}
