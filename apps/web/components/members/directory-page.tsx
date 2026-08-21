"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LoadingState } from "@/components/shared/async-states";
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
    tabParam && DIRECTORY_TAB_VALUES.includes(tabParam) ? tabParam : DEFAULT_TAB;

  function selectTab(next: string) {
    const params = new URLSearchParams(searchParams);
    params.set("tab", next);
    // `replace`, not `push`: flipping a tab is not a navigation a member
    // expects the back button to unwind one step at a time.
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={activeTab} onValueChange={selectTab} className="space-y-6">
      <TabsList>
        <TabsTrigger value="members">Actives</TabsTrigger>
        <TabsTrigger value="alumni">Alumni</TabsTrigger>
      </TabsList>
      <TabsContent value="members" className="mt-0">
        <MembersDirectory />
      </TabsContent>
      <TabsContent value="alumni" className="mt-0">
        <AlumniDirectory />
      </TabsContent>
    </Tabs>
  );
}

// `DirectoryPageContent` reads `?tab=` via `useSearchParams`, which Next
// requires to sit under a Suspense boundary (matches the settings page).
export function DirectoryPage() {
  return (
    <Suspense fallback={<LoadingState message="Loading directory..." />}>
      <DirectoryPageContent />
    </Suspense>
  );
}
