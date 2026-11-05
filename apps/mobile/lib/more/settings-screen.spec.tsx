/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultNotificationCategoryState } from "@repo/validation";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { screenText } from "@/test/screen-text";

/**
 * s16 Settings, rendered. It renders `app/(tabs)/preferences.tsx` but lives
 * here: a spec under `app/` ships as a route module (`lib/routes.spec.ts`).
 *
 * Everything below the screen is stubbed at its own seam: the preference
 * sync hook has its own spec (`lib/use-notification-preferences-sync.spec.tsx`),
 * and the session, push permission and delete-account prompt each sit behind
 * a module whose native half doesn't exist under vitest.
 */

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useBlockedUserIds: () => ({ data: [], isPending: false, isError: false }),
  useCurrentChapter: () => ({
    data: undefined,
    isPending: true,
    isError: false,
  }),
  useDeleteAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGeofences: () => ({ data: [], isPending: false, isError: false }),
  usePermissionList: () => [],
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ signOut: vi.fn() }),
}));

vi.mock("@/lib/account/delete-account-prompt", () => ({
  confirmDeleteAccount: vi.fn(),
}));

vi.mock("@/lib/notifications/push", () => ({
  getPushPermission: vi.fn(() => new Promise(() => undefined)),
  pushUnavailableReason: () => null,
}));

vi.mock("@/lib/use-notification-preferences-sync", () => ({
  useNotificationPreferencesSync: () => ({
    quietHoursEnabled: false,
    setQuietHoursEnabled: vi.fn(),
    categories: defaultNotificationCategoryState(),
    setCategory: vi.fn(),
    quietHoursWindow: { start: "22:00", end: "07:00", tz: "America/New_York" },
    setQuietHoursWindow: vi.fn(),
    isHydrated: true,
    hydrationRecovered: false,
    persistenceFailed: false,
    isAuthenticated: true,
    chapterId: "chapter-1",
    quietHoursSync: "synced",
    categorySync: "synced",
  }),
}));

vi.mock("@/components/settings/blocked-members-sheet", () => ({
  BlockedMembersSheet: "BlockedMembersSheet",
}));

// A purple chapter, so a control painted house gold fails.
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    logoUrl: null,
    chapterName: null,
  }),
}));

import SettingsScreen from "@/app/(tabs)/preferences";

const mounted: ReactTestRenderer[] = [];

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <SettingsScreen />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

/** #3022. s16 opens from More's Settings row and draws `‹ More`. */
describe("Settings back row (#3022)", () => {
  it("draws ‹ More above the title", () => {
    const tree = render();

    expect(screenText(tree).startsWith("‹ More\nSettings")).toBe(true);
    expectBackRow(tree, "More", "/more");
  });
});

/**
 * Inside a chapter every control takes the chapter's accent
 * (`spec/behavior/branding.md`, owner rule 2026-11-04), so Settings' switches
 * are the shared Toggle in the accent, never the platform's default or house
 * gold (components/toggle.tsx).
 */
describe("Settings switches", () => {
  it("paints every switch in the chapter's accent", () => {
    const tree = render();
    const switches = tree.root.findAll(
      (node) => (node.type as unknown) === "Switch",
    );

    // Quiet hours, then one per notification category.
    expect(switches.length).toBeGreaterThan(1);
    for (const node of switches) {
      expect(node.props.trackColor.true).toBe("#8E4EC6");
      expect(node.props.activeThumbColor).toBe("#FFFFFF");
    }
  });
});
