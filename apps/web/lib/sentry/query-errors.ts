import * as Sentry from "@sentry/nextjs";
import {
  isCancelledError,
  MutationCache,
  onlineManager,
  QueryCache,
} from "@tanstack/react-query";
import { createQueryErrorReporter } from "@repo/observability";

/**
 * Web's binding of the shared query-error reporter (#3377): the rules are in
 * `@repo/observability`'s `query-errors.ts`, and
 * `spec/behavior/observability.md` § Error Tracking owns them.
 *
 * Online means both readings agree. TanStack's `onlineManager` starts online
 * and moves only on the window's `online`/`offline` events, so a page that
 * mounted offline reads online to it; `navigator.onLine` covers that case.
 * `NetworkProvider`'s `/health` view can't be read here: `QueryProvider` sits
 * outside it. On the server there is no `navigator`, and a server render has
 * a network.
 */
export function isWebOnline(): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return false;
  }
  return onlineManager.isOnline();
}

/**
 * A `QueryCache` and `MutationCache` that report final failures to Sentry.
 * Each call builds its own reporter, so each `QueryClient` rate-limits on its
 * own.
 */
export function createReportingCaches(): {
  queryCache: QueryCache;
  mutationCache: MutationCache;
} {
  const reporter = createQueryErrorReporter({
    capture: ({ error, level, fingerprint, tags }) => {
      Sentry.captureException(error, { level, fingerprint, tags });
    },
    isOnline: isWebOnline,
    isCancelled: isCancelledError,
  });
  return {
    queryCache: new QueryCache({ onError: reporter.onQueryError }),
    mutationCache: new MutationCache({ onError: reporter.onMutationError }),
  };
}
