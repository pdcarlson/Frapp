import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Which screens read the shared ticking clock (#2101).
 *
 * These screens bucket rows or resolve a check-in window by "now", and none of
 * them unmounts once opened, so a `new Date()` captured at mount freezes them:
 * Events kept a window closed that had opened, and a TODAY/EARLIER split would
 * stay on the day the app was opened. `lib/events/events-screen.spec.tsx`
 * renders Events against the real clock; the others have no render harness
 * yet (#2416), so this reads the source, the way
 * `lib/chat/thread-mute-menu-wiring.spec.ts` does.
 */
const TICKING = [
  "app/(tabs)/events.tsx",
  "app/(tabs)/event-details.tsx",
  "app/(tabs)/more.tsx",
  "app/(tabs)/notifications.tsx",
];

describe("screens that read the shared clock", () => {
  it.each(TICKING)("%s takes now from useNowDate", (file) => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    expect(source).toMatch(/\bconst now = useNowDate\(\);/);
    // A second clock beside it would be the parallel path this replaced.
    expect(source).not.toMatch(/useMemo\(\s*\(\)\s*=>\s*new Date\(\)/);
    expect(source).not.toMatch(/useState\(\s*\(\)\s*=>\s*new Date\(\)\s*\)/);
  });
});
