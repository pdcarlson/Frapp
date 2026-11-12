import Link from "next/link";
import { cn } from "@/lib/utils";
import { EYEBROW } from "@/components/ui/typography";
import { FOCUS_RING } from "@/components/ui/focus";

/**
 * A settings rail row that is a link, in a container-sized rail
 * (`SettingsNavRail`). Board `4d`'s row geometry
 * (`height:34px;border-radius:10px;padding:0 10px`), with the nav's hover
 * step. `pointer-coarse` keeps the 44px touch floor where the rail wraps into
 * chips on a phone.
 */
const RAIL_NAV_LINK_CLASS = cn(
  "flex h-[34px] items-center rounded-[10px] px-[10px] text-sm text-muted-foreground transition hover:bg-card hover:text-foreground pointer-coarse:h-11 @3xl:w-full",
  FOCUS_RING,
);

/**
 * The open row: the chapter-accent chip the Chapter settings rail's active tab
 * wears (`settings-rail.tsx` says why it is `--accent-subtle`, not the Ask
 * pill's gold).
 */
const RAIL_LINK_CURRENT_CLASS =
  "bg-accent-subtle font-semibold text-accent-text hover:bg-accent-subtle hover:text-accent-text";

export type SettingsNavGroup = {
  /** The group's eyebrow, such as "My account". */
  label: string;
  items: readonly { value: string; label: string; href: string }[];
};

/**
 * A grouped settings rail whose rows are links, one page per row.
 *
 * Links, not tabs: each row has its own address (`?section=`), so a row can be
 * linked to from anywhere and the browser's Back button moves between them.
 * The open row carries `aria-current="page"`.
 *
 * The rail answers to its container, not the window (`@3xl`, 768px): the page
 * that draws it wraps it in `@container`. A tool page shares the window with
 * chat (#3779), so at a 1440px window its pane can be 480px wide, where a
 * 200px rail leaves the section about 210px. Below the container width each
 * group wraps into a row of chips under its eyebrow, above the section.
 */
export function SettingsNavRail({
  label,
  groups,
  current,
}: {
  /** The accessible name of the rail, such as "Settings". */
  label: string;
  groups: readonly SettingsNavGroup[];
  current: string;
}) {
  return (
    <nav
      aria-label={label}
      className="flex w-full flex-col gap-3 @3xl:w-[200px] @3xl:shrink-0 @3xl:self-stretch @3xl:border-r @3xl:border-border @3xl:px-2 @3xl:py-3"
    >
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5">
          <p className={cn(EYEBROW, "px-[10px] pb-1 text-muted")}>
            {group.label}
          </p>
          <div className="flex flex-row flex-wrap gap-0.5 @3xl:flex-col">
            {group.items.map((item) => (
              <Link
                key={item.value}
                href={item.href}
                aria-current={item.value === current ? "page" : undefined}
                className={cn(
                  RAIL_NAV_LINK_CLASS,
                  item.value === current && RAIL_LINK_CURRENT_CLASS,
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}
