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
 * they read "Chapter settings › Study zones" and the parent links back to the
 * module page that lists the tool (#4073). The parent is
 * the nav row that claims the route in its `activeFor`, so it is named and
 * linked exactly as that row is, and it shows only when that row does: a
 * member the nav hides Settings from is not handed a link to it here.
 * A page reached from inside a nav row's own page reads the same way under
 * that row, "Backwork › Bulk upload" (`SUB_PAGE_TITLES`). A
 * top-level route has no parent: prefixing the chapter name ("Phi Gamma Delta ›
 * Study hours") would repeat the chapter switcher that sits beside it in the
 * nav, and a caret that leads nowhere new is decoration.
 */

export type PageTitleParent = { label: string; href: string };

export type PageTitle = {
  title: string;
  parent?: PageTitleParent;
};

/**
 * Routes that are not nav rows. Profile and the personal Settings page hang
 * off the account menu; the nav's own settings row is "Chapter settings".
 */
const OFF_NAV_TITLES: Readonly<Record<string, string>> = {
  "/profile": "Profile",
  "/preferences": "Settings",
  "/whats-new": "What's new",
};

/**
 * Pages under a nav row that read as their own step, titled under that row
 * ("Backwork › Bulk upload") with the same visibility rule as a Settings tool.
 */
const SUB_PAGE_TITLES: Readonly<Record<string, string>> = {
  "/backwork/upload": "Bulk upload",
};

/**
 * Pages one record deep under a nav row, matched by prefix: any
 * `/meetings/<id>` is that meeting's "Minutes", under Meetings.
 */
const RECORD_PAGE_TITLES: Readonly<Record<string, string>> = {
  "/meetings/": "Minutes",
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

  // An embedded tool (Study zones) has no route of its own to title.
  const tool = SETTINGS_TOOLS.find(
    (t) => !t.embedded && matchesRoute(pathname, t.href),
  );
  if (tool) {
    const parentRow = DASHBOARD_NAV_ITEMS.find((item) =>
      item.activeFor?.some((href) => matchesRoute(pathname, href)),
    );
    return parentRow && isNavItemVisible(parentRow)
      ? {
          title: tool.label,
          // Back to the module page the tool is opened from (#4073), not
          // to the top of Chapter settings.
          parent: {
            label: parentRow.label,
            href: `${parentRow.href}?tab=${tool.page}`,
          },
        }
      : { title: tool.label };
  }

  const navItem = DASHBOARD_NAV_ITEMS.find((item) =>
    matchesRoute(pathname, item.href),
  );
  const subPage =
    Object.entries(SUB_PAGE_TITLES).find(([href]) =>
      matchesRoute(pathname, href),
    ) ??
    Object.entries(RECORD_PAGE_TITLES).find(
      ([prefix]) =>
        pathname.startsWith(prefix) && pathname.length > prefix.length,
    );
  if (navItem && subPage) {
    return isNavItemVisible(navItem)
      ? {
          title: subPage[1],
          parent: { label: navItem.label, href: navItem.href },
        }
      : { title: subPage[1] };
  }
  if (navItem) return { title: navItem.label };

  const offNav = Object.entries(OFF_NAV_TITLES).find(([href]) =>
    matchesRoute(pathname, href),
  );
  if (offNav) return { title: offNav[1] };

  return null;
}
