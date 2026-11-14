import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

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
});

/**
 * The Settings page shows each viewer what they can use (#2946).
 *
 * Settings became the one door to officer setup and tools when the nav's
 * Admin group folded into it, so the nav's Settings row now admits a treasurer
 * who holds only `reports:export`. Before, every setup tab rendered for
 * whoever arrived, and the config-gated ones answered a non-holder with
 * "Couldn't load chapter configuration". `settings-access.spec.ts` pins the
 * rules; this pins that the page renders by them.
 */

afterEach(() => {
  ai.available = false;
});

const { permissions, search, currentChapter, ai } = vi.hoisted(() => ({
  // Whether the server has AI (`aiAvailableFrom(useAiConsent())`).
  ai: { available: false },
  permissions: {
    current: undefined as string[] | undefined,
    failed: false,
    offline: false,
    refetch: vi.fn(),
  },
  search: { current: "" },
  currentChapter: {
    current: {
      name: "Alpha Beta Gamma",
      university: "State",
      subscription_status: "active",
      enabled_modules: {} as Record<string, boolean>,
    },
  },
}));

vi.mock("@repo/hooks", () => ({
  // A server with AI off: no AI row (#4308).
  useAiConsent: () => ({ data: null }),
  aiAvailableFrom: () => ai.available,
  isFirstAiReadInFlight: () => false,
  useCurrentChapter: () => ({
    data: currentChapter.current,
    isPending: false,
    isLoading: false,
    isError: false,
    fetchStatus: "idle",
    refetch: vi.fn(),
  }),
  useMyPermissions: () => ({
    data: permissions.current
      ? { permissions: permissions.current }
      : undefined,
    isPending: !permissions.current && !permissions.failed,
    isError: permissions.failed,
    error: permissions.failed ? new Error("Network down") : null,
    fetchStatus: "idle",
    refetch: permissions.refetch,
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
    data: { org_archetype: "ifc" },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  usePatchOrgConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usePendingConfigKeys: () => new Set<string>(),
  useRoles: () => ({ data: [], isPending: false, isError: false }),
  useRoleTiers: () => ({ data: [], isPending: false, isError: false }),
  useMembers: () => ({ data: [], isPending: false, isError: false }),
  useViewerUserId: () => null,
  useUpdateRole: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateRoleTier: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/providers/network-provider", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/providers/network-provider")>();
  return {
    ...actual,
    useNetwork: () => ({
      ...actual.useNetwork(),
      isOffline: permissions.offline,
      probeOnce: vi.fn(),
    }),
  };
});

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.current),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// The Roles tab's matrix has its own reads and its own spec; here it only has
// to be the tab a deep link lands on.
// The officer tools have their own specs; here they only have to be where
// the page puts them (#3837).
vi.mock("@/components/settings/settings-tool-views", () => ({
  SettingsToolBody: (props: {
    moduleKey: string;
    holdsTool: (id: string) => boolean;
  }) => {
    const owns: Record<string, string> = {
      chat: "chat-admin",
      reports: "reports",
      geofences: "study-zones",
    };
    const tool = owns[props.moduleKey];
    return tool && props.holdsTool(tool) ? <p>{`${tool} body`}</p> : null;
  },
  SettingsToolSubpage: (props: {
    subpage: { kind: string; channelId?: string };
  }) => (
    <p>{`subpage: ${props.subpage.kind} ${props.subpage.channelId ?? ""}`}</p>
  ),
}));
vi.mock("@/components/billing/plan-and-billing", () => ({
  PlanAndBilling: () => <div data-testid="plan-and-billing" />,
}));
vi.mock("@/components/settings/settings-roles-tab", () => ({
  SettingsRolesTab: () => <p>Roles matrix</p>,
}));

// The pledge class tab has its own spec; here it shows what the page hands it.
vi.mock("@/components/settings/settings-classes-tab", () => ({
  SettingsClassesTab: (props: {
    canManage: boolean;
    classTerm: string;
    orderTerm: string;
  }) => (
    <p>
      {`classes tab: ${props.canManage ? "can manage" : "read only"}, ${props.classTerm}, ${props.orderTerm}`}
    </p>
  ),
}));

const { SettingsPage } = await import("./settings-page");

function tabNames() {
  return screen.queryAllByRole("tab").map((tab) => tab.textContent);
}

/** The tool links on the open module page (#4073), label and href. */
function tools() {
  const section = document.querySelector('[id$="-tools"]');
  return section
    ? within(section as HTMLElement)
        .getAllByRole("link")
        .map((link) => [
          (link.querySelector("span span") ?? link).textContent,
          link.getAttribute("href"),
        ])
    : [];
}

const MODULE_ROWS = [
  "Chat",
  "Announcements",
  "Events",
  "Points",
  "Service hours",
  "Study zones",
  "Tasks",
  "Polls",
  "Meetings",
  "Documents",
  "Backwork",
  "Reports",
  "Recruitment",
  "Dues",
];

describe("Settings shows each viewer what they can use", () => {
  beforeEach(() => {
    permissions.current = undefined;
    permissions.failed = false;
    permissions.offline = false;
    permissions.refetch.mockClear();
    search.current = "";
    currentChapter.current = {
      ...currentChapter.current,
      enabled_modules: {},
      // A test that gives the chapter its own words must not leak them.
      vocabulary: undefined,
    } as typeof currentChapter.current;
  });

  it("gives the President every setup row and a page for every module (#4073)", () => {
    permissions.current = ["*"];
    render(<SettingsPage />);
    expect(tabNames()).toEqual([
      "Chapter",
      "Semester",
      "Privacy",
      "Plan and billing",
      "Roles",
      "Groups",
      "Pledge class",
      "Member fields",
      ...MODULE_ROWS,
    ]);
    // No Tools group in the rail: each tool is on its module's page.
    expect(
      screen.queryByRole("navigation", { name: "Officer tools" }),
    ).toBeNull();
  });

  it("adds the AI row under Chapter only while the server has AI (#4308)", () => {
    permissions.current = ["*"];
    ai.available = true;
    render(<SettingsPage />);
    expect(tabNames().slice(0, 5)).toEqual([
      "Chapter",
      "Semester",
      "Privacy",
      "AI",
      "Plan and billing",
    ]);
  });

  it("draws Chat admin on the Chat page, with Discord import a row inside Settings (#3837)", () => {
    permissions.current = ["*"];
    search.current = "tab=chat";
    render(<SettingsPage />);
    expect(screen.getByText("chat-admin body")).toBeInTheDocument();
    expect(tools()).toEqual([
      ["Discord import", "/settings?tab=chat&tool=discord-import"],
    ]);
  });

  it("opens a channel's settings and Discord import in place of the Chat page", () => {
    permissions.current = ["*"];
    search.current = "tab=chat&channel=c-1";
    const { unmount } = render(<SettingsPage />);
    expect(screen.getByText("subpage: channel c-1")).toBeInTheDocument();
    expect(screen.queryByText("chat-admin body")).toBeNull();
    // The rail stays, with Chat lit.
    expect(screen.getByRole("tab", { name: "Chat" })).toHaveAttribute(
      "data-state",
      "active",
    );
    unmount();

    search.current = "tab=chat&tool=discord-import";
    render(<SettingsPage />);
    expect(screen.getByText(/subpage: discord-import/)).toBeInTheDocument();
  });

  it("leaves a viewer without the tool on the Chat page itself", () => {
    permissions.current = ["chapter-config:view", "members:view"];
    search.current = "tab=chat&channel=c-1";
    render(<SettingsPage />);
    expect(screen.queryByText(/subpage:/)).toBeNull();
    expect(screen.queryByText("chat-admin body")).toBeNull();
  });

  it("drops a page opened inside a row when the officer moves to another row", () => {
    permissions.current = ["*"];
    search.current = "tab=chat&channel=c-1";
    window.history.replaceState(null, "", "/settings?tab=chat&channel=c-1");
    render(<SettingsPage />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Reports" }));
    expect(window.location.search).toBe("?tab=reports");
  });

  it("drops the Dues page while dues is beta-off", () => {
    permissions.current = ["*"];
    betaOff.keys = ["dues"];
    render(<SettingsPage />);
    expect(tabNames()).not.toContain("Dues");
    expect(tabNames()).not.toContain("DuesOff");
  });

  it("marks a module the chapter switched off in the rail, and keeps its page", () => {
    permissions.current = ["*"];
    currentChapter.current = {
      ...currentChapter.current,
      enabled_modules: { events: false },
    };
    render(<SettingsPage />);
    expect(tabNames()).toContain("EventsOff");
  });

  it("gives a tools-only viewer the page their tool lives on, and nothing that would fail", () => {
    permissions.current = ["members:view", "reports:export"];
    search.current = "tab=reports";
    render(<SettingsPage />);
    expect(tabNames()).toEqual(["Reports"]);
    expect(
      screen.queryByText(/couldn't load chapter configuration/i),
    ).toBeNull();
    // The export form is the page's body (#3837), not a link away.
    expect(tools()).toEqual([]);
    expect(screen.getByText("reports body")).toBeInTheDocument();
  });

  it("gives a treasurer Plan and billing beside their tool's page (#3827)", () => {
    permissions.current = ["members:view", "billing:view", "reports:export"];
    render(<SettingsPage />);
    expect(tabNames()).toEqual(["Plan and billing", "Reports"]);
    expect(
      screen.queryByText(/couldn't load chapter configuration/i),
    ).toBeNull();
  });

  it("opens Plan and billing from an old Danger zone link", () => {
    permissions.current = ["*"];
    search.current = "tab=danger";
    render(<SettingsPage />);
    expect(
      screen.getByRole("tab", { name: "Plan and billing" }),
    ).toHaveAttribute("data-state", "active");
  });

  it("tells a viewer with nothing here who can change that", () => {
    permissions.current = ["members:view"];
    render(<SettingsPage />);
    expect(
      screen.getByText(/nothing in chapter settings for your role/i),
    ).toBeInTheDocument();
  });

  it("lands a deep link to a tab the viewer lacks on the first tab they have", () => {
    permissions.current = ["roles:manage"];
    search.current = "tab=events";
    render(<SettingsPage />);
    expect(tabNames()).toEqual(["Roles", "Pledge class"]);
    expect(screen.getByRole("tab", { name: "Roles" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("names the pledge class tab in the chapter's own word", () => {
    permissions.current = ["roles:manage"];
    currentChapter.current = {
      ...currentChapter.current,
      vocabulary: { class: "Line" },
    } as typeof currentChapter.current;
    render(<SettingsPage />);
    expect(tabNames()).toEqual(["Roles", "Line"]);
  });

  it("opens the pledge class tab writable for a roles:manage holder, in the chapter's words", () => {
    permissions.current = ["roles:manage"];
    search.current = "tab=classes";
    render(<SettingsPage />);
    expect(
      screen.getByText(
        "classes tab: can manage, Pledge class, Fraternal order",
      ),
    ).toBeInTheDocument();
  });

  it("hides a tool whose module the chapter switched off", () => {
    permissions.current = ["*"];
    search.current = "tab=reports";
    currentChapter.current = {
      ...currentChapter.current,
      enabled_modules: { reports: false },
    };
    render(<SettingsPage />);
    expect(tools()).toEqual([]);
    expect(screen.queryByText("reports body")).toBeNull();
    expect(screen.getByText(/reports is off/i)).toBeInTheDocument();
  });

  it("drops a tools-only viewer's page when its tool's module is off", () => {
    permissions.current = ["members:view", "reports:export"];
    currentChapter.current = {
      ...currentChapter.current,
      enabled_modules: { reports: false },
    };
    render(<SettingsPage />);
    expect(tabNames()).toEqual([]);
  });

  it("draws no tab or tool until permissions answer (#3854)", () => {
    // A member who reaches /settings by URL, or by the nav's old early click,
    // used to see an officer's whole rail before it was taken back.
    render(<SettingsPage />);
    expect(tabNames()).toEqual([]);
    expect(tools()).toEqual([]);
    expect(screen.getByText("Loading chapter settings")).toBeInTheDocument();
    expect(
      screen.queryByText(/Nothing in Chapter settings/),
    ).not.toBeInTheDocument();
  });

  it("says it is offline, and retries the permission read, when only that read is missing (#3854)", () => {
    // The chapter read is cached; the permission read never answered.
    permissions.offline = true;
    render(<SettingsPage />);
    expect(tabNames()).toEqual([]);
    expect(
      screen.getByText("Chapter settings unavailable offline"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    expect(permissions.refetch).toHaveBeenCalled();
  });

  it("refuses to guess when the permission read fails", () => {
    permissions.failed = true;
    render(<SettingsPage />);
    expect(tabNames()).toEqual([]);
    expect(
      screen.getByText("Couldn't load chapter settings"),
    ).toBeInTheDocument();
  });
});
