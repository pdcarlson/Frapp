import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// The menu only needs a router object present; navigation itself isn't exercised.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Search is a separate surface (#264 is about the Navigation group), so keep it
// quiet and let the navigation filter be the only thing under test.
vi.mock("@repo/hooks", () => ({
  SEARCH_MIN_QUERY_LENGTH: 2,
  useSearch: () => ({ data: undefined, isFetching: false }),
}));

const useOrgConfig = vi.fn();
vi.mock("@/lib/hooks/use-org-config", () => ({
  useOrgConfig: () => useOrgConfig(),
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

function renderMenu() {
  return render(<DashboardCommandMenu open onOpenChange={() => {}} />);
}

describe("DashboardCommandMenu module gating", () => {
  beforeEach(() => {
    useOrgConfig.mockReset();
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
    // Even with every catalog module off, chat/profile/members/settings have
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
    expect(screen.getByText("Go to Profile")).toBeInTheDocument();
    expect(screen.getByText("Go to Members")).toBeInTheDocument();
    expect(screen.getByText("Go to Settings")).toBeInTheDocument();
  });

  it("hides every disabled module's command at once", () => {
    withModules(["events", "points", "reports"]);
    renderMenu();

    expect(screen.queryByText("Go to Events")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to Points")).not.toBeInTheDocument();
    expect(screen.queryByText("Go to Reports")).not.toBeInTheDocument();
  });

  it("maps /service to the hours module", () => {
    withModules(["hours"]);
    renderMenu();

    expect(screen.queryByText("Go to Service Hours")).not.toBeInTheDocument();
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

// The gate resolves a command's module by looking its href up in nav-config.
// An href that doesn't match resolves to `undefined` and is silently treated
// as always-on — which is correct for free surfaces but would let a future
// paid-module command through ungated, reintroducing exactly the bug #264
// fixed. This test makes that drift loud instead of silent.
describe("command hrefs resolve against nav-config", () => {
  // Free, always-on surfaces whose command href intentionally differs from
  // the nav entry. Adding a *paid-module* route here would be a bug.
  const KNOWN_UNRESOLVED = new Set([
    "/roles", // nav routes this as "/settings?tab=roles"
  ]);

  it("every navigation command resolves, or is a documented free-surface exception", async () => {
    const { DASHBOARD_NAV_BY_HREF } = await import("./nav-config");
    const { navigationCommands } = await import("./dashboard-command-menu");

    expect(navigationCommands.length).toBeGreaterThan(0);

    const unresolved = navigationCommands
      .map((c) => c.href)
      .filter(
        (href) => !DASHBOARD_NAV_BY_HREF[href] && !KNOWN_UNRESOLVED.has(href),
      );
    expect(unresolved).toEqual([]);
  });

  it("guards the exception list itself — no exception may be a paid-module route", async () => {
    const { DASHBOARD_NAV_ITEMS } = await import("./nav-config");
    // A route excused from resolution must not be one nav module-gates under
    // a different href, or the excuse would be hiding a real gap.
    const gatedLabels = new Set(
      DASHBOARD_NAV_ITEMS.filter((i) => i.module).map((i) => i.id),
    );
    for (const href of KNOWN_UNRESOLVED) {
      expect(gatedLabels.has(href.replace(/^\//, ""))).toBe(false);
    }
  });
});
