import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The thread withholds its rows until the viewer is known (#2250, the mobile
 * half of #2243).
 *
 * A row decides between the two bubble shapes by comparing `sender_id` with
 * the viewer. Messages can paint from React Query's cache while
 * `/v1/users/me` is still in flight, and a null viewer used to read every
 * message as incoming, so the member's own messages painted as someone
 * else's and their own reaction chips read as not theirs. The rows now take a
 * non-nullable `viewerId`, which typecheck enforces; what typecheck can't see
 * is that the screen gates the list on identity at all, rather than, say,
 * passing `viewerId ?? ""`. A screen has no render harness yet (#2416), so
 * this reads the source, the way `thread-mute-menu-wiring.spec.ts` does.
 */
const MOBILE_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const THREAD = readFileSync(
  join(MOBILE_ROOT, "app/(tabs)/chat-thread.tsx"),
  "utf8",
);
const ROW = readFileSync(
  join(MOBILE_ROOT, "components/chat/thread-message-row.tsx"),
  "utf8",
);
const QUOTE = readFileSync(
  join(MOBILE_ROOT, "components/chat/reply-quote.tsx"),
  "utf8",
);
const BUBBLE = readFileSync(
  join(MOBILE_ROOT, "components/chat/message-bubble.tsx"),
  "utf8",
);

/** The JSX from the "no channel" branch through the list, where the gate lives. */
function renderGate(): string {
  const start = THREAD.indexOf("{!channelId ? (");
  const end = THREAD.indexOf("<FlatList", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return THREAD.slice(start, end);
}

describe("chat thread identity gate (#2250)", () => {
  it("shows the loading state, not rows, while the viewer is unresolved", () => {
    expect(renderGate()).toMatch(/\) : isLoading \|\| !viewerId \? \(/);
  });

  it("offers a retry when /v1/users/me failed, before the loading branch", () => {
    const gate = renderGate();
    const failed = gate.indexOf("!viewerId && viewerQuery.isError ? (");
    const loading = gate.indexOf("isLoading || !viewerId ? (");
    expect(failed).toBeGreaterThan(-1);
    // A failed lookup is `null` too, so checked after the loading branch it
    // would spin forever with no way out.
    expect(failed).toBeLessThan(loading);
    expect(gate.slice(failed, loading)).toMatch(
      /onRetry=\{\(\) => void viewerQuery\.refetch\(\)\}/,
    );
  });

  it("shows a messages load failure rather than burying it behind the gate", () => {
    // Web's order (#2243): a read that failed while `/users/me` is still in
    // flight says so, instead of spinning until identity lands.
    const gate = renderGate();
    const loadError = gate.indexOf(") : loadError ? (");
    expect(loadError).toBeGreaterThan(-1);
    expect(loadError).toBeLessThan(
      gate.indexOf("!viewerId && viewerQuery.isError"),
    );
    expect(loadError).toBeLessThan(gate.indexOf("isLoading || !viewerId"));
  });

  it("never hands a row a null or placeholder viewer", () => {
    expect(THREAD).toMatch(/if \(!viewerId\) return null;/);
    expect(THREAD).not.toMatch(/viewerId=\{viewerId \?\?/);
    expect(THREAD).not.toMatch(/viewerId=\{viewerId \|\|/);
  });

  it("types the row surfaces' viewer as a resolved id", () => {
    expect(ROW).toMatch(/viewerId: string;/);
    expect(ROW).not.toMatch(
      /export interface ThreadMessageRowProps \{[^}]*viewerId: string \| null/s,
    );
    expect(QUOTE).not.toMatch(/viewerId: string \| null/);
    expect(BUBBLE).not.toMatch(/!!viewerId &&/);
    expect(BUBBLE).toMatch(/const isMine = message\.sender_id === viewerId;/);
  });
});
