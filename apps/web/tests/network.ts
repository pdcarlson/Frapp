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
 */
export type OfflineBox = { value: boolean };

export function networkMock(box: OfflineBox) {
  return {
    useNetwork: () => ({
      state: box.value ? ("OFFLINE" as const) : ("ONLINE" as const),
      isOnline: !box.value,
      isDegraded: false,
      isOffline: box.value,
    }),
  };
}
