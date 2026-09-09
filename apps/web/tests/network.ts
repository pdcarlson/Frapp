/**
 * The `useNetwork` mock, in one place.
 *
 * Five test files hand-rolled the same hoisted `{ value: false }` box plus the
 * same `vi.mock("@/lib/providers/network-provider", ...)`, which is the shape
 * `tests/chapter-subscription.ts` already centralises for the analogous
 * subscription mock. A change to `useNetwork`'s return shape would otherwise
 * have to be found and re-verified in each of them.
 *
 * Usage — the box must be created with `vi.hoisted` in the test file, because
 * `vi.mock` is hoisted above imports and can only close over hoisted values:
 *
 * ```ts
 * const { mockOffline } = vi.hoisted(() => ({ mockOffline: { value: false } }));
 * vi.mock("@/lib/providers/network-provider", () => networkMock(mockOffline));
 * ```
 *
 * Then set `mockOffline.value` per test, and reset it in `beforeEach` — an
 * offline flag left set leaks into every later test in the file.
 *
 * `degraded` is optional and ignored while `value` is true (OFFLINE wins).
 * Set it to model DEGRADED, which must keep queueless writes enabled
 * (`spec/ui/resilience.md` § 2).
 *
 * `linkOnline` defaults to the inverse of OFFLINE. Override it when modelling
 * an API-down OFFLINE with the browser link still up (presence must stay on).
 */
export type OfflineBox = {
  value: boolean;
  degraded?: boolean;
  linkOnline?: boolean;
};

export function networkMock(box: OfflineBox) {
  return {
    useNetwork: () => {
      const isOffline = box.value;
      const isDegraded = !isOffline && Boolean(box.degraded);
      const state = isOffline
        ? ("OFFLINE" as const)
        : isDegraded
          ? ("DEGRADED" as const)
          : ("ONLINE" as const);
      return {
        state,
        isOnline: state === "ONLINE",
        isDegraded,
        isOffline,
        linkOnline: box.linkOnline ?? !isOffline,
        probeOnce: async () => {},
      };
    },
  };
}
