"use client";

import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { EYEBROW } from "@/components/ui/typography";
import { MODULE_SETTINGS } from "@/components/settings/settings-modules";
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
  /** A module row whose module the chapter has switched off. */
  off?: boolean;
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
  - **One row per module** (#4073). The Modules group used to be three rows:
    a Modules list of switches whose ~50 sub-feature labels saved nothing
    (#1760), Dues, and a Workflows list where seven of nine switches were read
    by nothing (#3439). Each module now opens its own page
    (`MODULE_SETTINGS`), and the live workflows moved onto theirs.
  - **`classes` is ours**, live chapter configuration with no other home. It
    takes the chapter's own word for a class, which the page sets.

  `beta` and `audit` are gone rather than reordered. They rendered
  `SettingsComingSoon` stubs naming "Chunk 08", generated chrome advertising
  unbuilt work.
*/
export const SETTINGS_TABS: readonly SettingsTab[] = [
  { value: "org", label: "Chapter", group: "chapter" },
  { value: "semester", label: "Semester", group: "chapter" },
  { value: "privacy", label: "Privacy", group: "chapter" },
  /*
    The president's AI switches (#4308). Only while the server has AI: the
    page drops the row when `useAiConsent` answers `null` (`AI_ENABLED` off),
    so with AI off the rail is what it was.
  */
  { value: "ai", label: "AI", group: "chapter" },
  { value: "billing", label: "Plan and billing", group: "chapter" },
  { value: "roles", label: "Roles", group: "people" },
  { value: "classes", label: "Pledge class", group: "people" },
  { value: "fields", label: "Member fields", group: "people" },
  ...MODULE_SETTINGS.map((module): SettingsTab => ({
    value: module.key,
    label: module.label,
    group: "modules",
  })),
];

/**
 * Old `?tab=` values that now open another row: Accent folded into Chapter,
 * Danger zone into Plan and billing, the Modules list into the module pages
 * (Events, the first one with a switch), and Workflows into Service hours,
 * where its one switch that is live for the beta went. Old links and
 * bookmarks keep working. `?tab=modules&module=<key>` opens that module's
 * page instead (`settings-page.tsx`).
 */
export const SETTINGS_TAB_ALIASES: Readonly<Record<string, string>> = {
  theme: "org",
  danger: "billing",
  modules: "events",
  workflows: "hours",
};

/** Resolves a `?tab=` value to a row, or `null` when it names none. */
export function resolveSettingsTabParam(
  param: string | null | undefined,
): string | null {
  if (!param) return null;
  const value = SETTINGS_TAB_ALIASES[param] ?? param;
  return SETTINGS_TABS.some((tab) => tab.value === value) ? value : null;
}

/**
 * The left rail: the setup rows in their groups. The officer tools that sat
 * above them as links are on their module's page now (#4073).
 * Renders inside the page's `<Tabs>`, since its lists drive the
 * panels beside it.
 *
 * **Sticky, at a fixed width.** The page scrolls inside the shell's tool pane,
 * and the rail stays where it is while a long section (Roles, Chapter) scrolls
 * under it, the way Discord's and Slack's settings rails do. It scrolls on its
 * own only on a window too short to hold it.
 */
export function SettingsRail({
  visibleTabs,
}: {
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
                <span className="min-w-0 truncate">{tab.label}</span>
                {tab.off ? (
                  <span className="ml-auto pl-2 text-caption font-normal text-muted">
                    Off
                  </span>
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      ))}
    </div>
  );
}

/**
 * Chapter settings for a viewer it holds nothing for: no setup row, and no
 * module page through a tool (a tool-only viewer, such as a treasurer with
 * `reports:export`, gets that tool's module page since #4073). They reached
 * this URL with nothing to do here, so it says who can change that.
 */
export function SettingsNothingHere() {
  return (
    <InlineNote>
      Nothing in Chapter settings for your role. Officer tools come with an
      officer role; ask your chapter president if you need one.
    </InlineNote>
  );
}
