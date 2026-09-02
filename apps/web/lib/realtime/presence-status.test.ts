import { describe, expect, test } from "vitest";
import {
  IDLE_AFTER_MS,
  PRESENCE_HEARTBEAT_MS,
  presenceLabel,
  presenceMapFrom,
  presenceStatusFor,
  presenceStatusKind,
  sameRoster,
  type PresenceStatus,
} from "./presence-status";
import { chapterPresenceTopic } from "./presence-topics";

const ALL_STATUSES: PresenceStatus[] = ["online", "idle", "offline"];

/**
 * These pin the spec's timing rules (`spec/behavior/chat/README.md` §
 * Online/offline presence) as executable assertions, so a future change to the
 * derivation has to argue with the spec rather than quietly drift from it.
 */
describe("presence timing constants match the spec", () => {
  test("Idle threshold is 5 minutes", () => {
    expect(IDLE_AFTER_MS).toBe(5 * 60 * 1000);
  });

  test("heartbeat is ~30 seconds", () => {
    expect(PRESENCE_HEARTBEAT_MS).toBe(30 * 1000);
  });
});

describe("presenceStatusFor", () => {
  const now = 1_700_000_000_000;

  test("absent from the presence map is Offline", () => {
    expect(presenceStatusFor(null, now)).toBe("offline");
    expect(presenceStatusFor(undefined, now)).toBe("offline");
  });

  test("present and recently active is Online", () => {
    expect(presenceStatusFor(now, now)).toBe("online");
    expect(presenceStatusFor(now - 1000, now)).toBe("online");
  });

  test("exactly at the threshold is still Online — the spec says >5 minutes", () => {
    expect(presenceStatusFor(now - IDLE_AFTER_MS, now)).toBe("online");
  });

  test("one millisecond past the threshold is Idle", () => {
    expect(presenceStatusFor(now - IDLE_AFTER_MS - 1, now)).toBe("idle");
  });

  /**
   * `0` is a real timestamp, not a sentinel. If a caller passed it for
   * "absent", this would read Idle — a member who is not connected at all
   * would render as app-open-but-inactive. The absence contract is `null`.
   */
  test("a zero timestamp is a stale time, not absence", () => {
    expect(presenceStatusFor(0, now)).toBe("idle");
  });

  test("a clock-skewed future timestamp reads Online, not Idle", () => {
    expect(presenceStatusFor(now + 60_000, now)).toBe("online");
  });
});

describe("presenceLabel", () => {
  test("labels are the words the spec uses, and are the accessible name", () => {
    expect(presenceLabel("online")).toBe("Online");
    expect(presenceLabel("idle")).toBe("Idle");
    expect(presenceLabel("offline")).toBe("Offline");
  });
});

describe("presenceMapFrom", () => {
  test("flattens presence keys into userId → ts", () => {
    const map = presenceMapFrom({
      a: [{ userId: "u1", ts: 10 }],
      b: [{ userId: "u2", ts: 20 }],
    });
    expect(map.get("u1")).toBe(10);
    expect(map.get("u2")).toBe(20);
  });

  /**
   * Two tabs, or one tab mid-reconnect where the old and new joins overlap.
   * Newest wins so "active in any tab" reads as active — an arbitrary tab
   * winning would show a member Idle while they are typing in another window.
   */
  test("takes the newest ts when one user appears more than once", () => {
    const map = presenceMapFrom({
      a: [{ userId: "u1", ts: 10 }],
      b: [{ userId: "u1", ts: 99 }],
      c: [{ userId: "u1", ts: 50 }],
    });
    expect(map.get("u1")).toBe(99);
    expect(map.size).toBe(1);
  });

  test("several entries under one key are all read", () => {
    const map = presenceMapFrom({
      a: [
        { userId: "u1", ts: 10 },
        { userId: "u2", ts: 20 },
      ],
    });
    expect(map.size).toBe(2);
  });

  /**
   * The channel is public, so an entry can carry anything. A malformed payload
   * must be skipped rather than trusted or thrown on — this runs inside a
   * React render pass, where a throw unmounts the surface.
   */
  test("skips malformed entries instead of throwing", () => {
    const map = presenceMapFrom({
      a: [
        null,
        undefined,
        "nope",
        42,
        {},
        { userId: "" , ts: 1 },
        { userId: "u1" },
        { userId: "u2", ts: "soon" },
        { userId: "u3", ts: Number.NaN },
        { userId: "u4", ts: Number.POSITIVE_INFINITY },
        { ts: 5 },
        { userId: "good", ts: 7 },
      ] as unknown[],
    });
    expect([...map.keys()]).toEqual(["good"]);
  });

  test("tolerates an empty or malformed state object", () => {
    expect(presenceMapFrom({}).size).toBe(0);
    expect(presenceMapFrom({ a: [] }).size).toBe(0);
    expect(
      presenceMapFrom({ a: "not-an-array" } as unknown as Record<string, never[]>)
        .size,
    ).toBe(0);
  });
});

