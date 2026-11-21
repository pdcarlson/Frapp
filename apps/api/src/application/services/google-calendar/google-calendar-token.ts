import {
  openAiText,
  sealAiText,
  type AiTextKeyRing,
} from '#domain/utils/ai-text-cipher';

/**
 * Members' Google refresh tokens at rest (#3322, step 2): sealed with
 * `GOOGLE_CALENDAR_TOKEN_KEY` by the same AES-256-GCM envelope stored AI text
 * uses. The context binds a sealed token to its chapter and member, so a row's
 * token copied onto another member's row does not open.
 */
function context(chapterId: string, userId: string): string {
  return `google-calendar:${chapterId}:${userId}`;
}

export function sealRefreshToken(
  ring: AiTextKeyRing | null,
  token: string,
  chapterId: string,
  userId: string,
): string {
  return sealAiText(ring, token, context(chapterId, userId));
}

export function openRefreshToken(
  ring: AiTextKeyRing | null,
  sealed: string,
  chapterId: string,
  userId: string,
): string {
  return openAiText(ring, sealed, context(chapterId, userId));
}
