import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `GET /v1/service-entries` is not scoped by the endpoint alone.
 * `service-entry.controller.ts` resolves `userId: isAdmin ? query.userId :
 * userId`, so omitting the query param pins a non-admin to their own history
 * but hands anyone holding `service:approve` **every entry in the chapter**.
 *
 * Both mobile screens that read it present the result as the viewer's own —
 * "Philanthropy work you've logged", an "Approved" total, a profile card
 * reading "service hrs" — so both must pass the viewer's id. They did not,
 * and an officer saw the chapter's entries in rows that carry no member name
 * and the chapter's minutes totalled as their own.
 *
 * The web approval queue (`apps/web/components/service/service-page.tsx`) is
 * the one deliberate unscoped caller, because it exists to show every entry.
 * Note what that does NOT mean: the route itself carries no permission gate —
 * `permission="service:approve"` wraps only the approve and reject controls, so
 * any `members:view` holder can open the page. That is why its own
 * personally-framed card ("Your pending entries", with a Withdraw that deletes)
 * filters by the viewer even though the read behind it is unscoped. So this is
 * a per-call-site rule, not something the hook can default, which is why it is
 * pinned here rather than fixed by making `userId` required.
 *
 * Shape follows `lib/observability/wiring.spec.ts`: read the source and assert
 * the wiring, because the defect was a missing argument at a call site and no
 * selector or component test can see it.
 */
// Resolved from this file rather than `process.cwd()`. The sibling
// `lib/observability/wiring.spec.ts` uses cwd, which is `apps/mobile` under
// `npm run test -w apps/mobile` and so works in CI — but it makes the spec
// throw an unhelpful ENOENT instead of failing an assertion when vitest is
// pointed at the repo root, and one of the paths below deliberately leaves the
// workspace.
const MOBILE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

function source(relative: string): string {
  return readFileSync(join(MOBILE_ROOT, relative), "utf8");
}

const VIEWER_SCOPED_SCREENS = [
  "app/(tabs)/service-hours.tsx",
  "app/(tabs)/profile.tsx",
] as const;

describe("service entries are read scoped to the viewer", () => {
  for (const screen of VIEWER_SCOPED_SCREENS) {
    it(`${screen} passes the viewer id and waits for it`, () => {
      const text = source(screen);

      expect(text).toContain("useViewerUserId");

      // Both halves asserted inside ONE call expression. Matching them
      // separately was a hole: `useServiceEntries(viewerUserId ?? undefined)`
      // beside an unrelated `useMyPoints({ enabled: !!viewerUserId })` passed
      // two independent regexes while the request went out unscoped on the
      // first render. `[^)]*` cannot cross the closing paren, so the `enabled`
      // has to belong to this call.
      expect(text).toMatch(
        /useServiceEntries\(\s*viewerUserId[^;]*?enabled:\s*!!viewerUserId/s,
      );

      // The bare call is the bug. Guard the exact shape it had.
      expect(text).not.toMatch(/useServiceEntries\(\s*\)/);
    });
  }

  it("keeps the officer queue on web unscoped, but its personal card filtered", () => {
    // Asserted from mobile so the rule stays stated in one place: if someone
    // ever moves the approval queue onto the phone, this is the line that has
    // to be revisited rather than quietly widened.
    const webQueue = source("../../apps/web/components/service/service-page.tsx");

    // The queue read is deliberately unscoped — that is the whole point of an
    // approval queue.
    expect(webQueue).toContain("useServiceEntries()");
    expect(webQueue).toContain('permission="service:approve"');

    // But the "Your pending entries" card on that same page is personal and its
    // Withdraw deletes, and `DELETE /v1/service-entries/:id` accepts
    // `service:approve` — so an unfiltered card let an approver delete another
    // member's pending entry and its proof. The filter is the guard.
    expect(webQueue).toMatch(/e\.user_id === viewerUserId/);
  });
});
