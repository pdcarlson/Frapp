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

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
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
  });

  it("opens the Modules tab focused on the named module", () => {
    searchParams = new URLSearchParams("tab=modules&module=dues");
    render(<SettingsPage />);

    expect(duesSwitch()).toHaveFocus();
  });

  it("ignores a module key that is not a nudge key", () => {
    // An unrecognised value must yield an ordinary unfocused Modules tab, not a
    // lookup for a row id that does not exist.
    searchParams = new URLSearchParams("tab=modules&module=not-a-module");
    render(<SettingsPage />);

    expect(duesSwitch()).not.toHaveFocus();
  });

  it("focuses nothing when the tab is deep-linked without a module", () => {
    searchParams = new URLSearchParams("tab=modules");
    render(<SettingsPage />);

    expect(duesSwitch()).not.toHaveFocus();
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
