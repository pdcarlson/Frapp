import { DASHBOARD_NAV_ITEMS } from "@/components/layout/nav-config";
import { SETTINGS_TOOLS } from "@/components/settings/settings-access";

/**
 * The open route's title, as the top bar shows it.
 *
 * The title is derived from the route here, in one place, rather than passed
 * up by each page. That is what puts it on every path a route can take:
 * loading, offline, error and denied all render the same heading, because none
 * of them has to remember to. A page passing its own title was the old shape
 * (`PageHeader`), and the duty to render it on every branch was the part pages
 * kept dropping.
 *
 * **The title is the nav row's label.** The sidebar row a member clicked and
 * the heading they land on say the same words, so `nav-config.ts` is the one
 * source for both.
 *
 * **A parent only where there is a page to go back to** (2026-11-05). The four
 * officer tools behind the Settings rail are reached from inside Settings, so
 * they read "Settings › Study zones" and the parent links back. A top-level
 * route has no parent: prefixing the chapter name ("Phi Gamma Delta › Study
 * hours") would repeat the chapter switcher that sits beside it in the nav, and
 * a caret that leads nowhere new is decoration.
 */

export type PageTitleParent = { label: string; href: string };

export type PageTitle = {
  title: string;
  parent?: PageTitleParent;
};

const SETTINGS_PARENT: PageTitleParent = {
  label: "Settings",
  href: "/settings",
};

/** Routes that are not nav rows. Profile hangs off the account menu. */
const OFF_NAV_TITLES: Readonly<Record<string, string>> = {
  "/profile": "Profile",
};

function matchesRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function resolvePageTitle(pathname: string | null): PageTitle | null {
  if (!pathname) return null;

  const tool = SETTINGS_TOOLS.find((t) => matchesRoute(pathname, t.href));
  if (tool) return { title: tool.label, parent: SETTINGS_PARENT };

  const navItem = DASHBOARD_NAV_ITEMS.find((item) =>
    matchesRoute(pathname, item.href),
  );
  if (navItem) return { title: navItem.label };

  const offNav = Object.entries(OFF_NAV_TITLES).find(([href]) =>
    matchesRoute(pathname, href),
  );
  if (offNav) return { title: offNav[1] };

  return null;
}
