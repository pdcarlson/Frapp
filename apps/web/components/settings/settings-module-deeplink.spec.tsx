import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// `@repo/validation`'s beta list, emptied so this spec pins the ordinary
// module rule with dues as its example. A test that wants dues beta-off, as
// it is for the beta, sets `betaOff.keys`.
const betaOff = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("@repo/validation/beta-off-modules", () => ({
  get BETA_OFF_MODULES() {
    return betaOff.keys;
  },
  isBetaOffModule: (key: string) => betaOff.keys.includes(key),
}));
afterEach(() => {
  betaOff.keys = [];
  aiRead.current = {
    data: null,
    isPending: false,
    fetchStatus: "idle",
    failureCount: 0,
  };
});

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

let searchParams = new URLSearchParams();

// The AI read. By default a server with AI off: no AI row (#4308).
const aiRead = vi.hoisted(() => ({
  current: {
    data: null as object | null | undefined,
    isPending: false,
    fetchStatus: "idle" as "fetching" | "paused" | "idle",
    failureCount: 0,
  },
}));

vi.mock("@repo/hooks", () => ({
  useAiConsent: () => aiRead.current,
  aiAvailableFrom: () => false,
  // The shared rule, whose own spec pins it in `@repo/hooks`.
  isFirstAiReadInFlight: (q: typeof aiRead.current) =>
    q.isPending && q.fetchStatus === "fetching" && q.failureCount === 0,
  useCurrentChapter: () => mockCurrentChapter(),
  useMyPermissions: () => ({
    data: { permissions: ["chapter-config:view", "chapter-config:manage"] },
    isPending: false,
    isError: false,
  }),
  usePermissionsCatalog: () => ({ data: [], isPending: false, isError: false }),
  useSemesters: () => ({ data: [], isPending: false, isError: false }),
  useSemesterRollover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadChapterLogo: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveChapterLogo: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateChapter: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreatePortal: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useChannels: () => ({ data: [] }),
  useOrgConfig: () => ({
    data: { org_archetype: "ifc", enabled_modules: { events: false } },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePatchOrgConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePendingConfigKeys: () => new Set<string>(),
  useRoles: () => ({ data: [], isPending: false, isError: false }),
}));

// Mutable so a test can start with no active chapter, which is how zustand's
// `persist` cold-starts before it rehydrates.
let activeChapterId: string | null = "chap-1";

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { activeChapterId: string | null }) => unknown,
  ) => selector({ activeChapterId }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams,
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { SettingsPage } = await import("./settings-page");

const eventsSwitch = () => screen.getByRole("switch", { name: /^events on$/i });

/**
 * The receiving half of chat's ops-setup nudge deep link (#492). The nudge
 * links to `/settings?tab=<key>&module=<key>`, the module's own page since
 * #4073; links from before that say `?tab=modules&module=<key>`. These pin
 * what the param is allowed to do once the officer arrives.
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

  it("opens the module's page with its switch focused", () => {
    searchParams = new URLSearchParams("tab=events&module=events");
    render(<SettingsPage />);

    expect(eventsSwitch()).toHaveFocus();
    expect(screen.getByRole("tab", { name: /^events/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("opens the same page from a link made for the old Modules list", () => {
    searchParams = new URLSearchParams("tab=modules&module=events");
    render(<SettingsPage />);

    expect(eventsSwitch()).toHaveFocus();
  });

  it("opens Events, unfocused, from an old Modules link without a module", () => {
    searchParams = new URLSearchParams("tab=modules");
    render(<SettingsPage />);

    expect(eventsSwitch()).toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });

  // A real catalog key with no page: Billing is Plan and billing, not a
  // module page, so nothing may be focused or opened for it.
  it("ignores a module key that has no page", () => {
    searchParams = new URLSearchParams("tab=events&module=billing");
    render(<SettingsPage />);

    expect(document.body).toHaveFocus();
  });

  /**
   * The regression this latch exists for. `TabsContent` carries no `forceMount`,
   * so Radix unmounts the inactive page, and the tab is driven by local state
   * without rewriting the URL, so `?module=events` is still in `searchParams`
   * on every later visit. Without the latch, an officer who follows the nudge,
   * wanders elsewhere and comes back gets focus yanked to the switch forever.
   */
  it("does not re-grab focus when the officer returns to the page", async () => {
    const user = userEvent.setup();
    const scrollSpy = vi.fn();
    // jsdom implements no layout, so the effect's scrollIntoView is the only
    // observable side effect that survives Radix taking focus back to the tab
    // trigger on click.
    Element.prototype.scrollIntoView = scrollSpy;

    searchParams = new URLSearchParams("tab=events&module=events");
    render(<SettingsPage />);

    expect(eventsSwitch()).toHaveFocus();
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("tab", { name: /^chapter$/i }));
    await user.click(screen.getByRole("tab", { name: /^events/i }));

    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});

/**
 * The cold-load path. `SettingsPageContent` early-returns before the tabs
 * render, once for "no active chapter" (zustand `persist` starts null) and
 * again for the loading / offline / error banner, so a latch driven by an
 * effect on the page would consume `?module=` on renders where the module page
 * never mounted, and the officer would land unfocused.
 */
describe("settings ?module= on a cold load", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams("tab=events&module=events");
    mockCurrentChapter.mockReturnValue({
      data: { id: "chap-1", name: "Test", subscription_status: "active" },
      isPending: false,
      isError: false,
    });
  });

  it("still focuses the switch once the active chapter rehydrates", () => {
    activeChapterId = null;
    const { rerender } = render(<SettingsPage />);
    expect(
      screen.queryByRole("switch", { name: /^events on$/i }),
    ).not.toBeInTheDocument();

    activeChapterId = "chap-1";
    rerender(<SettingsPage />);

    expect(eventsSwitch()).toHaveFocus();
  });
});

/**
 * The page holds its skeleton while the AI read's first attempt is out, so the
 * AI row doesn't push the rows down when it lands (#4308). A first attempt
 * that failed stops the hold: the read's retries take about seven seconds
 * against a 5xx, and the officer shouldn't sit through them (#4504).
 */
describe("settings while the AI read is out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams("tab=events&module=events");
    activeChapterId = "chap-1";
    mockCurrentChapter.mockReturnValue({
      data: { id: "chap-1", name: "Test", subscription_status: "active" },
      isPending: false,
      isError: false,
    });
  });

  it("holds the skeleton while the first attempt is in flight", () => {
    aiRead.current = {
      data: undefined,
      isPending: true,
      fetchStatus: "fetching",
      failureCount: 0,
    };
    render(<SettingsPage />);
    expect(screen.getByText("Loading chapter settings")).toBeInTheDocument();
    expect(
      screen.queryByRole("switch", { name: /^events on$/i }),
    ).not.toBeInTheDocument();
  });

  it("draws the page once the first attempt has failed, while it retries", () => {
    aiRead.current = {
      data: undefined,
      isPending: true,
      fetchStatus: "fetching",
      failureCount: 1,
    };
    render(<SettingsPage />);
    expect(eventsSwitch()).toBeInTheDocument();
  });
});
