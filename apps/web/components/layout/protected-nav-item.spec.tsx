import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PointsGlyph } from "@/components/layout/nav-glyphs";
import type { NavItem } from "./nav-config";

// next/link needs a router context that jsdom lacks; render a plain anchor.
vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a {...props}>{children}</a>,
}));

// Imported after the mock so the component picks up the stubbed next/link.
const { ProtectedNavItem } = await import("./protected-nav-item");

const moduleItem: NavItem = {
  id: "events",
  label: "Events",
  icon: PointsGlyph,
  href: "/events",
  module: "events",
};

const coreItem: NavItem = {
  id: "chat",
  label: "Chat",
  icon: PointsGlyph,
  href: "/chat",
};

function renderItem(item: NavItem, isModuleEnabled?: (key: string) => boolean) {
  return render(
    <ProtectedNavItem
      item={item}
      permissions={["*"]}
      iconClassName="h-4 w-4"
      focusClassName=""
      isModuleEnabled={isModuleEnabled}
    />,
  );
}

describe("ProtectedNavItem module gating", () => {
  it("hides an item whose module is disabled", () => {
    renderItem(moduleItem, (key) => key !== "events");
    expect(screen.queryByText("Events")).not.toBeInTheDocument();
  });

  it("shows an item whose module is enabled", () => {
    renderItem(moduleItem, () => true);
    expect(screen.getByText("Events")).toBeInTheDocument();
  });

  it("shows the item while config is loading (no predicate yet)", () => {
    renderItem(moduleItem, undefined);
    expect(screen.getByText("Events")).toBeInTheDocument();
  });

  it("never module-gates a core item that declares no module", () => {
    renderItem(coreItem, () => false);
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("still hides on a missing permission even when the module is enabled", () => {
    render(
      <ProtectedNavItem
        item={{ ...moduleItem, requirePermission: "events:manage" }}
        permissions={["members:view"]}
        iconClassName="h-4 w-4"
        focusClassName=""
        isModuleEnabled={() => true}
      />,
    );
    expect(screen.queryByText("Events")).not.toBeInTheDocument();
  });
});

// `isNavItemVisible` is the predicate the sidebar and the mobile drawer share.
// It is exported specifically so a *section* can ask the same question its
// items do — a heading that outlived its rows would announce a group the
// viewer cannot open.
describe("isNavItemVisible", () => {
  const permissionItem: NavItem = {
    id: "roles",
    label: "Roles",
    icon: PointsGlyph,
    href: "/settings?tab=roles",
    requirePermission: "roles:manage",
  };

  it("hides an item whose permission the caller lacks", async () => {
    const { isNavItemVisible } = await import("./protected-nav-item");
    expect(isNavItemVisible(permissionItem, ["members:view"])).toBe(false);
  });

  it("shows it to a holder of that permission", async () => {
    const { isNavItemVisible } = await import("./protected-nav-item");
    expect(isNavItemVisible(permissionItem, ["roles:manage"])).toBe(true);
  });

  it("treats the owner wildcard as holding everything", async () => {
    const { isNavItemVisible } = await import("./protected-nav-item");
    // A bare `permissions.includes()` would hide admin rows from the very
    // people they exist for, since an owner's grant is `*` and nothing else.
    expect(isNavItemVisible(permissionItem, ["*"])).toBe(true);
  });

  it("fails open while the permission set is unresolved", async () => {
    const { isNavItemVisible } = await import("./protected-nav-item");
    expect(isNavItemVisible(permissionItem, undefined)).toBe(true);
    expect(isNavItemVisible(permissionItem, null)).toBe(true);
  });

  it("hides an item whose module the chapter disabled", async () => {
    const { isNavItemVisible } = await import("./protected-nav-item");
    expect(isNavItemVisible(moduleItem, ["*"], () => false)).toBe(false);
  });

  it("fails open while the module predicate is unresolved", async () => {
    const { isNavItemVisible } = await import("./protected-nav-item");
    expect(isNavItemVisible(moduleItem, ["*"], undefined)).toBe(true);
  });

  it("applies both gates, not whichever one is declared first", async () => {
    const { isNavItemVisible } = await import("./protected-nav-item");
    const bothGates: NavItem = {
      ...moduleItem,
      requirePermission: "reports:export",
    };
    // Permission held, module off.
    expect(isNavItemVisible(bothGates, ["reports:export"], () => false)).toBe(
      false,
    );
    // Module on, permission missing.
    expect(isNavItemVisible(bothGates, ["members:view"], () => true)).toBe(
      false,
    );
    expect(isNavItemVisible(bothGates, ["reports:export"], () => true)).toBe(
      true,
    );
  });
});

// The restructure's whole point is that a member sees a short list of things
// they can actually open. These pin the shape rather than the wording.
describe("DASHBOARD_NAV structure", () => {
  it("has no officer-only section: officer setup and tools sit behind one Settings row", async () => {
    const { DASHBOARD_NAV } = await import("./nav-config");
    const { isNavItemVisible } = await import("./protected-nav-item");
    const { SETTINGS_ENTRY_PERMISSIONS, SETTINGS_TOOL_ROUTES } = await import(
      "@/components/settings/settings-access"
    );

    // The six-row Admin group is what pushed a President's nav past a 768px
    // window (#2946). A section whose every row is officer-gated is that group
    // coming back.
    for (const section of DASHBOARD_NAV) {
      const memberRows = section.items.filter((item) =>
        isNavItemVisible(item, ["members:view"]),
      );
      expect(memberRows.length, section.id).toBeGreaterThan(0);
    }

    const items = DASHBOARD_NAV.flatMap((section) => section.items);
    const settings = items.find((item) => item.id === "settings");
    expect(settings?.requireAnyOf).toEqual(SETTINGS_ENTRY_PERMISSIONS);
    expect(isNavItemVisible(settings!, ["members:view"])).toBe(false);
    // Every officer tool route is owned by the Settings row, and none of them
    // is a row of its own.
    expect(settings?.activeFor).toEqual(SETTINGS_TOOL_ROUTES);
    for (const route of SETTINGS_TOOL_ROUTES) {
      expect(items.some((item) => item.href === route)).toBe(false);
    }
  });

  it("leads with Chat as an anchor that renders no heading", async () => {
    const { DASHBOARD_NAV } = await import("./nav-config");
    expect(DASHBOARD_NAV[0]?.anchor).toBe(true);
    expect(DASHBOARD_NAV[0]?.items.map((i) => i.href)).toEqual(["/chat"]);
  });

  it("keeps Profile out of the chapter nav — it lives in the account menu", async () => {
    const { DASHBOARD_NAV_ITEMS } = await import("./nav-config");
    const hrefs = DASHBOARD_NAV_ITEMS.map((item) => item.href);
    expect(hrefs).not.toContain("/profile");
  });

  it("routes the directory to one entry rather than members and alumni", async () => {
    const { DASHBOARD_NAV_ITEMS } = await import("./nav-config");
    const hrefs = DASHBOARD_NAV_ITEMS.map((item) => item.href);
    expect(hrefs).toContain("/members");
    // /alumni still resolves as a route, but it redirects into the Alumni tab
    // and must not reappear as its own nav row.
    expect(hrefs).not.toContain("/alumni");
  });
});
