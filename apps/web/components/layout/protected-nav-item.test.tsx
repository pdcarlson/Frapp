import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Star } from "lucide-react";
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
  icon: Star,
  href: "/events",
  status: "available",
  module: "events",
};

const coreItem: NavItem = {
  id: "chat",
  label: "Chat",
  icon: Star,
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
