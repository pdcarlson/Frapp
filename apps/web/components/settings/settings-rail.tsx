"use client";

import Link from "next/link";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { EYEBROW } from "@/components/ui/typography";
import { FOCUS_RING } from "@/components/ui/focus";
import { RAIL_LINK_CLASS } from "@/components/settings/settings-nav-rail";
import { type SettingsTool } from "@/components/settings/settings-access";
import { InlineNote } from "@/components/shared/inline-note";

// Board `4d`: rail rows are `height:34px;border-radius:10px;padding:0 10px`,
// inactive `#A9A399`, active a filled gold chip (`background:#2A2410;
// color:#F0CD5E;font-weight:600`) rather than the §6 2px edge indicator this
// rail used to run down its side.
//
// **The fill is the chapter accent, not `--gold-ask-*`.** The board paints the
// Ask pill and the active tab at the same hexes only because the demo tenant's
// seed and the house gold coincide — the trap `tokens.md` §L-01 names and
// `pro-chip.tsx` already refused once in this lane. Ask is fixed; a settings
// tab is product UI and retints.
//
// **`--accent-subtle`/`--accent-text` are that retinting family. Plain
// `--accent` was not**: it was a ShadCN alias of `--popover` (`#2A2621`), so
// `bg-accent` painted the active tab a dead grey on every chapter, gold
// included. The alias is deleted (#3036); `elevation-call-sites.spec.ts` keeps
// the name out.
//
// Below `lg` the rail is still a horizontal wrap row, so the chip reads the
// same either way — there is no underline variant to keep in sync any more.
/*
 * A rail row, not a tab: the shared `TabsTrigger` is the underlined tab, so
 * its 44px floor, its 2px underline and its `-mb-px` are taken back off
 * here. Without that the rows stood 44px apart under 34px tool links, and the
 * active chip carried an accent underline (2026-11-05). `pointer-coarse`
 * keeps the 44px touch floor where the rail wraps into chips on a phone.
 */
const RAIL_ROW_RESET =
  "mb-0 min-h-0 border-b-0 py-0 enabled:data-[state=active]:border-transparent pointer-coarse:min-h-11";

const RAIL_TRIGGER_CLASS = `${RAIL_ROW_RESET} h-[34px] justify-start rounded-[10px] px-[10px] text-sm text-muted-foreground enabled:hover:bg-card data-[state=active]:bg-accent-subtle data-[state=active]:font-semibold data-[state=active]:text-accent-text data-[state=active]:shadow-none enabled:data-[state=active]:text-accent-text lg:w-full lg:flex-none`;

/** The rail's groups, in order. */
export type SettingsTabGroup = "chapter" | "people" | "modules";

export const SETTINGS_TAB_GROUP_LABELS: Readonly<
  Record<SettingsTabGroup, string>
> = {
  chapter: "Chapter",
  people: "People",
  modules: "Modules",
};

export type SettingsTab = {
  value: string;
  label: string;
  group: SettingsTabGroup;
};

/*
  The rail, grouped (#3827, slice 5 of #4068): Chapter, People and Modules,
  the grouping the settings design settled (#4065). It used to be one flat
  list of eleven rows with Danger zone pushed to the bottom of a rail
  stretched to the panel's height (`lg:mt-auto`), so on a long tab it fell
  below the fold and moved every time the tab changed (#3713).

  - **Plan and billing is a Chapter row** (the second #3827 PR, decision 8 of
    #4068). It was the sidebar's Billing route; `/billing` now redirects here
    for `billing:view` holders. **Danger zone is gone**: all it held was a
    second Stripe portal button and the closing-the-chapter note, and both are
    the last section of Plan and billing now, where a president looking for
    "cancel" goes. `?tab=danger` lands there (`SETTINGS_TAB_ALIASES`).

  - **Accent is not a row any more.** It is a section of Chapter, under the
    chapter mark: both decide how the chapter looks. `?tab=theme` still lands
    there (`SETTINGS_TAB_ALIASES`).
  - **No `joincode`.** The board `4d` rail drew it; `apps/web` has no
    join-code surface. The board's `subscription` row is Plan and billing.
  - **`dues`, `workflows` and `classes` are ours.** Each is live chapter
    configuration with no other home. `classes` takes the chapter's own word
    for a class, which the page sets.

  `beta` and `audit` are gone rather than reordered. They rendered
  `SettingsComingSoon` stubs naming "Chunk 08", generated chrome advertising
  unbuilt work.
*/
export const SETTINGS_TABS: readonly SettingsTab[] = [
  { value: "org", label: "Chapter", group: "chapter" },
  { value: "semester", label: "Semester", group: "chapter" },
  { value: "privacy", label: "Privacy", group: "chapter" },
  { value: "billing", label: "Plan and billing", group: "chapter" },
  { value: "roles", label: "Roles", group: "people" },
  { value: "classes", label: "Pledge class", group: "people" },
  { value: "fields", label: "Member fields", group: "people" },
  { value: "modules", label: "Modules", group: "modules" },
  { value: "dues", label: "Dues", group: "modules" },
  { value: "workflows", label: "Workflows", group: "modules" },
];

