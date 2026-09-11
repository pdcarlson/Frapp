import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/*
 * The assembled shell had no unit coverage at all before this lane — the
 * header, breadcrumb, <h1>, sidebar and ⌘K wiring were pinned only indirectly,
 * which made replacing them feel deceptively safe because almost nothing went
 * red. These tests pin the three acceptance criteria #2141 states:
 *
 *   1. every dashboard route sits in the new shell
 *   2. ⌘K is gone from the shell
 *   3. titles are not in the top bar
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/events",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@repo/hooks", () => ({
  useMyPermissions: () => ({ data: { permissions: [] } }),
  useNotifications: () => ({ data: [] }),
  useOrgConfig: () => ({ data: undefined }),
  useAccessibleChapters: () => ({ data: [], isSuccess: true }),
  useCurrentChapter: () => ({ data: undefined, isError: false }),
  useCurrentUser: () => ({ data: { display_name: "Paul Carlson" } }),
  useSearch: () => ({ data: undefined, isFetching: false }),
  useChannels: () => ({ data: [] }),
  SEARCH_MIN_QUERY_LENGTH: 3,
}));

vi.mock("@/lib/auth/select-chapter", () => ({ useSelectChapter: () => vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/hooks/use-chapter-theme", () => ({ useChapterTheme: () => {} }));
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { activeChapterId: string | null }) => unknown,
  ) => selector({ activeChapterId: "chap-1" }),
}));
// Onboarding gates render their own dialogs off their own queries; neither is
// part of the shell's chrome contract.
vi.mock("@/components/onboarding/chapter-wizard", () => ({
  ChapterWizardGate: () => null,
}));
vi.mock("@/components/onboarding/onboarding-tutorial", () => ({
  OnboardingTutorial: () => null,
}));
vi.mock("@/components/layout/dashboard-notification-drawer", () => ({
  DashboardNotificationDrawer: () => null,
}));

import { DashboardShell } from "./dashboard-shell";

describe("DashboardShell", () => {
  it("renders the route inside a main landmark", () => {
    // The floor gate measures `main`'s computed padding, so its presence is a
    // contract, not an implementation detail.
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByText("route content")).toBeInTheDocument();
  });

  it("puts no page title in the top bar", () => {
    // #2141: "titles not in top bar". The title is the page's job now
    // (`page-header.tsx`), so the shell must not derive one from the nav map.
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    const banner = screen.getByRole("banner");
    expect(banner).not.toHaveTextContent("Events");
    expect(banner).not.toHaveTextContent("Dashboard");
  });

  it("renders no heading of its own at all", () => {
    // The old shell's <h1> was nested inside a Breadcrumb <nav>, and it
    // duplicated a title most pages already rendered themselves.
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: /breadcrumb/i }),
    ).not.toBeInTheDocument();
  });

  it("advertises no ⌘K affordance", () => {
    // #2141: kill the palette and the "Search (⌘K)" button.
    const { container } = render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    expect(container.textContent).not.toContain("⌘K");
    expect(screen.queryByText(/Search \(/)).not.toBeInTheDocument();
  });

  it("does not answer Cmd+K", () => {
    // There was exactly one global keydown listener in the app and it toggled
    // the palette. Nothing may open on the chord now.
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    const event = new KeyboardEvent("keydown", {
      key: "k",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("carries the find field, Ask and the account avatar in the bar", () => {
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    const banner = screen.getByRole("banner");
    expect(banner).toContainElement(screen.getByRole("combobox"));
    expect(
      screen.getByRole("button", { name: /Ask a question/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /account menu/i }),
    ).toBeInTheDocument();
  });

  it("keeps the skip link ahead of the content", () => {
    render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    expect(
      screen.getByRole("link", { name: /skip to main content/i }),
    ).toHaveAttribute("href", "#main-content");
  });

  it("leaves room for the offline banner instead of claiming the whole viewport", () => {
    // `OfflineBanner` is a sibling ABOVE this shell in the root layout and
    // publishes its height as `--offline-banner-height`. A flat `h-screen`
    // here adds the banner's height to the page the moment the app goes
    // offline, pushing the bottom of the shell below the fold.
    const { container } = render(
      <DashboardShell>
        <p>route content</p>
      </DashboardShell>,
    );
    const root = container.firstElementChild;
    expect(root?.className).toContain(
      "h-[calc(100vh_-_var(--offline-banner-height,0px))]",
    );
    expect(root?.className).not.toContain("h-screen");
  });

  it("honours the server-read collapse preference on first render", () => {
    // Read from a cookie by the dashboard layout so the first paint is already
    // the right width. If this regressed to a client-side read, the nav would
    // render at 220px and snap to 56px after hydration on every route.
    render(
      <DashboardShell defaultNavCollapsed>
        <p>route content</p>
      </DashboardShell>,
    );
    expect(
      screen.getByRole("button", { name: /expand navigation/i }),
    ).toBeInTheDocument();
  });
});
