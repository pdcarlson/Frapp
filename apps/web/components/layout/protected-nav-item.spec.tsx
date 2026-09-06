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
  status: "available",
  module: "events",
};

const coreItem: NavItem = {
  id: "chat",
  label: "Chat",
  icon: PointsGlyph,
  href: "/chat",
  status: "available",
};

function renderItem(item: NavItem, isModuleEnabled?: (key: string) => boolean) {
  return render(
    <ProtectedNavItem
      item={item}
      isActive={false}
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
        isActive={false}
        permissions={["members:view"]}
        iconClassName="h-4 w-4"
        focusClassName=""
        isModuleEnabled={() => true}
      />,
    );
    expect(screen.queryByText("Events")).not.toBeInTheDocument();
  });
});

// `isNavItemVisible` is the predicate the sidebar, the mobile drawer, and the
// ⌘K palette all share. It is exported specifically so a *section* can ask the
// same question its items do — the Admin group is role-gated entirely through
// its items' permissions, and a heading that outlived them would announce a
// group an ordinary member cannot open.
describe("isNavItemVisible", () => {
  const permissionItem: NavItem = {
    id: "roles",
    label: "Roles",
    icon: PointsGlyph,
    href: "/settings?tab=roles",
    status: "available",
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
  it("gates every Admin item, so the section disappears for ordinary members", async () => {
    const { DASHBOARD_NAV } = await import("./nav-config");
    const { isNavItemVisible } = await import("./protected-nav-item");

    const admin = DASHBOARD_NAV.find((section) => section.id === "admin");
    expect(admin).toBeDefined();
    // An ungated item here would keep the heading alive for everyone and
    // quietly undo the gating.
    for (const item of admin!.items) {
      expect(item.requirePermission ?? item.requireAnyOf).toBeDefined();
    }
    const visible = admin!.items.filter((item) =>
      isNavItemVisible(item, ["members:view"]),
    );
    expect(visible).toEqual([]);
  });

  it("leads with Chat as an anchor that renders no heading", async () => {
    const { DASHBOARD_NAV } = await import("./nav-config");
    expect(DASHBOARD_NAV[0]?.anchor).toBe(true);
    expect(DASHBOARD_NAV[0]?.items.map((i) => i.href)).toEqual(["/chat"]);
  });

  it("keeps Profile out of the chapter nav — it lives in the account menu", async () => {
    const { DASHBOARD_NAV_BY_HREF } = await import("./nav-config");
    expect(DASHBOARD_NAV_BY_HREF["/profile"]).toBeUndefined();
  });

  it("names the routes it deliberately left out of the nav", async () => {
    const { DASHBOARD_NAV_BY_HREF, OFF_NAV_ROUTE_TITLES } = await import(
      "./nav-config"
    );
    // The header title resolves off the nav map, so a reachable route with no
    // nav row rendered a page called "Dashboard". Profile is that route.
    expect(OFF_NAV_ROUTE_TITLES["/profile"]).toBe("My Profile");
    // Anything listed here must genuinely be absent from the nav — an entry
    // that duplicated a nav row would be a second, drifting source of truth.
    for (const href of Object.keys(OFF_NAV_ROUTE_TITLES)) {
      expect(DASHBOARD_NAV_BY_HREF[href]).toBeUndefined();
    }
  });

  it("routes the directory to one entry rather than members and alumni", async () => {
    const { DASHBOARD_NAV_BY_HREF } = await import("./nav-config");
    expect(DASHBOARD_NAV_BY_HREF["/members"]).toBeDefined();
    // /alumni still resolves as a route, but it redirects into the Alumni tab
    // and must not reappear as its own nav row.
    expect(DASHBOARD_NAV_BY_HREF["/alumni"]).toBeUndefined();
  });
});
