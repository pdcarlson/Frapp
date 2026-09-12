"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NestedLoading } from "@/components/shared/nested-states";
import { PageHeader } from "@/components/layout/page-header";
import { MembersDirectory } from "@/components/members/members-directory";
import { AlumniDirectory } from "@/components/alumni/alumni-directory";

/**
 * Actives and alumni, one surface, two tabs.
 *
 * These shipped as two sidebar rows pointing at two routes, which asked every
 * member to know in advance which list a person was on before they could look
 * them up. They are one directory, so they are one screen; the nav collapses to
 * a single Directory row.
 *
 * `/alumni` still resolves — it redirects here with `?tab=alumni`, the same
 * shape `/roles` uses to reach Settings → Roles — so existing links and
 * bookmarks keep working.
 *
 * **The tab row stays the underline treatment, and that is a derivation rather
 * than an oversight.** The framework board draws no horizontal tab bar at all
 * (`grep -c 'border-bottom:2px'` over it returns 0); its two tab shapes are
 * `4d`'s 200px left rail, which is for a settings page with six sections, and
 * `1f`'s 34px segmented Calendar/List *view toggle*, which switches two
 * renderings of one dataset. Actives and alumni are two different datasets
 * behind two different queries, so neither board shape is about this control.
 * Where the board is silent the trust order falls through to
 * [`components.md`](../../../../spec/ui/design-system/components.md) §6, which
 * is explicit — "underline style only, no segmented pill controls" — and which
 * the primitives slice already applied here by deleting a segmented rail. A
 * greenfield lane re-adding that rail would be reversing a decision on the
 * strength of a frame that is not about it.
 */
const DIRECTORY_TAB_VALUES: readonly string[] = ["members", "alumni"];

const DEFAULT_TAB = "members";

function DirectoryPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");

  // The URL is the tab, rather than a seed for local state that then drifts
  // from it. `/alumni` is now the only legacy entry point into the alumni list
  // and it arrives as a redirect to `?tab=alumni`; with the tab held in state
  // and synced by an effect keyed on the param, a member who had since clicked
  // "Actives" would land on Actives every subsequent time they followed an
  // `/alumni` link — the param never changed value, so the effect never ran.
  const activeTab =
    tabParam && DIRECTORY_TAB_VALUES.includes(tabParam)
      ? tabParam
      : DEFAULT_TAB;

  function selectTab(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    // `replace`, not `push`: flipping a tab is not a navigation a member
    // expects the back button to unwind one step at a time.
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={activeTab} onValueChange={selectTab}>
      <TabsList>
        <TabsTrigger value="members">Actives</TabsTrigger>
        <TabsTrigger value="alumni">Alumni</TabsTrigger>
      </TabsList>
      {/*
        `mt-3` rather than the primitive's `mt-4`: the board's page body stacks
        at 12px (`1f`'s `<main ... gap:12px>`), and the tab row is page chrome
        sitting directly above the list it switches.
      */}
      <TabsContent value="members" className="mt-3">
        <MembersDirectory />
      </TabsContent>
      <TabsContent value="alumni" className="mt-3">
        <AlumniDirectory />
      </TabsContent>
    </Tabs>
  );
}

// `DirectoryPageContent` reads `?tab=` via `useSearchParams`, which Next
// requires to sit under a Suspense boundary (matches the settings page).
export function DirectoryPage() {
  return (
    <div className="space-y-6">
      {/*
        Outside the Suspense boundary so the heading is there on the pending
        path too — the shell no longer supplies one (#2141), and `PageHeader`'s
        own contract is that a route renders it on every path it can take.

        **No `actions` here, and that is a decision rather than an omission.**
        `1f` pin 2 puts a route's primary action in this row, and lane 4 duly
        put `/documents`' Upload in it — behind `<Can permission="…">`. This
        route has no `<Can>` anywhere; the only client mirror of `members:view`
        is the sidebar entry in `components/layout/nav-config.ts`. Adding one is
        a permission read, which is behavior rather than chrome, so it is filed
        as [#2170](https://github.com/pdcarlson/Frapp/issues/2170) rather than
        taken here.

        Invite therefore sits in the actives list's own toolbar row. **That
        narrows a problem rather than solving it, and the distinction matters:**
        `InviteMemberDialog` calls `useInvites()` unconditionally on mount, and
        `GET /v1/invites` is gated on `members:invite` — so a member without it
        still fires a guaranteed 403 whenever they open the default tab. What
        this placement buys is that the 403 is not *widened* to the Alumni tab
        and to the loading, error and offline paths, which is where mounting
        Invite in an unguarded `PageHeader` would put it. #2170 carries the
        actual fix (gate the hook, gate the control). It is also the more honest
        home regardless: you invite people onto the roster, and the alumni tab
        has no invite.
      */}
      <PageHeader title="Directory" />
      {/*
        The nested loading state, not the whole-screen one, for the reason
        `members-directory.tsx` spells out at its own import: the whole-screen
        family paints `--card`, and this route has no cards left. `sole` because
        while this fallback is up it is the only async state on the page, so it
        needs the live region the nested variant leaves off by default.
      */}
      <Suspense
        fallback={<NestedLoading sole message="Loading directory..." />}
      >
        <DirectoryPageContent />
      </Suspense>
    </div>
  );
}
