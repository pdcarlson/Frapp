import type { Mock } from "vitest";

/**
 * Shared controls for the `useCurrentChapter` stub that every subscription-gating
 * test drives (#841).
 *
 * `vi.mock` and `vi.hoisted` are per-file and cannot be shared, so each test file
 * still declares its own mock. What is shared is the *shape* of the chapter
 * payload — which is the part that was drifting: `invoice-admin-card.spec.tsx`
 * and `subscription-checkout-card.spec.tsx` each grew their own incompatible
 * version, and eleven more copies would guarantee that some surface is tested
 * against a payload the wire never sends.
 *
 * Nothing here stubs `useSubscriptionWriteState` or `subscriptionWriteState` —
 * those run for real, so a test covers the whole path from wire format to
 * disabled control rather than asserting against a hand-written verdict.
 *
 * ```ts
 * const { mockCurrentChapter } = vi.hoisted(() => ({ mockCurrentChapter: vi.fn() }));
 * vi.mock("@repo/hooks", () => ({ useCurrentChapter: () => mockCurrentChapter() }));
 * const chapter = chapterSubscription(mockCurrentChapter);
 * chapter.incomplete();
 * ```
 */
export type ChapterSubscriptionControls = {
  /** Paying chapter — every write class allowed. */
  active: () => void;
  /** Freshly onboarded, checkout not completed — the #841 repro state. */
  incomplete: () => void;
  /**
   * Lapsed. Defaults to *inside* the 3-day grace window, which is the case that
   * separates `paid` from `free-tier`: paid-ops locks immediately, free-tier
   * survives. Pass an ISO timestamp older than the window for the hard lock.
   */
  pastDue: (since?: string) => void;
  /** The one state the member cannot clear by paying. */
  canceled: () => void;
  /** Chapter query still in flight — the gate holds shut, provisionally. */
  loading: () => void;
  /** Chapter fetch failed — the gate must fail *open*, unlike `<Can>`. */
  unreadable: () => void;
  /** Escape hatch for a status this client does not model. */
  raw: (status: string, pastDueSince?: string | null) => void;
};

export function chapterSubscription(
  mockCurrentChapter: Mock,
): ChapterSubscriptionControls {
  const set = (status: string, pastDueSince: string | null = null) => {
    mockCurrentChapter.mockReturnValue({
      // `past_due_since` reaches the client only because the repository does
      // `select('*')` and the service spreads the whole row, so the fixture
      // sends it the same way rather than as a narrowed projection.
      data: { subscription_status: status, past_due_since: pastDueSince },
      isPending: false,
      isError: false,
    });
  };

  return {
    active: () => set("active"),
    incomplete: () => set("incomplete"),
    pastDue: (since = new Date().toISOString()) => set("past_due", since),
    canceled: () => set("canceled"),
    loading: () =>
      mockCurrentChapter.mockReturnValue({
        data: undefined,
        isPending: true,
        isError: false,
      }),
    unreadable: () =>
      mockCurrentChapter.mockReturnValue({
        data: undefined,
        isPending: false,
        isError: true,
      }),
    raw: set,
  };
}

/** An ISO timestamp older than `SUBSCRIPTION_GRACE_PERIOD_MS` (3 days). */
export function beyondGrace(): string {
  return new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
}
