import { render, screen, within } from "@testing-library/react";
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

const { permissions, search, currentChapter } = vi.hoisted(() => ({
  permissions: { current: undefined as string[] | undefined },
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
  useCurrentChapter: () => ({
    data: currentChapter.current,
    isPending: false,
    isLoading: false,
    isError: false,
    fetchStatus: "idle",
    refetch: vi.fn(),
  }),
  useMyPermissions: () => ({
    data: permissions.current ? { permissions: permissions.current } : undefined,
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
  useOrgConfig: () => ({
    data: { org_archetype: "ifc" },
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
  useSearchParams: () => new URLSearchParams(search.current),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

// The Roles tab's matrix has its own reads and its own spec; here it only has
// to be the tab a deep link lands on.
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

function tools() {
  const nav = screen.queryByRole("navigation", { name: "Officer tools" });
  return nav
    ? within(nav)
        .getAllByRole("link")
        // The label, not the description the tools-only list adds under it.
        .map((link) => [
          (link.querySelector("span") ?? link).textContent,
          link.getAttribute("href"),
        ])
    : [];
}

describe("Settings shows each viewer what they can use", () => {
  beforeEach(() => {
    permissions.current = undefined;
    search.current = "";
    currentChapter.current = {
      ...currentChapter.current,
      enabled_modules: {},
      // A test that gives the chapter its own words must not leak them.
      vocabulary: undefined,
    } as typeof currentChapter.current;
  });

  it("gives the President every tool above every setup tab", () => {
    permissions.current = ["*"];
    render(<SettingsPage />);
    expect(tools()).toEqual([
      ["Chat admin", "/chat-admin"],
      ["Discord import", "/discord-import"],
      ["Study zones", "/geofences"],
      ["Reports", "/reports"],
    ]);
    expect(tabNames()).toEqual([
      "Chapter",
      "Semester",
      "Privacy",
      "Plan and billing",
      "Roles",
      "Pledge class",
      "Member fields",
      "Modules",
      "Dues",
      "Workflows",
    ]);
  });

  it("drops the Dues tab while dues is beta-off", () => {
    permissions.current = ["*"];
    betaOff.keys = ["dues"];
    render(<SettingsPage />);
    expect(tabNames()).not.toContain("Dues");
    expect(tabNames()).toContain("Workflows");
  });

  it("keeps the Dues tab for a chapter that switched dues off itself", () => {
    permissions.current = ["*"];
    currentChapter.current = {
      ...currentChapter.current,
      enabled_modules: { dues: false },
    };
    render(<SettingsPage />);
    expect(tabNames()).toContain("Dues");
  });

  it("lists a tools-only viewer's one tool as the page, with no setup tabs to fail", () => {
    permissions.current = ["members:view", "reports:export"];
    render(<SettingsPage />);
    expect(tabNames()).toEqual([]);
    expect(screen.queryByText(/couldn't load chapter configuration/i)).toBeNull();
    expect(tools()).toEqual([["Reports", "/reports"]]);
  });

  it("gives a treasurer Plan and billing beside their tool, and no config tab (#3827)", () => {
    permissions.current = ["members:view", "billing:view", "reports:export"];
    render(<SettingsPage />);
    expect(tabNames()).toEqual(["Plan and billing"]);
    expect(screen.queryByText(/couldn't load chapter configuration/i)).toBeNull();
    expect(tools()).toEqual([["Reports", "/reports"]]);
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
      screen.getByText(/nothing in settings for your role/i),
    ).toBeInTheDocument();
    expect(tools()).toEqual([]);
  });

  it("lands a deep link to a tab the viewer lacks on the first tab they have", () => {
    permissions.current = ["roles:manage"];
    search.current = "tab=modules";
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
      screen.getByText("classes tab: can manage, Pledge class, Fraternal order"),
    ).toBeInTheDocument();
  });

  it("hides a tool whose module the chapter switched off", () => {
    permissions.current = ["*"];
    currentChapter.current = {
      ...currentChapter.current,
      enabled_modules: { reports: false },
    };
    render(<SettingsPage />);
    expect(tools().map(([label]) => label)).not.toContain("Reports");
  });

  it("shows every tab while permissions are still loading, so nothing flashes out", () => {
    render(<SettingsPage />);
    expect(tabNames()).toHaveLength(10);
  });
});
