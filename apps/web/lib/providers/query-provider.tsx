"use client";

import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isRetryableFailure } from "@repo/api-sdk";

/** How many times a failed mutation is retried, when it is worth retrying. */
const MUTATION_RETRIES = 2;

/**
 * The default mutation retry: up to {@link MUTATION_RETRIES} more attempts,
 * never for a definitive client refusal (#3100). A 400, 403, 404, 409 or the
 * throttler's 429 is answered the same way every time, so retrying it only
 * re-sends a write the throttler counts and delays the error toast by the
 * backoff. `spec/ui/resilience/api-retry.md` § Retry configuration.
 *
 * A non-idempotent write that a lost response would turn into a refused retry
 * (a compare-and-set) still sets `retry: false` itself (`docs/hooks/README.md`).
 */
export function retryMutation(failureCount: number, error: unknown): boolean {
  return failureCount < MUTATION_RETRIES && isRetryableFailure(error);
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 10 * 60_000,
        retry: 3,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
        refetchOnWindowFocus: true,
        refetchOnReconnect: "always",
      },
      mutations: {
        retry: retryMutation,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
        /*
         * Dashboard writes must FAIL offline, never hang (#1707).
         *
         * TanStack's default `networkMode: "online"` *pauses* an offline
         * mutation instead of rejecting it, so `await mutateAsync(...)` neither
         * resolves nor throws: the `try` never continues (no success toast, the
         * dialog never closes), the `catch` never runs (the error toast every
         * caller already wrote is unreachable), and `isPending` latches `true`
         * — which `tasks-board`'s `lifecycleWritePending` fans out into every
         * row's controls disabling chapter-wide with no explanation.
         *
         * `"offlineFirst"` does NOT fix this, despite reading like it should.
         * Starting and resuming are two different predicates in
         * `query-core/src/retryer.ts`:
         *
         *   canStart    = canFetch(networkMode) && canRun()
         *                 // canFetch: mode === 'online' ? isOnline() : true
         *   canContinue = isFocused() &&
         *                 (networkMode === 'always' || isOnline()) && canRun()
         *
         * `offlineFirst` passes `canStart`, so attempt 1 fires — but it fails
         * `canContinue`, so with a retry configured the first offline failure
         * hits `pause()` and the promise still never settles, turning "hangs
         * before trying" into the harder-to-diagnose "hangs after trying once".
         *
         * `"always"` lets the attempt start AND clears the second conjunct of
         * `canContinue`, so the retries (two, for a failure with no status)
         * run to exhaustion and the promise rejects in ~3s instead of parking. `retry` is deliberately
         * left alone: refusing offline retries outright would reject on the
         * first failure, which sounds tidier but throws away the case where the
         * link returns mid-backoff — an AP roam or a lift lasting under 3s
         * currently lands the write invisibly, and should keep doing so. It
         * would also falsify the retries `packages/hooks` and
         * `docs/hooks/README.md` cite as the reason a non-idempotent
         * compare-and-set write must opt out.
         *
         * KNOWN RESIDUAL, pre-existing and not introduced here: `isFocused()`
         * is `document.visibilityState !== 'hidden'`, so a tab hidden during a
         * backoff pauses until it is focused again — for online failures too,
         * exactly as before this change. It self-heals on refocus and cannot be
         * observed while it is happening, so it is not the #1707 symptom (a
         * member watching a dialog spin). Closing it would cost the blip
         * absorption above, which is a bad trade.
         *
         * The cost that IS taken deliberately: a write fired while already
         * offline used to pause indefinitely and resume on reconnect; it now
         * rejects after its retries. § 2 says dashboard writes are *disabled*
         * offline where no queue exists, so that resume was an accidental queue
         * with no UI — and it is the mechanism behind the worst symptom here,
         * an optimistic `onMutate` rendering a task card "confirmed" against a
         * write that never happened and never rolls back.
         *
         * This is only the "never settles" half of #1707. The other half —
         * disabling queueless writes up front with `title="Reconnect to make
         * changes."` — is `useSubscriptionGate` (#1753). An offline member
         * on a gated surface now gets a control that refuses to be pressed;
         * `networkMode: "always"` remains the backstop for anything that
         * still fires (a missed call site, or a write that is not behind
         * the gate).
         *
         * The chat composer is unaffected — `chat-client.ts` enqueues to a real
         * Dexie outbox and returns before touching the network (it is not a
         * TanStack mutation at all), per § 2's "labeled, never blocked,
         * wherever an outbox exists" carve-out.
         */
        networkMode: "always",
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    return makeQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(getQueryClient);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
