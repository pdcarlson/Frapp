import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

let searchParams = new URLSearchParams();

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: ["chapter-config:manage"] },
    isPending: false,
    isError: false,
  }),
  usePermissionsCatalog: () => ({ data: [], isPending: false, isError: false }),
  useSemesters: () => ({ data: [], isPending: false, isError: false }),
  useSemesterRollover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateChapter: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreatePortal: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useOrgConfig: () => ({
    data: { org_archetype: "ifc", enabled_modules: { dues: false } },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePatchOrgConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePendingConfigKeys: () => new Set<string>(),
}));

// Mutable so a test can start with no active chapter, which is how zustand's
// `persist` cold-starts before it rehydrates.
let activeChapterId: string | null = "chap-1";

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string | null }) => unknown) =>
    selector({ activeChapterId }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { SettingsPage } = await import("./settings-page");

const duesSwitch = () => screen.getByRole("switch", { name: /dues enabled/i });

/**
 * The receiving half of chat's ops-setup nudge deep link (#492). The nudge
 * links to `/settings?tab=modules&module=<key>`; these pin what that param is
 * allowed to do once the officer arrives.
 */
describe("settings ?module= deep link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentChapter.mockReturnValue({
      data: { id: "chap-1", name: "Test", subscription_status: "active" },
      isPending: false,
      isError: false,
    });
    searchParams = new URLSearchParams();
    activeChapterId = "chap-1";
  });

  it("opens the Modules tab focused on the named module", () => {
    searchParams = new URLSearchParams("tab=modules&module=dues");
    render(<SettingsPage />);

    expect(duesSwitch()).toHaveFocus();
  });

  // Deliberately a REAL, toggleable catalog key that is not a nudge key. A
  // nonsense value like "not-a-module" would prove nothing: focus is driven by
  // `m.key === focusModuleKey`, so an unmatched string focuses nothing whether
  // or not `isOpsNudgeModuleKey` guards it. `hours` is in MODULE_CATALOG and
  // renders a switch, so dropping the guard really would focus and scroll it.
  it("ignores a real module key that has no nudge", () => {
    searchParams = new URLSearchParams("tab=modules&module=hours");
    render(<SettingsPage />);

    // Asserted on the body, not on one row: checking only the Dues switch would
    // pass while focus sat on Hours.
    expect(document.body).toHaveFocus();
    expect(
      screen.getByRole("switch", { name: /service hours enabled/i }),
    ).not.toHaveFocus();
  });

  it("focuses nothing when the tab is deep-linked without a module", () => {
    searchParams = new URLSearchParams("tab=modules");
    render(<SettingsPage />);

    expect(document.body).toHaveFocus();
  });

  /**
   * The regression this latch exists for. `TabsContent` carries no `forceMount`,
   * so Radix unmounts inactive tab content, and the tab is driven by local state
   * without rewriting the URL — so `?module=dues` is still in `searchParams` on
   * every later visit to the tab. Without the latch, an officer who follows the
   * nudge, enables the module, wanders elsewhere in Settings and comes back gets
   * focus yanked to the same switch and the list scrolled back to it, forever.
   */
  it("does not re-grab focus when the officer returns to the Modules tab", async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.fn();
    // jsdom implements no layout, so the effect's scrollIntoView is the only
    // observable side effect that survives Radix taking focus back to the tab
    // trigger on click. Counting it is what distinguishes "the effect re-fired"
    // from "the effect re-fired and something else stole focus afterwards".
    Element.prototype.scrollIntoView = scrollSpy;

    searchParams = new URLSearchParams("tab=modules&module=dues");
    render(<SettingsPage />);

    expect(duesSwitch()).toHaveFocus();
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    // Leave Modules (its panel genuinely unmounts — Radix Content has no
    // forceMount) and come back. The URL never changes, exactly as in the real
    // flow, so `?module=dues` is still present on the return visit.
    await user.click(screen.getByRole("tab", { name: /^theme$/i }));
    await user.click(screen.getByRole("tab", { name: /^modules$/i }));

    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * The cold-load path, and the regression that the first version of the latch
 * introduced. `SettingsPageContent` early-returns before the tabs render — once
 * for "no active chapter" (zustand `persist` starts null) and again for the
 * loading / offline / error banner — so a latch driven by an effect on the page
 * consumed `?module=` on renders where the Modules panel had never mounted. The
 * officer then landed at the top of the full module list, which is exactly what
 * the param exists to prevent.
 *
 * Reachable from: a pasted link, a bookmark, a refresh, open-in-new-tab on the
 * nudge's link, or simply a cold `useCurrentChapter`. The in-app click path
 * masked it, because the chapter query is already warm from the dashboard shell.
 */
describe("settings ?module= on a cold load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams("tab=modules&module=dues");
    mockCurrentChapter.mockReturnValue({
      data: { id: "chap-1", name: "Test", subscription_status: "active" },
      isPending: false,
      isError: false,
    });
  });

  it("still focuses the module once the active chapter rehydrates", () => {
    // First paint: no active chapter yet, so the page early-returns its
    // "select a chapter" card and the Modules tab never mounts.
    activeChapterId = null;
    const { rerender } = render(<SettingsPage />);
    expect(
      screen.queryByRole("switch", { name: /dues enabled/i }),
    ).not.toBeInTheDocument();

    // The store rehydrates and the tabs mount for the first time. The deep link
    // must still be live: a latch that fired on the earlier render would have
    // consumed `?module=` without ever delivering the focus.
    activeChapterId = "chap-1";
    rerender(<SettingsPage />);

    expect(duesSwitch()).toHaveFocus();
  });
});
