"use client";

import { useCurrentChapter } from "@repo/hooks";
import { useChapterStore } from "@/lib/stores/chapter-store";
import {
  isSubscriptionStatus,
  subscriptionWriteState,
  type SubscriptionWriteClass,
  type SubscriptionWriteState,
} from "@/lib/subscription";

export type UseSubscriptionWriteStateResult = {
  /** What the server would do with a write to a route in this class. */
  state: SubscriptionWriteState;
  /**
   * The chapter record has not resolved yet, so `state` is a provisional
   * "allowed". Callers gating a control should disable it while this is true
   * and show a loading affordance — never the blocked explanation, which would
   * assert a reason that has not been established.
   */
  isPending: boolean;
};

/**
 * The subscription counterpart to `<Can>` — the missing third client gate from
 * `spec/ui/design-system/README.md` §5.
 *
 * ```tsx
 * const { state, isPending } = useSubscriptionWriteState();
 * <Button disabled={!state.allowed || isPending}>Create invoice</Button>
 * {!state.allowed ? <p>{state.reason}</p> : null}
 * ```
 *
 * Reads the active chapter rather than `GET /v1/billing/status`, because
 * `subscription_status` rides on the chapter payload every screen already
 * loads — so gating a control on a non-billing screen costs no extra request.
 *
 * **Fails open**, unlike `<Can>`, which fails closed. The two are asymmetric on
 * purpose: an unresolved permission means the user may never hold it, so
 * hiding is correct; an unresolved *subscription* most likely belongs to a
 * paying chapter, and disabling its whole paid surface over a slow or failed
 * fetch is a worse outcome than the late 403 this gate exists to avoid. The
 * server guard is the enforcement either way (§5 rule 5).
 */
export function useSubscriptionWriteState(
  writeClass: SubscriptionWriteClass = "paid",
): UseSubscriptionWriteStateResult {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data, isPending, isError } = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: Boolean(activeChapterId),
  });

  // `CurrentChapterPayloadSchema` is `.passthrough()`, so `past_due_since`
  // reaches the client but is not on the inferred type. Read it defensively —
  // a missing value is handled by the predicate's fail-open grace check.
  const raw = data as Record<string, unknown> | undefined;
  const status = raw?.["subscription_status"];
  const pastDueSince = raw?.["past_due_since"];

  if (!activeChapterId || isError || !isSubscriptionStatus(status)) {
    return { state: { allowed: true }, isPending: false };
  }

  return {
    state: subscriptionWriteState({
      status,
      pastDueSince: typeof pastDueSince === "string" ? pastDueSince : null,
      writeClass,
    }),
    isPending,
  };
}
