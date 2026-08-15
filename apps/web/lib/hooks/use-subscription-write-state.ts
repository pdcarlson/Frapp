"use client";

import { useCurrentChapter } from "@repo/hooks";
import { useChapterStore } from "@/lib/stores/chapter-store";
import {
  isSubscriptionStatus,
  subscriptionWriteState,
  type SubscriptionStatus,
  type SubscriptionWriteClass,
  type SubscriptionWriteState,
} from "@/lib/subscription";

export type ChapterSubscription = {
  /**
   * `null` means "not established" — still loading, the fetch failed, no active
   * chapter, or a status this client does not model. Callers must never render
   * a blocked explanation from `null`; it asserts a reason nothing proved.
   */
  status: SubscriptionStatus | null;
  pastDueSince: string | null;
  isPending: boolean;
  isError: boolean;
};

/**
 * Single reader for the active chapter's subscription state.
 *
 * Everything subscription-related on the client goes through here so there is
 * exactly one cache behind it. An earlier revision had the checkout card read
 * `GET /v1/billing/status` while the gate read the chapter payload, which is
 * how the card and the control beneath it ended up able to disagree about
 * whether the same chapter was active.
 */
export function useChapterSubscription(): ChapterSubscription {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { data, isPending, isError } = useCurrentChapter({
    chapterId: activeChapterId,
    enabled: Boolean(activeChapterId),
  });

  // Read defensively: `useCurrentChapter` returns the raw SDK response with no
  // schema applied, and neither field is on the inferred type. `past_due_since`
  // reaches the client only because `SupabaseChapterRepository.findById` does
  // `select('*')` and the service spreads the whole row — narrowing that
  // projection (as `ChapterGuard` already does) would silently drop it, which
  // the predicate's fail-open grace check absorbs rather than reports.
  const raw = data as Record<string, unknown> | undefined;
  const rawStatus = raw?.["subscription_status"];
  const rawPastDue = raw?.["past_due_since"];

  return {
    status: isSubscriptionStatus(rawStatus) ? rawStatus : null,
    pastDueSince: typeof rawPastDue === "string" ? rawPastDue : null,
    isPending: Boolean(activeChapterId) && isPending,
    isError,
  };
}

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
  const { status, pastDueSince, isPending } = useChapterSubscription();

  // `isPending` is reported alongside the provisional verdict rather than
  // folded into it. Collapsing the two is what made an earlier revision's
  // loading contract unreachable: the in-flight case *is* the case where the
  // status has not resolved, so returning a hardcoded `false` there meant no
  // caller could ever see `isPending: true` and the gate stayed open through
  // the whole fetch — the exact late rejection this hook exists to prevent.
  if (status === null) {
    return { state: { allowed: true }, isPending };
  }

  return {
    state: subscriptionWriteState({ status, pastDueSince, writeClass }),
    isPending,
  };
}
