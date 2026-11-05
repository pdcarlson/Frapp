import {
  DASHBOARD_NAV_ITEMS,
  type NavItem,
} from "@/components/layout/nav-config";
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
 * **Where the words come from.** A nav route's title is its row's label, so the
 * row a member clicked and the heading they land on say the same words. A
 * Settings tool's title is its label in `SETTINGS_TOOLS`, the list the Settings
 * rail draws, and Profile, which has no nav row, is named below. Each route
 * also names its browser tab in its own `metadata.title`; the two are kept to
 * the same words, and `page-title.spec.ts` checks them against each other.
 *
 * **A parent only where there is a page to go back to** (2026-11-05). The four
 * officer tools behind the Settings rail are reached from inside Settings, so
 * they read "Settings › Study zones" and the parent links back. The parent is
 * the nav row that claims the route in its `activeFor`, so it is named and
 * linked exactly as that row is, and it shows only when that row does: a
 * member the nav hides Settings from is not handed a link to it here. A
 * top-level route has no parent: prefixing the chapter name ("Phi Gamma Delta ›
 * Study hours") would repeat the chapter switcher that sits beside it in the
 * nav, and a caret that leads nowhere new is decoration.
 */

export type PageTitleParent = { label: string; href: string };

export type PageTitle = {
  title: string;
  parent?: PageTitleParent;
};

/** Routes that are not nav rows. Profile hangs off the account menu. */
const OFF_NAV_TITLES: Readonly<Record<string, string>> = {
  "/profile": "Profile",
};

function matchesRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * @param isNavItemVisible whether the nav shows a row to this viewer
 *   (`isNavItemVisible` in `protected-nav-item.tsx`, bound to their
 *   permissions and modules). Omitted, every parent shows.
 */
export function resolvePageTitle(
  pathname: string | null,
  isNavItemVisible: (item: NavItem) => boolean = () => true,
): PageTitle | null {
  if (!pathname) return null;

  const tool = SETTINGS_TOOLS.find((t) => matchesRoute(pathname, t.href));
  if (tool) {
    const parentRow = DASHBOARD_NAV_ITEMS.find((item) =>
      item.activeFor?.some((href) => matchesRoute(pathname, href)),
    );
    return parentRow && isNavItemVisible(parentRow)
      ? {
          title: tool.label,
          parent: { label: parentRow.label, href: parentRow.href },
        }
      : { title: tool.label };
  }

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