/**
 * Presence is a domain status vocabulary like `poll-status.ts` and
 * `settings-status.ts`, and the invariant those share — pinned for them in
 * `components/shared/status-kind.test.ts` — is that **no domain status is ever
 * painted in the chapter accent**. #1202 found five that were, and the families
 * with no mapper were exactly the ones nobody could check. This is presence's
 * half of that check.
 */
describe("presenceStatusKind", () => {
  test("no status is painted in the chapter accent", () => {
    for (const status of ALL_STATUSES) {
      const kind = presenceStatusKind(status);
      expect(kind, status).not.toMatch(/\b(bg|border|ring|text)-primary\b/);
      expect(kind, status).not.toMatch(/\baccent\b/);
    }
  });

  test("every status gets a treatment, and no two share one", () => {
    const kinds = ALL_STATUSES.map(presenceStatusKind);
    expect(kinds.every((k) => k.length > 0)).toBe(true);
    expect(new Set(kinds).size).toBe(ALL_STATUSES.length);
  });

  /**
   * `--success` and `--warning` are a green/amber pair, which is the classic
   * pair colour-vision deficiency collapses — so Online and Idle must differ in
   * shape too, not only in hue.
   */
  test("Idle is a ring and Online is a fill, so they differ without colour", () => {
    expect(presenceStatusKind("idle")).toContain("border-2");
    expect(presenceStatusKind("online")).not.toContain("border-2");
  });

  /**
   * The ring's interior sits over an avatar photo. `bg-transparent` would let
   * the photo through, so an amber-ish image would make Idle read as filled —
   * losing the shape distinction exactly where the colour one is weakest.
   */
  test("the Idle ring has an opaque interior", () => {
    expect(presenceStatusKind("idle")).toContain("bg-card");
    expect(presenceStatusKind("idle")).not.toContain("bg-transparent");
  });
});

describe("sameRoster", () => {
  test("equal contents compare equal even as different Map instances", () => {
    expect(
      sameRoster(new Map([["u1", 1]]), new Map([["u1", 1]])),
    ).toBe(true);
  });

  test("a changed timestamp is a change", () => {
    expect(sameRoster(new Map([["u1", 1]]), new Map([["u1", 2]]))).toBe(false);
  });

  test("a different member set is a change, both directions", () => {
    const one = new Map([["u1", 1]]);
    const two = new Map([
      ["u1", 1],
      ["u2", 1],
    ]);
    expect(sameRoster(one, two)).toBe(false);
    expect(sameRoster(two, one)).toBe(false);
  });

  /**
   * Same size, disjoint keys — the case a size-only comparison would call
   * equal, freezing the directory on the previous roster.
   */
  test("same size with different members is a change", () => {
    expect(sameRoster(new Map([["u1", 1]]), new Map([["u2", 1]]))).toBe(false);
  });

  test("two empty rosters are equal", () => {
    expect(sameRoster(new Map(), new Map())).toBe(true);
  });
});

/**
 * The topic string is a contract with itself across reconnects, and it must not
 * collide with the chapter-keyed change topic `events:<chapterId>` — the
 * attach/release queue in `topic-registry.ts` is keyed by topic string, so a
 * collision would make one subscription tear the other down on re-attach.
 */
describe("chapterPresenceTopic", () => {
  test("is distinct from the chat and change topics", () => {
    const chapterId = "11111111-2222-3333-4444-555555555555";
    expect(chapterPresenceTopic(chapterId)).toBe(
      `presence:chapter:${chapterId}`,
    );
    expect(chapterPresenceTopic(chapterId)).not.toBe(`events:${chapterId}`);
    expect(chapterPresenceTopic(chapterId).startsWith("chat:channel:")).toBe(
      false,
    );
  });
});
