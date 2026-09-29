import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * `useChapterSubscription` reads the contract-typed chapter payload, so the
 * type checker sees `isSubscriptionStatus` as redundant. It is not: a client
 * older than the API can receive a status it does not model, and that has to
 * read as "not established" rather than reach the write-gate predicates.
 */

const useCurrentChapter = vi.fn();
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: (args: unknown) => useCurrentChapter(args),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { activeChapterId: string | null }) => unknown,
  ) => selector({ activeChapterId: "chapter-1" }),
}));

const { useChapterSubscription } = await import(
  "./use-subscription-write-state"
);

function subscriptionFor(data: unknown) {
  useCurrentChapter.mockReturnValue({ data, isPending: false, isError: false });
  return renderHook(() => useChapterSubscription()).result.current;
}

describe("useChapterSubscription", () => {
  it("reads a modelled status and the past-due timestamp", () => {
    const sub = subscriptionFor({
      subscription_status: "past_due",
      past_due_since: "2026-09-01T00:00:00.000Z",
    });
    expect(sub.status).toBe("past_due");
    expect(sub.pastDueSince).toBe("2026-09-01T00:00:00.000Z");
  });

  it("reads a status the client does not model as null (deploy skew)", () => {
    const sub = subscriptionFor({
      subscription_status: "paused",
      past_due_since: null,
    });
    expect(sub.status).toBeNull();
  });

  it("reads a missing payload as not established", () => {
    const sub = subscriptionFor(undefined);
    expect(sub.status).toBeNull();
    expect(sub.pastDueSince).toBeNull();
  });
});
