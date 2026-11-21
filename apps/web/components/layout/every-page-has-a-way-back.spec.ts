import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DASHBOARD_NAV_ITEMS } from "@/components/layout/nav-config";
import { currentFor } from "@/components/layout/app-nav";
import { resolvePageTitle } from "@/components/layout/page-title";

/**
 * Every page has a way back and the sidebar says where you are (rulebook § 8,
 * Paul 2026-11-20: a meeting's minutes opened with no X, no back and nothing
 * lit in the sidebar). Walks every route under `app/(dashboard)`, so a new
 * page fails here until it has both, instead of reaching Paul first.
 *
 * - Title: the page header draws its title and its close (`ToolPageHeader`)
 *   from `resolvePageTitle`; a route it can't name opens untitled.
 * - Sidebar: a nav row is current on the route or a route under it, or the
 *   route is one of the doors outside the nav listed below.
 */

const DASHBOARD = path.resolve(__dirname, "../../app/(dashboard)");

function routes(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      // A dynamic segment gets a sample value.
      const segment = name.startsWith("[") ? "sample-id" : name;
      out.push(...routes(full, `${prefix}/${segment}`));
    } else if (name === "page.tsx" && !onlyRedirects(full)) {
      out.push(prefix || "/");
    }
  }
  return out;
}

/**
 * A page kept only to send old links on (`/roles` to Settings) never draws,
 * so it needs neither. It imports Next's `redirect` or a `…Redirect` component.
 */
function onlyRedirects(file: string): boolean {
  const source = readFileSync(file, "utf8");
  return /import \{[^}]*\bredirect\b[^}]*\} from "next\/navigation"|import \{ \w+Redirect \}/.test(
    source,
  );
}

/** Chat is the shell's own home, with no tool page to close. */
const NOT_A_TOOL_PAGE = new Set(["/", "/chat"]);

/**
 * Pages outside the sidebar, and the door each opens from. A page here still
 * needs a title (so its header has a close); it just has no row to light.
 */
const OFF_NAV_DOORS: Readonly<Record<string, string>> = {
  "/profile": "account menu",
  "/preferences": "account menu",
  "/settings": "chapter menu",
  "/whats-new": "account menu",
};

const ALL = routes(DASHBOARD).filter((r) => !NOT_A_TOOL_PAGE.has(r));

describe("every dashboard page has a way back and a place in the sidebar", () => {
  it("finds the routes", () => {
    expect(ALL.length).toBeGreaterThan(10);
  });

  it.each(ALL)("%s has a title, so its header draws a close", (route) => {
    expect(resolvePageTitle(route)).not.toBeNull();
  });

  it.each(ALL)("%s lights a sidebar row or is a listed door", (route) => {
    const lit = DASHBOARD_NAV_ITEMS.some(
      (item) => currentFor(item, route) !== undefined,
    );
    expect(lit || route in OFF_NAV_DOORS).toBe(true);
  });
});
