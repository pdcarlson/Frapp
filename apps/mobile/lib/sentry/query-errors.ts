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
 * `lib/connection/query-connectivity.ts` drives from the connection monitor:
 * offline once a link drop is confirmed by a failed `/health` probe. A fetch
 * that fails in the seconds before that confirmation reads online, and is
 * reported as a `network` failure, at most once per root per interval.
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
