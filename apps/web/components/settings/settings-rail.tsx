"use client";

import Link from "next/link";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/async-states";
import { cn } from "@/lib/utils";
import { EYEBROW } from "@/components/ui/typography";
import { FOCUS_RING } from "@/components/ui/focus";
import { type SettingsTool } from "@/components/settings/settings-access";

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
const RAIL_TRIGGER_CLASS =
  "h-[34px] justify-start rounded-[10px] px-[10px] text-sm text-muted-foreground data-[state=active]:bg-accent-subtle data-[state=active]:font-semibold data-[state=active]:text-accent-text data-[state=active]:shadow-none lg:w-full lg:flex-none";

const RAIL_DANGER_TRIGGER_CLASS =
  "h-[34px] justify-start rounded-[10px] px-[10px] text-sm text-destructive data-[state=active]:bg-destructive-tint data-[state=active]:font-semibold data-[state=active]:text-destructive-text data-[state=active]:shadow-none lg:mt-auto lg:w-full lg:flex-none";

// Valid `?tab=` deep-link targets — mirrors the rail triggers below.
//
// Order is board `4d`'s: Chapter, Accent, Subscription, Modules, Roles, Join
// code, Semester, Fields, Privacy, then Danger zone pinned last. Three
// departures, each forced by what this product actually has:
//
// - **No `joincode`.** The board draws a Join code tab. `apps/web` has no
//   join-code surface at all — a repo-wide grep for `join_code`, `joinCode`
//   and `invite_code` returns nothing outside the API SDK. Building one is a
//   capability, and this lane is chrome (`spec/ui/web-dashboard/README.md`
//   § Settings).
// - **No `subscription`.** The board puts plan status behind this rail, but
//   `/billing` is a route a member reaches to pay their own invoice — see the
//   note in `billing-page.tsx`, which is why `4d`'s "Members never see this
//   page" was already refused there. A tab would hide it from the members it
//   is for. `/billing` stays a route; Danger zone links to the Stripe portal.
// - **`dues` and `workflows` are ours.** The board draws neither. Both are
//   live chapter configuration with no other home, so they keep rail entries,
//   slotted after Fields where the board's own knob tabs sit.
//
// `beta` and `audit` are gone rather than reordered. They rendered
// `SettingsComingSoon` stubs naming "Chunk 08" — generated chrome advertising
// unbuilt work, which is exactly what this epic deletes.
export const SETTINGS_TABS: readonly { value: string; label: string }[] = [
  { value: "org", label: "Chapter" },
  { value: "theme", label: "Accent" },
  { value: "modules", label: "Modules" },
  { value: "roles", label: "Roles" },
  { value: "semester", label: "Semester" },
  { value: "fields", label: "Fields" },
  { value: "dues", label: "Dues" },
  { value: "workflows", label: "Workflows" },
  { value: "privacy", label: "Privacy" },
  { value: "danger", label: "Danger zone" },
];
export const SETTINGS_TAB_VALUES: readonly string[] = SETTINGS_TABS.map(
  (tab) => tab.value,
);

// The officer tools (`settings-access.ts`) are links, not tabs: each keeps its
// own full-width page. Same row geometry as a rail trigger, with the nav's
// hover step, since clicking one leaves this page rather than switching a tab.
const RAIL_LINK_CLASS = cn(
  "flex h-[34px] items-center rounded-[10px] px-[10px] text-sm text-muted-foreground transition hover:bg-card hover:text-foreground lg:w-full",
  FOCUS_RING,
);

/**
 * The left rail: officer-tool links above the setup tabs. Renders inside the
 * page's `<Tabs>`, since its `TabsList` drives the panels beside it.
 */
export function SettingsRail({
  tools,
  visibleTabs,
}: {
  tools: readonly SettingsTool[];
  visibleTabs: readonly { value: string; label: string }[];
}) {
  return (
    /*
      Board `4d`: `width:200px`, `padding:12px 8px`, `gap:2px`, a right
      hairline. `lg:w-[200px]` is that width exactly rather than the `w-56`
      (224px) this rail used to take.

      The officer tools sit above the tabs (#2946). They were the nav's
      Admin group until it folded into Settings, and they are what an
      officer comes here for most often; setup is occasional.
    */
    <div className="flex w-full flex-col gap-3 lg:w-[200px] lg:self-stretch lg:border-r lg:border-border lg:px-2 lg:py-3">
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
      {tools.length > 0 ? (
        <p className={cn(EYEBROW, "px-[10px] pb-1 text-muted lg:mt-2")}>
          Chapter setup
        </p>
      ) : null}
      <TabsList
        aria-label="Chapter setup"
        className="flex h-auto w-full flex-row flex-wrap justify-start gap-0.5 bg-transparent p-0 lg:flex-1 lg:flex-col lg:flex-nowrap lg:items-stretch"
      >
        {visibleTabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className={
              tab.value === "danger"
                ? RAIL_DANGER_TRIGGER_CLASS
                : RAIL_TRIGGER_CLASS
            }
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
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
      <EmptyState
        title="Nothing in Settings for your role"
        description="Chapter setup and officer tools come with an officer role. Ask your chapter president if you need one."
      />
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
                // (`ui/table.tsx`): the accent tint, which moves hue where
                // `bg-accent`, the elevated step, moved 1.105:1. The end rows
                // take the list's inner radius (14px less its 1px border) so
                // the visible tint stays inside its corners; clipping the list
                // with `overflow-hidden` instead would clip the focus ring too.
                "flex flex-col gap-0.5 px-4 py-3 transition hover:bg-accent-subtle",
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