/**
 * Old `?tab=` values that now open another row: Accent folded into Chapter,
 * and Danger zone into Plan and billing. Old links and bookmarks keep working.
 */
export const SETTINGS_TAB_ALIASES: Readonly<Record<string, string>> = {
  theme: "org",
  danger: "billing",
};

/** Resolves a `?tab=` value to a row, or `null` when it names none. */
export function resolveSettingsTabParam(
  param: string | null | undefined,
): string | null {
  if (!param) return null;
  const value = SETTINGS_TAB_ALIASES[param] ?? param;
  return SETTINGS_TABS.some((tab) => tab.value === value) ? value : null;
}

// The officer tools (`settings-access.ts`) are links, not tabs: each keeps its
// own full-width page, so they take the link row (`RAIL_LINK_CLASS`), since
// clicking one leaves this page rather than switching a tab.

/**
 * The left rail: officer-tool links, then the setup rows in their groups.
 * Renders inside the page's `<Tabs>`, since its lists drive the
 * panels beside it.
 *
 * **Sticky, at a fixed width.** The page scrolls inside the shell's tool pane,
 * and the rail stays where it is while a long section (Roles, Chapter) scrolls
 * under it, the way Discord's and Slack's settings rails do. It scrolls on its
 * own only on a window too short to hold it.
 */
export function SettingsRail({
  tools,
  visibleTabs,
}: {
  tools: readonly SettingsTool[];
  visibleTabs: readonly SettingsTab[];
}) {
  const groups = (Object.keys(SETTINGS_TAB_GROUP_LABELS) as SettingsTabGroup[])
    .map((group) => ({
      group,
      label: SETTINGS_TAB_GROUP_LABELS[group],
      tabs: visibleTabs.filter((tab) => tab.group === group),
    }))
    .filter((entry) => entry.tabs.length > 0);
  return (
    <div className="flex w-full flex-col gap-4 lg:sticky lg:top-0 lg:max-h-[calc(100dvh-7rem)] lg:w-[200px] lg:shrink-0 lg:self-start lg:overflow-y-auto lg:py-1">
      {tools.length > 0 ? (
        <nav aria-label="Officer tools" className="flex flex-col gap-0.5">
          <p className={cn(EYEBROW, "px-[10px] pb-1 text-muted")}>Tools</p>
          <div className="flex flex-row flex-wrap gap-0.5 lg:flex-col">
            {tools.map((tool) => (
              <Link key={tool.id} href={tool.href} className={RAIL_LINK_CLASS}>
                {tool.label}
              </Link>
            ))}
          </div>
        </nav>
      ) : null}
      {groups.map((entry) => (
        <div key={entry.group} className="flex flex-col gap-0.5">
          <p
            id={`settings-rail-${entry.group}`}
            className={cn(EYEBROW, "px-[10px] pb-1 text-muted")}
          >
            {entry.label}
          </p>
          <TabsList
            aria-labelledby={`settings-rail-${entry.group}`}
            className="flex h-auto w-full flex-row flex-wrap justify-start gap-0.5 border-b-0 bg-transparent p-0 lg:flex-col lg:flex-nowrap lg:items-stretch"
          >
            {entry.tabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className={RAIL_TRIGGER_CLASS}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      ))}
    </div>
  );
}

/**
 * Settings for a viewer who holds officer tools but no setup tabs, such as a
 * treasurer with `reports:export`. A rail of one link beside an empty panel
 * would be a page that says nothing, so the tools are listed as the page
 * itself. With no tools either, the viewer reached this URL with nothing to do
 * here, and the empty state says who can change that.
 */
export function SettingsToolsOnly({
  tools,
}: {
  tools: readonly SettingsTool[];
}) {
  if (tools.length === 0) {
    return (
      <InlineNote>
        Nothing in Settings for your role. Officer tools come with an officer
        role; ask your chapter president if you need one.
      </InlineNote>
    );
  }
  return (
    <nav aria-label="Officer tools" className="space-y-2">
      <p className={cn(EYEBROW, "text-muted")}>Tools</p>
      <ul className="divide-y divide-border rounded-[14px] border border-border bg-card">
        {tools.map((tool) => (
          <li key={tool.id} className="group">
            <Link
              href={tool.href}
              className={cn(
                // A row in a card list hovers like a table row
                // (`ui/table.tsx`): `--card-hover`, the step above the whole
                // ladder, where `bg-accent`, the elevated step, moved 1.105:1. The end rows
                // take the list's inner radius (14px less its 1px border) so
                // the visible tint stays inside its corners; clipping the list
                // with `overflow-hidden` instead would clip the focus ring too.
                "flex flex-col gap-0.5 px-4 py-3 transition hover:bg-card-hover",
                "group-first:rounded-t-[13px] group-last:rounded-b-[13px]",
                FOCUS_RING,
              )}
            >
              <span className="text-sm font-semibold text-foreground">
                {tool.label}
              </span>
              <span className="text-caption text-muted-foreground">
                {tool.description}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
