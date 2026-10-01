import {
  createSentryScrubber,
  NO_PSEUDONYMS,
  type ScrubbableEvent,
} from "./sentry-scrubbing";

/**
 * Client bindings pass {@link NO_PSEUDONYMS}: they hold no salt, so the
 * free-text sweep redacts identifiers rather than hashing them.
 *
 * `scrubRecordedBreadcrumb` is mobile's `beforeBreadcrumb` (#3104). It keeps
 * the little `data` the SDK reads back after that hook, so it is not the
 * send-time breadcrumb rule, which drops all of it. The browser bindings have
 * no native scope to protect and leave it unwired.
 */
export function createNoPseudonymScrubHooks(): {
  scrubError: <T>(event: T) => T | null;
  scrubTransaction: <T>(event: T) => T | null;
  scrubEnvelope: (envelope: unknown) => void;
  scrubRecordedBreadcrumb: <T>(breadcrumb: T) => T | null;
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
    scrubEnvelope: scrubber.scrubSentryEnvelope,
    scrubRecordedBreadcrumb<T>(breadcrumb: T): T | null {
      return scrubber.scrubRecordedBreadcrumb(breadcrumb) as T | null;
    },
  };
}
