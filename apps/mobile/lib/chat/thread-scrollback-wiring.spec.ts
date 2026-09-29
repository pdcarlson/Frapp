import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The thread's scrollback (#2772). The paging itself is `@repo/chat-core/history`,
 * whose suite pins the cursor and the merge; the hook's scrollback state is
 * pinned in `use-chat-channel.spec.tsx`, and `ThreadHistoryEdge` has its own
 * suite for the states it draws. What neither can see is whether this screen
 * asks for older pages when the member reaches the top, so until the thread
 * screen is rendered under test (#2705), this reads the source the way
 * `thread-identity-gate.spec.ts` does.
 */
const MOBILE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const THREAD = readFileSync(
  join(MOBILE_ROOT, "app/(tabs)/chat-thread.tsx"),
  "utf8",
);
const HOOK = readFileSync(
  join(MOBILE_ROOT, "lib/chat/use-chat-channel.ts"),
  "utf8",
);

describe("mobile thread scrollback (#2772)", () => {
  it("loads an older page when the inverted list reaches its end, the top", () => {
    const list = THREAD.slice(THREAD.indexOf("<FlatList"));
    expect(list).toMatch(/\binverted\b/);
    expect(list).toMatch(/onEndReached=\{handleEndReached\}/);
    expect(list).toMatch(/ListFooterComponent=\{historyEdge\}/);
  });

  it("asks only while older history may exist and no read is pending or failed", () => {
    expect(THREAD).toMatch(
      /if \(!hasOlder \|\| isLoadingOlder \|\| olderError\) return;\s*void loadOlder\(\);/,
    );
  });

  it("reads every page through the shared chat-core pager, not a local copy", () => {
    expect(HOOK).toMatch(/createHistoryPager\(/);
    expect(HOOK).toMatch(/pager\.readNewest\(channelId\)/);
    expect(HOOK).toMatch(/pager\.loadOlder\(channelId\)/);
    expect(HOOK).not.toMatch(/"\/v1\/channels\/\{id\}\/messages"/);
  });
});
