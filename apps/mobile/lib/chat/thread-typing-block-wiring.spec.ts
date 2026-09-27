import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The thread's typing indicator runs through the viewer's block list (#2496).
 *
 * A blocked member's `typing` broadcast still reaches the manager, and in a
 * two-person DM "Someone is typing…" would tell the blocker that the member
 * they blocked is writing to them. `visibleTypingUsers` in
 * `@repo/chat-core/blocks` drops them (its own tests, and the manager test in
 * `realtime-manager.spec.ts`, prove the rule). What those can't see is whether
 * this screen applies it, so until the thread screen is rendered under test
 * (#2705), this reads the source the way `thread-identity-gate.spec.ts` does.
 */
const MOBILE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const THREAD = readFileSync(
  join(MOBILE_ROOT, "app/(tabs)/chat-thread.tsx"),
  "utf8",
);

describe("chat thread typing indicator after the block list (#2496)", () => {
  it("filters the manager's typists against the thread's block state", () => {
    expect(THREAD).toMatch(
      /const shownTypingUsers = visibleTypingUsers\(\s*typingUsers,\s*blockState,\s*viewerId,?\s*\);/,
    );
  });

  it("draws the indicator from the filtered list only", () => {
    const start = THREAD.indexOf("{shownTypingUsers.length > 0 ? (");
    expect(start).toBeGreaterThan(-1);
    const indicator = THREAD.slice(start, THREAD.indexOf(") : null}", start));
    expect(indicator).toMatch(/Someone is typing…/);
    // Nothing in the screen may read the unfiltered list's length, the
    // indicator included (`shownTypingUsers` is capitalised, so it can't match).
    expect(THREAD).not.toMatch(/\btypingUsers\.length/);
  });
});
