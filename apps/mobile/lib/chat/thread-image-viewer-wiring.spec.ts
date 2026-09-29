import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Where the thread screen draws the image viewer (#2874).
 *
 * The viewer is an overlay in the screen's own tree, not a React Native
 * `Modal` (`spec/ui/mobile/patterns.md` § Overlays), so where the screen puts
 * it decides whether it is on top and takes the taps. The component spec
 * can't see that, and until the thread screen is rendered under test (#2705)
 * this reads the source, as `thread-mute-menu-wiring.spec.ts` does.
 */
const MOBILE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const THREAD = readFileSync(
  join(MOBILE_ROOT, "app/(tabs)/chat-thread.tsx"),
  "utf8",
);

describe("chat thread image viewer wiring", () => {
  it("draws the viewer as the screen's last child, above the thread and the mute menu", () => {
    expect(THREAD).toMatch(
      /<ImageViewer viewer=\{imageViewer\} \/>\s*<\/SafeAreaView>/,
    );
    expect(THREAD.indexOf("<ImageViewer ")).toBeGreaterThan(
      THREAD.indexOf("<NotificationLevelMenu"),
    );
  });

  it("gives the message rows the viewer's opener", () => {
    const provider = THREAD.indexOf(
      "<ImageViewerContext.Provider value={imageViewer.open}>",
    );
    // The element, not the `FlatList<ThreadRow>` type argument above it.
    const list = THREAD.search(/<FlatList\s+ref=/);
    const providerEnd = THREAD.indexOf("</ImageViewerContext.Provider>");
    expect(provider).toBeGreaterThan(-1);
    expect(provider).toBeLessThan(list);
    expect(providerEnd).toBeGreaterThan(list);
  });

  it("hides everything it covers from accessibility while it is open", () => {
    expect(THREAD).toMatch(
      /<KeyboardAvoidingView[^>]*collapsable=\{false\}\s+accessibilityElementsHidden=\{imageViewerOpen\}\s+importantForAccessibility=\{\s*imageViewerOpen \? "no-hide-descendants" : "auto"\s*\}\s*>/s,
    );
  });

  it("closes on a blur or a channel switch, so it can't come back over another thread", () => {
    expect(THREAD).toMatch(
      /return \(\) => closeImageViewer\(\);\s*\}, \[channelId, closeImageViewer\]\)/,
    );
  });
});
