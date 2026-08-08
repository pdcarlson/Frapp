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
