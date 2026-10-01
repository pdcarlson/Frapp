import { expect } from "vitest";

/**
 * The rule every mobile read of `GET /v1/service-entries` follows, checked
 * against the calls a rendered screen made to a mocked `useServiceEntries`.
 *
 * The endpoint does not scope a read by itself: omitting `userId` pins a
 * member to their own history but hands anyone holding `service:approve`
 * every entry in the chapter. Every mobile screen that reads it presents the
 * result as the viewer's own, so each call asks for the viewer's id, and
 * until that id is known it sends nothing. `enabled` left out defaults to on,
 * which is exactly the unscoped read.
 *
 * Shared by `lib/more/service-hours-screen.spec.tsx` and
 * `lib/more/profile-screen.spec.tsx`, so the rule is stated once. Web's
 * approval queue is the one deliberate unscoped caller
 * (`apps/web/components/service/service-page.spec.tsx`).
 */
export function expectViewerScopedReads(
  calls: readonly (readonly unknown[])[],
  viewerId: string | null,
) {
  expect(calls.length).toBeGreaterThan(0);
  for (const [userId, , options] of calls) {
    const enabled = (options as { enabled?: boolean } | undefined)?.enabled;
    if (viewerId === null) {
      expect(enabled).toBe(false);
    } else {
      expect(userId).toBe(viewerId);
      expect(enabled).not.toBe(false);
    }
  }
}
