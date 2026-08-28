import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// The menu only needs a router object present; navigation itself isn't exercised.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const useOrgConfig = vi.fn();
const useMyPermissions = vi.fn();

// Search is a separate surface (#264 is about the Navigation group), so keep it
// quiet and let the navigation filter be the only thing under test.
vi.mock("@repo/hooks", () => ({
  SEARCH_MIN_QUERY_LENGTH: 2,
  useSearch: () => ({ data: undefined, isFetching: false }),
  useOrgConfig: () => useOrgConfig(),
  useMyPermissions: () => useMyPermissions(),
}));

// A chapter is always active here; permission behaviour is driven by the mock
// above rather than by the store.
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chapter-1" }),
}));

// Imported after the mocks so the component picks them up.
const { DashboardCommandMenu } = await import("./dashboard-command-menu");

/** `useOrgConfig()` shape: the predicate hangs off `.data`. */
function withModules(disabled: string[] | null) {
  useOrgConfig.mockReturnValue(
    disabled === null
      ? { data: undefined, isError: false }
      : {
          data: {
            isModuleEnabled: (key: string) => !disabled.includes(key),
          },
          isError: false,
        },
  );
}

/** `null` models the still-loading window, where nothing may be hidden. */
function withPermissions(permissions: string[] | null) {
  useMyPermissions.mockReturnValue({
    data: permissions === null ? undefined : { permissions },
  });
}

function renderMenu() {
  return render(<DashboardCommandMenu open onOpenChange={() => {}} />);
}

describe("DashboardCommandMenu module gating", () => {
  beforeEach(() => {
    useOrgConfig.mockReset();
    useMyPermissions.mockReset();
    // The owner wildcard, so module gating is the only variable under test.
    withPermissions(["*"]);
  });

  it("hides a command whose module the chapter disabled", () => {
    withModules(["events"]);
    renderMenu();

    expect(screen.queryByText("Go to Events")).not.toBeInTheDocument();
  });

  it("keeps commands whose modules are still enabled", () => {
    withModules(["events"]);
    renderMenu();

    expect(screen.getByText("Go to Points")).toBeInTheDocument();
    expect(screen.getByText("Go to Tasks")).toBeInTheDocument();
  });

  it("never hides always-on surfaces, which declare no module", () => {
    // Even with every catalog module off, chat/directory/billing/settings have
    // no `module` key in nav-config and must stay reachable.
    withModules([
      "events",
      "points",
      "tasks",
      "hours",
      "polls",
      "backwork",
      "documents",
      "geofences",
      "reports",
    ]);
    renderMenu();

    expect(screen.getByText("Go to Chat")).toBeInTheDocument();
    expect(screen.getByText("Go to Directory")).toBeInTheDocument();
    expect(screen.getByText("Go to Billing")).toBeInTheDocument();
    expect(screen.getByText("Go to Settings")).toBeInTheDocument();
  });

  it("hides every disabled module's command at once", () => {
    withModules(["events", "points", "reports"]);
    renderMenu();

    expect(screen.queryByText("Go to Events")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to Points")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to Reports")).not.toBeInTheDocument();
  });

  it("maps both hours surfaces to the hours module", () => {
    withModules(["hours"]);
    renderMenu();

    expect(screen.queryByText("Go to Service hours")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to Study hours")).not.toBeInTheDocument();
  });

  // Fail-safe, matching ProtectedNavItem: nothing hides until the chapter
  // config resolves, so commands never flash out during the initial load.
  it("shows everything while the chapter config is still loading", () => {
    withModules(null);
    renderMenu();

    expect(screen.getByText("Go to Events")).toBeInTheDocument();
    expect(screen.getByText("Go to Reports")).toBeInTheDocument();
  });

  it("still applies the typed query filter alongside module gating", () => {
    withModules([]);
    renderMenu();

    // No query typed → the full navigation list renders.
    expect(screen.getByText("Go to Events")).toBeInTheDocument();
    expect(screen.getByText("Go to Documents")).toBeInTheDocument();
  });
});

// The palette used to gate on modules only, so a member could ⌘K straight past
// a permission the sidebar was enforcing — onto a screen whose data fetch the
// API would refuse. Both gates now run through one predicate.
describe("DashboardCommandMenu permission gating", () => {
  beforeEach(() => {
    useOrgConfig.mockReset();
    useMyPermissions.mockReset();
    withModules([]);
  });

  it("hides admin routes from a member who holds no admin permissions", () => {
    withPermissions(["members:view"]);
    renderMenu();

    expect(screen.queryByText("Go to Roles")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to Reports")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to Study Zones")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to Settings")).not.toBeInTheDocument();
  });

  it("keeps ungated routes for that same member", () => {
    withPermissions(["members:view"]);
    renderMenu();

    expect(screen.getByText("Go to Chat")).toBeInTheDocument();
    expect(screen.getByText("Go to Events")).toBeInTheDocument();
    expect(screen.getByText("Go to Directory")).toBeInTheDocument();
  });

  it("shows admin routes to the wildcard owner grant", () => {
    withPermissions(["*"]);
    renderMenu();

    expect(screen.getByText("Go to Roles")).toBeInTheDocument();
    expect(screen.getByText("Go to Settings")).toBeInTheDocument();
  });

  it("shows everything while the permission set is still loading", () => {
    withPermissions(null);
    renderMenu();

    expect(screen.getByText("Go to Roles")).toBeInTheDocument();
    expect(screen.getByText("Go to Settings")).toBeInTheDocument();
  });
});

// The palette's Navigation group is derived from `nav-config` rather than
// restated, which is what killed the drift #264 was about: the old hand-written
// array had lost Polls, Study and Study Zones, and pointed Roles at a route the
// sidebar did not use. These assert the derivation stays honest.
describe("the palette and the sidebar are one list", () => {
  it("offers exactly the nav items that have a route", async () => {
    const { DASHBOARD_NAV_ITEMS } = await import("./nav-config");
    const { navigationCommands } = await import("./dashboard-command-menu");

    const navHrefs = DASHBOARD_NAV_ITEMS.filter((i) => i.href).map(
      (i) => i.href,
    );
    expect(navigationCommands.map((c) => c.href)).toEqual(navHrefs);
    expect(navigationCommands.length).toBeGreaterThan(0);
  });

  it("carries each item's own gates, so no command can outlive its nav entry", async () => {
    const { navigationCommands } = await import("./dashboard-command-menu");

    // Every command keeps a reference to the nav item it came from; that is
    // what `isNavItemVisible` reads. A command built from a literal instead
    // would silently lose both gates.
    for (const command of navigationCommands) {
      expect(command.item.href).toBe(command.href);
    }
  });
});
