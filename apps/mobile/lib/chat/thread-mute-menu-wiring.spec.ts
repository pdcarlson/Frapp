import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Where the thread screen draws the mute menu (#2033).
 *
 * The menu used to hang off the header as an absolute child that overflowed
 * it, with `zIndex` on the header to keep it painted. It drew over the
 * inverted message list, but React Native hit-tested the list's frame, so
 * every option tap landed on a thread row and the level never changed. The
 * component spec pins the menu's own structure. What it can't see is where the
 * screen puts it, and a screen has no render harness yet (#2416), so this reads
 * the source, the way `lib/more/service-entry-scoping.spec.ts` does.
 */
const MOBILE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const THREAD = readFileSync(
  join(MOBILE_ROOT, "app/(tabs)/chat-thread.tsx"),
  "utf8",
);

describe("chat thread mute menu wiring", () => {
  it("draws the menu as the last child of the container that holds the list", () => {
    // Nothing may follow it before the container closes: a later sibling
    // would be above it in hit-testing, which is the bug.
    expect(THREAD).toMatch(
      /<NotificationLevelMenu\b[^<]*?\/>\s*<\/KeyboardAvoidingView>/s,
    );
    const list = THREAD.indexOf("<FlatList");
    const composer = THREAD.indexOf("<ChatComposer");
    const menu = THREAD.indexOf("<NotificationLevelMenu");
    expect(list).toBeGreaterThan(-1);
    expect(composer).toBeGreaterThan(-1);
    expect(menu).toBeGreaterThan(list);
    expect(menu).toBeGreaterThan(composer);
  });

  it("keeps only the trigger in the header", () => {
    const headerStart = THREAD.indexOf("style={styles.header}");
    const headerEnd = THREAD.indexOf("</View>", headerStart);
    const header = THREAD.slice(headerStart, headerEnd);
    expect(header).toContain("<NotificationLevelControl");
    expect(header).not.toContain("<NotificationLevelMenu");
  });

  it("hangs the menu from the measured trigger, not a restated header padding", () => {
    const element = THREAD.slice(
      THREAD.indexOf("<NotificationLevelMenu"),
      THREAD.indexOf("</KeyboardAvoidingView>"),
    );
    expect(element).toMatch(
      /right:\s*Math\.max\(0,\s*headerFrame\.width - muteTriggerRight\)/,
    );
    expect(element).not.toMatch(/right:\s*tokens\./);
    expect(THREAD).toMatch(
      /<NotificationLevelControl\s+menu=\{muteMenu\}\s+onLayout=/,
    );
  });

  it("drops the overflow half-measure from the header style", () => {
    const style = THREAD.slice(
      THREAD.indexOf("    header: {"),
      THREAD.indexOf("    backChevron: {"),
    );
    expect(style).not.toMatch(/overflow:\s*"visible"/);
    expect(style).not.toMatch(/zIndex/);
  });

  it("closes the menu when the screen blurs or switches channel", () => {
    // The screen stays mounted across both, and the open overlay takes every
    // tap on it, so a menu left open would swallow the next thread's taps.
    expect(THREAD).toMatch(
      /useFocusEffect\(\s*useCallback\(\(\) => \{\s*if \(!channelId\) return;\s*return \(\) => closeMuteMenu\(\);\s*\}, \[channelId, closeMuteMenu\]\)/s,
    );
  });
});
