import {
  createSentryScrubber,
  NO_PSEUDONYMS,
  type ScrubbableEvent,
} from "./sentry-scrubbing";

/**
 * Client bindings pass {@link NO_PSEUDONYMS}: they hold no salt, so the
 * free-text sweep redacts identifiers rather than hashing them.
 */
export function createNoPseudonymScrubHooks(): {
  scrubError: <T>(event: T) => T | null;
  scrubTransaction: <T>(event: T) => T | null;
} {
  const scrubber = createSentryScrubber(NO_PSEUDONYMS);
  return {
    scrubError<T>(event: T): T | null {
      return scrubber.scrubSentryEvent(
        event as unknown as ScrubbableEvent,
      ) as T | null;
    },
    scrubTransaction<T>(event: T): T | null {
      return scrubber.scrubSentryTransaction(
        event as unknown as ScrubbableEvent,
      ) as T | null;
    },
  };
}
