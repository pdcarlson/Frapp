import { statusOf } from './api-error';

/**
 * The second line of a screen's "Couldn't load …" state, chosen by what
 * actually failed (`spec/ui/design-system/writing.md` § copy rules).
 *
 * One fixed line used to cover every failure, and whichever cause it named
 * was wrong for the others: "Confirm your chapter access" sent a member on a
 * dropped connection to their officers, and "Check your connection" sent a
 * member without the permission to their Wi-Fi. Web and mobile both read it
 * from here so the two clients say the same thing for the same failure.
 *
 * A 401 normally never reaches a screen: the client signs a refused session
 * out (`onUnauthorized`). It is still answered here in case Auth disagreed.
 */
export const LOAD_FAILURE_COPY = {
  offline: 'Check your connection and retry.',
  forbidden:
    "Your role doesn't have access to this. A chapter officer can change that.",
  signedOut: 'Your session ended. Sign in again to continue.',
  server: 'Something went wrong on our side. Retry in a moment.',
} as const;

export function describeLoadFailure(error: unknown): string {
  const status = statusOf(error);
  if (status === undefined) return LOAD_FAILURE_COPY.offline;
  if (status === 401) return LOAD_FAILURE_COPY.signedOut;
  if (status === 403) return LOAD_FAILURE_COPY.forbidden;
  return LOAD_FAILURE_COPY.server;
}
