import * as Sentry from "@sentry/react-native";
import {
  isCancelledError,
  MutationCache,
  onlineManager,
  QueryCache,
} from "@tanstack/react-query";
import { createQueryErrorReporter } from "@repo/observability";

/**
 * Mobile's binding of the shared query-error reporter (#3377): the rules are
 * in `@repo/observability`'s `query-errors.ts`, and
 * `spec/behavior/observability.md` § Error Tracking owns them.
 *
 * Online is TanStack's `onlineManager`, which
 * `lib/connection/query-connectivity.ts` drives from the connection monitor.
 * The monitor reads offline once a link drop is confirmed by a failed
 * `/health` probe, and also after three failed probes with the link up, which
 * is what an API outage, or a build pointed at the wrong API, looks like from
 * the device. So:
 * - a fetch that fails before the monitor reads offline is reported as a
 *   `network` failure, once per root per interval. That covers the failures
 *   at launch, before the first probes have answered;
 * - once it reads offline, status-less failures are not reported until it
 *   reads online again, even when the device's link is up. The API's own
 *   uptime check is what reports an outage; this side sees only its start.
 */
export function createReportingCaches(): {
  queryCache: QueryCache;
  mutationCache: MutationCache;
} {
  const reporter = createQueryErrorReporter({
    capture: ({ error, level, fingerprint, tags }) => {
      Sentry.captureException(error, { level, fingerprint, tags });
    },
    isOnline: () => onlineManager.isOnline(),
    isCancelled: isCancelledError,
  });
  return {
    queryCache: new QueryCache({ onError: reporter.onQueryError }),
    mutationCache: new MutationCache({ onError: reporter.onMutationError }),
  };
}
