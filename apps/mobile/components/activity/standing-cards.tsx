import { useCallback, useEffect, useRef } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  useActivityRecap,
  useActivityStanding,
  useNowDate,
  type ActivityStandingSection,
} from "@repo/hooks";
import { RecapCard, recapDismissal } from "./recap-card";
import {
  SemesterStrip,
  SemesterStripSkeleton,
  type StandingDestination,
} from "./semester-strip";

/**
 * Last week and This semester on the You tab, under Status (#5779, Paul's
 * direction A, 2026-11-20): they say how the member is standing, not what
 * they owe, so they left Activity for the member's own screen, beside the
 * points in its title row. Web's twin is
 * `apps/web/components/activity/standing-cards.tsx`, on the profile. Each is
 * its own read, and a part whose read fails or has nothing to say draws
 * nothing.
 *
 * - Last week (`RecapCard`): Sunday to Tuesday only, until dismissed (#4983).
 * - This semester (`SemesterStrip`): up to four gauges, each opening the
 *   screen that owns its number, less any number You already shows (`omit`:
 *   its points in the title row, its Study and Service rows), so the screen
 *   says each once.
 *
 * A tab is never unmounted, so the standing is read again each time the
 * member comes back to You (a check-in elsewhere moves its numbers), as
 * Activity read it on each return while it drew the gauges.
 */
export function StandingCards({
  omit,
}: {
  omit?: readonly ActivityStandingSection[];
} = {}) {
  const router = useRouter();
  const standing = useActivityStanding();
  // Last week reads nothing outside Sunday to Tuesday.
  const recap = useActivityRecap();
  const now = useNowDate();
  // Read the stored dismissals now, well before the recap lands, so a card
  // the member closed isn't drawn for a frame first.
  useEffect(() => {
    void recapDismissal.hydrate();
  }, []);
  // On each return, not the first visit: the query reads on mount itself.
  const refetchStanding = standing.refetch;
  const mounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (mounted.current) void refetchStanding();
      mounted.current = true;
      return undefined;
    }, [refetchStanding]),
  );
  // Every destination is a pushed screen: the task board since #4610, and
  // Calendar (the `events` route) since #5310.
  const openStanding = (destination: StandingDestination) => {
    router.push(destination);
  };

  // Two of the screen's own blocks, spaced by its gap: a part that draws
  // nothing leaves no space behind.
  return (
    <>
      {recap.data ? <RecapCard recap={recap.data} now={now} /> : null}
      {standing.isPending ? (
        <SemesterStripSkeleton />
      ) : standing.data ? (
        <SemesterStrip
          standing={standing.data}
          onOpen={openStanding}
          omit={omit}
        />
      ) : null}
    </>
  );
}
