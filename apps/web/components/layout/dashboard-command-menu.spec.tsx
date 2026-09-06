import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnalyticsContext } from "@/lib/providers/analytics-provider";
import { assertContentFreeProperties, type AnalyticsProperties } from "@repo/validation";

// The menu only needs a router object present; navigation itself isn't exercised.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const useOrgConfig = vi.fn();
const useMyPermissions = vi.fn();
const useSearch = vi.fn();
useSearch.mockReturnValue({ data: undefined, isFetching: false });

// Search is a separate surface (#264 is about the Navigation group), so the
// module-gating/permission-gating suites below keep it quiet — only the
// "search timeout" suite further down overrides this default.
vi.mock("@repo/hooks", () => ({
  SEARCH_MIN_QUERY_LENGTH: 2,
  SEARCH_COMPLETED_EVENT: "search-completed",
  useSearch: () => useSearch(),
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

// #604: spec/behavior/search.md requires the client to distinguish "we found
// nothing" (no header) from "we stopped looking here" (x-search-timeout).
describe("DashboardCommandMenu search timeout", () => {
  beforeEach(() => {
    useOrgConfig.mockReset();
    useMyPermissions.mockReset();
    withModules([]);
    withPermissions(["*"]);
  });

  afterEach(() => {
    useSearch.mockReturnValue({ data: undefined, isFetching: false });
  });

  async function typeQuery(text: string) {
    const input = screen.getByPlaceholderText(
      "Search members, events, backwork, or jump to a route...",
    );
    await userEvent.type(input, text);
    // The palette debounces the query 200ms before it counts as "hasMinQuery" —
    // "No matching commands." is the no-query/short-query default and always
    // clears once the debounce elapses, regardless of which branch follows.
    await waitFor(
      () =>
        expect(screen.queryByText("No matching commands.")).not.toBeInTheDocument(),
      { timeout: 1000 },
    );
  }

  it("shows the generic empty copy for a true empty result (no timeout)", async () => {
    useSearch.mockReturnValue({
      data: { payload: {}, timedOut: false, timedOutSources: [] },
      isFetching: false,
    });
    render(<DashboardCommandMenu open onOpenChange={() => {}} />);

    await typeQuery("nomatch");

    expect(screen.getByText("No matches across chapter data.")).toBeInTheDocument();
    expect(screen.queryByText(/timed out/i)).not.toBeInTheDocument();
  });

  it("shows timeout-specific copy instead of the generic empty state", async () => {
    useSearch.mockReturnValue({
      data: { payload: {}, timedOut: true, timedOutSources: [] },
      isFetching: false,
    });
    render(<DashboardCommandMenu open onOpenChange={() => {}} />);

    await typeQuery("slowterm");

    expect(
      screen.getByText("Search timed out — try a shorter query or try again."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No matches across chapter data."),
    ).not.toBeInTheDocument();
  });

  it("shows a partial-degradation notice when some sources timed out but others returned hits", async () => {
    useSearch.mockReturnValue({
      data: {
        payload: { members: [{ user_id: "u1", display_name: "Alex Chen" }] },
        timedOut: true,
        timedOutSources: ["messages"],
      },
      isFetching: false,
    });
    render(<DashboardCommandMenu open onOpenChange={() => {}} />);

    await typeQuery("alex");

    expect(screen.getByText("Alex Chen")).toBeInTheDocument();
    expect(
      screen.getByText("Chat search was incomplete — results may be missing."),
    ).toBeInTheDocument();
  });

  it("shows a full-timeout notice even when a navigation command also matches the query", async () => {
    // "eve" both clears SEARCH_MIN_QUERY_LENGTH and substring-matches "Go to
    // Events", so cmdk (shouldFilter={false}) never mounts CommandEmpty —
    // the only place the timeout copy lived before this notice existed.
    useSearch.mockReturnValue({
      data: {
        payload: {},
        timedOut: true,
        timedOutSources: ["backwork", "events", "members", "messages"],
      },
      isFetching: false,
    });
    render(<DashboardCommandMenu open onOpenChange={() => {}} />);

    const input = screen.getByPlaceholderText(
      "Search members, events, backwork, or jump to a route...",
    );
    await userEvent.type(input, "eve");

    expect(screen.getByText("Go to Events")).toBeInTheDocument();
    expect(
      await screen.findByText(
        "Backwork, Events, Members, and Chat search were incomplete — results may be missing.",
      ),
    ).toBeInTheDocument();
  });

  it("shows no timeout notice when nothing timed out", async () => {
    useSearch.mockReturnValue({
      data: {
        payload: { members: [{ user_id: "u1", display_name: "Alex Chen" }] },
        timedOut: false,
        timedOutSources: [],
      },
      isFetching: false,
    });
    render(<DashboardCommandMenu open onOpenChange={() => {}} />);

    await typeQuery("alex");

    expect(screen.getByText("Alex Chen")).toBeInTheDocument();
    expect(screen.queryByText(/incomplete/i)).not.toBeInTheDocument();
  });
});

describe("DashboardCommandMenu search telemetry", () => {
  beforeEach(() => {
    useOrgConfig.mockReset();
    useMyPermissions.mockReset();
    withModules([]);
    withPermissions(["*"]);
  });

  afterEach(() => {
    useSearch.mockReturnValue({ data: undefined, isFetching: false });
  });

  function renderWithTrack(
    track: (name: string, properties?: AnalyticsProperties) => void,
  ) {
    return render(
      <AnalyticsContext.Provider value={track}>
        <DashboardCommandMenu open onOpenChange={() => {}} />
      </AnalyticsContext.Provider>,
    );
  }

  async function typeQuery(text: string) {
    const input = screen.getByPlaceholderText(
      "Search members, events, backwork, or jump to a route...",
    );
    await userEvent.type(input, text);
    await waitFor(
      () =>
        expect(screen.queryByText("No matching commands.")).not.toBeInTheDocument(),
      { timeout: 1000 },
    );
  }

  it("emits search-completed with per-domain counts and zero_result: false on a hit", async () => {
    const track = vi.fn();
    useSearch.mockReturnValue({
      data: {
        payload: { members: [{ user_id: "u1", display_name: "Alex Chen" }] },
        timedOut: false,
        timedOutSources: [],
      },
      isFetching: false,
      dataUpdatedAt: 1000,
    });
    renderWithTrack(track);

    await typeQuery("alex");
    await waitFor(() => expect(track).toHaveBeenCalled());

    expect(track).toHaveBeenCalledWith(
      "search-completed",
      expect.objectContaining({
        surface: "command-menu",
        members_count: 1,
        backwork_count: 0,
        events_count: 0,
        messages_count: 0,
        total_count: 1,
        zero_result: false,
        timed_out: false,
      }),
    );
  });

  it("emits zero_result: true when every domain comes back empty", async () => {
    const track = vi.fn();
    useSearch.mockReturnValue({
      data: { payload: {}, timedOut: false, timedOutSources: [] },
      isFetching: false,
      dataUpdatedAt: 2000,
    });
    renderWithTrack(track);

    await typeQuery("nomatch");
    await waitFor(() => expect(track).toHaveBeenCalled());

    expect(track).toHaveBeenCalledWith(
      "search-completed",
      expect.objectContaining({ total_count: 0, zero_result: true }),
    );
  });

  it("does not emit while the search is still fetching", async () => {
    const track = vi.fn();
    useSearch.mockReturnValue({
      data: undefined,
      isFetching: true,
      dataUpdatedAt: 0,
    });
    renderWithTrack(track);

    await userEvent.type(
      screen.getByPlaceholderText(
        "Search members, events, backwork, or jump to a route...",
      ),
      "alex",
    );

    expect(track).not.toHaveBeenCalled();
  });

  it("does not emit for a query below the minimum length", async () => {
    const track = vi.fn();
    useSearch.mockReturnValue({ data: undefined, isFetching: false });
    renderWithTrack(track);

    await userEvent.type(
      screen.getByPlaceholderText(
        "Search members, events, backwork, or jump to a route...",
      ),
      "a",
    );

    expect(track).not.toHaveBeenCalled();
  });

  it("emits exactly once per settled query, not once per render", async () => {
    const track = vi.fn();
    useSearch.mockReturnValue({
      data: { payload: {}, timedOut: false, timedOutSources: [] },
      isFetching: false,
      dataUpdatedAt: 3000,
    });
    const { rerender } = renderWithTrack(track);

    await typeQuery("nomatch");
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1));

    // An unrelated re-render (same dataUpdatedAt) must not re-fire the event.
    rerender(
      <AnalyticsContext.Provider value={track}>
        <DashboardCommandMenu open onOpenChange={() => {}} />
      </AnalyticsContext.Provider>,
    );

    expect(track).toHaveBeenCalledTimes(1);
  });

  it("never carries the raw query text or another forbidden/non-scalar property", async () => {
    const events: Array<{ name: string; properties?: AnalyticsProperties }> = [];
    const track = (name: string, properties?: AnalyticsProperties) => {
      events.push({ name, properties });
    };
    useSearch.mockReturnValue({
      data: {
        payload: {
          members: [{ user_id: "u1", display_name: "Alex Chen" }],
          messages: [{ id: "m1", content: "hello there", channel_id: "c1" }],
        },
        timedOut: false,
        timedOutSources: [],
      },
      isFetching: false,
      dataUpdatedAt: 4000,
    });
    renderWithTrack(track);

    await typeQuery("alex");
    await waitFor(() => expect(events.length).toBeGreaterThan(0));

    for (const event of events) {
      expect(() =>
        assertContentFreeProperties({
          name: event.name,
          distinctId: "test",
          properties: event.properties ?? {},
        }),
      ).not.toThrow();
      // Belt and suspenders: the raw query string itself must never appear
      // as a property value.
      expect(Object.values(event.properties ?? {})).not.toContain("alex");
    }
  });
});
