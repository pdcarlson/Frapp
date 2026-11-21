"use client";

import {
  useActivityRecap,
  useActivityStanding,
  useNowDate,
  type ActivityStandingSection,
} from "@repo/hooks";
import { RecapCard } from "./recap-card";
import { SemesterStrip, SemesterStripSkeleton } from "./semester-strip";

/**
 * Last week and This semester on the member's own profile, beside Points
 * (#5779, Paul's direction A, 2026-11-20): they say how the member is
 * standing, not what they owe, so they left Activity for here. Each is its
 * own read, and a part whose read fails or has nothing to say draws nothing.
 *
 * - Last week (`RecapCard`): Sunday to Tuesday only, until dismissed (#4983).
 * - This semester (`SemesterStrip`): up to four gauges, less any number the
 *   profile already shows (`omit`: its Points and Service hours), so the
 *   page says each once.
 */
export function StandingCards({
  omit,
}: {
  omit?: readonly ActivityStandingSection[];
} = {}) {
  const standing = useActivityStanding();
  // Last week reads nothing outside Sunday to Tuesday.
  const recap = useActivityRecap();
  const now = useNowDate();
  if (!standing.isPending && !standing.data && !recap.data) return null;
  return (
    <div className="space-y-4">
      {recap.data ? <RecapCard recap={recap.data} now={now} /> : null}
      {standing.isPending ? (
        <SemesterStripSkeleton />
      ) : standing.data ? (
        <SemesterStrip standing={standing.data} omit={omit} />
      ) : null}
    </div>
  );
}
