import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
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

  it("puts every Settings tool under a link back to its module page (#4073)", () => {
    for (const tool of SETTINGS_TOOLS) {
      expect(resolvePageTitle(tool.href)).toEqual({
        title: tool.label,
        parent: {
          label: "Chapter settings",
          href: `/settings?tab=${tool.page}`,
        },
      });
    }
    expect(resolvePageTitle("/geofences")?.parent?.href).toBe(
      "/settings?tab=geofences",
    );
  });

  it("drops the Settings parent when the nav hides the Settings row", () => {
    // The crumb follows its row's gates, so a member the nav hides Settings
    // from is not handed a link to it from the top bar.
    for (const tool of SETTINGS_TOOLS) {
      expect(
        resolvePageTitle(tool.href, (item) => item.id !== "settings"),
      ).toEqual({ title: tool.label });
    }
  });

  it("titles a route's sub-paths as the route, but not a lookalike prefix", () => {
    expect(resolvePageTitle("/events/abc")).toEqual({ title: "Events" });
    expect(resolvePageTitle("/eventsx")).toBeNull();
  });

  it("puts Bulk upload under its Backwork row", () => {
    expect(resolvePageTitle("/backwork/upload")).toEqual({
      title: "Bulk upload",
      parent: { label: "Backwork", href: "/backwork" },
    });
    expect(resolvePageTitle("/backwork/upload", (item) => item.href !== "/backwork")).toEqual({
      title: "Bulk upload",
    });
  });

  it("titles Profile, which is not a nav row", () => {
    expect(resolvePageTitle("/profile")).toEqual({ title: "Profile" });
  });

  it("keeps the two doors' titles apart (#3856)", () => {
    // The member's own page is "Settings"; the nav row's is the chapter's.
    expect(resolvePageTitle("/preferences")).toEqual({ title: "Settings" });
    expect(resolvePageTitle("/settings")).toEqual({
      title: "Chapter settings",
    });
  });

  it("invents nothing for a route it does not know", () => {
    expect(resolvePageTitle("/somewhere-new")).toBeNull();
    expect(resolvePageTitle(null)).toBeNull();
  });

  it("matches each route's browser-tab title, so the tab and the heading agree", () => {
    // Each route also names itself in `metadata.title`. Read as text, because
    // importing every page would pull the whole app into this test.
    const dashboard = join(__dirname, "../../app/(dashboard)");
    let checked = 0;
    for (const dir of readdirSync(dashboard)) {
      const page = join(dashboard, dir, "page.tsx");
      if (!existsSync(page)) continue;
      const match = /metadata\s*=\s*\{[^}]*title:\s*"([^"]+)"/.exec(
        readFileSync(page, "utf8"),
      );
      if (!match) continue; // a redirect-only route names nothing
      expect(resolvePageTitle(`/${dir}`)?.title, `/${dir}`).toBe(match[1]);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10);
  });
});
