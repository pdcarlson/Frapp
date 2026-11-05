import { describe, expect, it } from "vitest";
import { resolvePageTitle } from "./page-title";
import { DASHBOARD_NAV_ITEMS } from "./nav-config";
import { SETTINGS_TOOLS } from "@/components/settings/settings-access";

describe("resolvePageTitle", () => {
  it("titles every nav row with the row's own label, and no parent", () => {
    for (const item of DASHBOARD_NAV_ITEMS) {
      expect(resolvePageTitle(item.href)).toEqual({ title: item.label });
    }
  });

  it("puts every Settings tool under a Settings link", () => {
    for (const tool of SETTINGS_TOOLS) {
      expect(resolvePageTitle(tool.href)).toEqual({
        title: tool.label,
        parent: { label: "Settings", href: "/settings" },
      });
    }
  });

  it("titles a route's sub-paths as the route, but not a lookalike prefix", () => {
    expect(resolvePageTitle("/events/abc")).toEqual({ title: "Events" });
    expect(resolvePageTitle("/eventsx")).toBeNull();
  });

  it("titles Profile, which is not a nav row", () => {
    expect(resolvePageTitle("/profile")).toEqual({ title: "Profile" });
  });

  it("invents nothing for a route it does not know", () => {
    expect(resolvePageTitle("/somewhere-new")).toBeNull();
    expect(resolvePageTitle(null)).toBeNull();
  });
});
