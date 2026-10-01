/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { expectViewerScopedReads } from "@/test/service-entry-reads";

/**
 * s12's service-hours total reads `GET /v1/service-entries`, which the
 * endpoint does not scope by itself: `service-entry.controller.ts` resolves
 * `userId: isAdmin ? query.userId : userId`, so a read with no `userId` hands
 * anyone holding `service:approve` every entry in the chapter. The card
 * presents the total as the viewer's own, so the screen must ask for the
 * viewer's entries, and must wait for the viewer's id rather than firing
 * once unscoped. `service-hours-screen.spec.tsx` pins the same for s20.
 *
 * It renders `app/(tabs)/profile.tsx` but lives here: a spec under `app/`
 * ships as a route module (`lib/routes.spec.ts`).
 */

let viewerUserId: string | null = "user-1";
const useServiceEntries = vi.fn<(...args: unknown[]) => unknown>(() => ({
  data: [],
  isPending: false,
  isError: false,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => "chapter-1",
  useCurrentUser: () => ({
    isPending: false,
    isError: false,
    data: { id: "user-1", email: "member@example.test", display_name: "Alex" },
  }),
  useViewerUserId: () => viewerUserId,
  useMyPoints: () => ({ data: undefined, isPending: true, isError: false }),
  useServiceEntries: (...args: unknown[]) => useServiceEntries(...args),
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ email: "member@example.test" }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

// Picking and uploading a photo is `profile-photo`'s own spec's business.
vi.mock("@/components/profile/profile-photo", () => ({
  ProfilePhoto: "ProfilePhoto",
}));

import ProfileScreen from "@/app/(tabs)/profile";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ProfileScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

describe("Profile reads only the viewer's service entries", () => {
  beforeEach(() => {
    useServiceEntries.mockClear();
  });

  it("asks for the viewer's entries once the viewer is known", () => {
    viewerUserId = "user-1";
    const tree = render();
    expectViewerScopedReads(useServiceEntries.mock.calls, "user-1");
    act(() => tree.unmount());
  });

  it("sends nothing while the viewer is still unknown", () => {
    viewerUserId = null;
    const tree = render();
    expectViewerScopedReads(useServiceEntries.mock.calls, null);
    act(() => tree.unmount());
  });
});
