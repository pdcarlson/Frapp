import { describe, expect, it } from "vitest";
import {
  MESSAGES_FOLLOW_MAX,
  MESSAGES_HINT_FRESH,
  MESSAGES_HINT_REPEAT_MS,
  MESSAGES_PEEK,
  messagesFollowOffset,
  messagesHintShown,
  messagesHintSwiped,
  readMessagesHint,
  shouldShowMessagesHint,
  writeMessagesHint,
} from "./messages-hint";

/**
 * The hint that teaches the swipe to Messages (#3774, #4610 step 3). The
 * brief: subtle, once, and never again after the member has swiped.
 */

const NOW = Date.UTC(2026, 10, 12, 18);
const DAY = 24 * 60 * 60 * 1000;

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

describe("when the Messages swipe hint plays", () => {
  it("plays for a member who has never seen it", () => {
    expect(shouldShowMessagesHint(MESSAGES_HINT_FRESH, NOW, 0)).toBe(true);
  });

  it("never plays once the member has swiped to Messages", () => {
    const swiped = messagesHintSwiped(MESSAGES_HINT_FRESH);
    expect(shouldShowMessagesHint(swiped, NOW, 0)).toBe(false);
    expect(shouldShowMessagesHint(swiped, NOW, 4)).toBe(false);
    const later = messagesHintSwiped(
      messagesHintShown(MESSAGES_HINT_FRESH, NOW),
    );
    expect(
      shouldShowMessagesHint(later, NOW + MESSAGES_HINT_REPEAT_MS, 2),
    ).toBe(false);
  });

  it("does not play again on the next visit", () => {
    const once = messagesHintShown(MESSAGES_HINT_FRESH, NOW);
    expect(once).toEqual({ swiped: false, shown: 1, lastShownAt: NOW });
    expect(shouldShowMessagesHint(once, NOW + 60_000, 0)).toBe(false);
    expect(shouldShowMessagesHint(once, NOW + 60_000, 3)).toBe(false);
  });

  it("plays once more after three days, only while a direct message is unread", () => {
    const once = messagesHintShown(MESSAGES_HINT_FRESH, NOW);
    expect(shouldShowMessagesHint(once, NOW + 3 * DAY - 1, 1)).toBe(false);
    expect(shouldShowMessagesHint(once, NOW + 3 * DAY, 0)).toBe(false);
    expect(shouldShowMessagesHint(once, NOW + 3 * DAY, 1)).toBe(true);
  });

  it("never plays a third time", () => {
    const twice = messagesHintShown(
      messagesHintShown(MESSAGES_HINT_FRESH, NOW),
      NOW + 3 * DAY,
    );
    expect(shouldShowMessagesHint(twice, NOW + 30 * DAY, 9)).toBe(false);
  });
});

describe("how far Chat home moves under a slide", () => {
  it("stays put with no travel, and for any slide right", () => {
    expect(messagesFollowOffset(0)).toBe(0);
    expect(Object.is(messagesFollowOffset(-0), 0)).toBe(true);
    expect(messagesFollowOffset(60)).toBe(0);
  });

  it("gives 60% of the travel since the pan took over, leftward", () => {
    expect(messagesFollowOffset(-50)).toBe(-30);
  });

  it("stops at the edge strip's width however far the finger goes", () => {
    expect(messagesFollowOffset(-900)).toBe(-MESSAGES_FOLLOW_MAX);
    // The hint's own slide shows less than a full pull does.
    expect(MESSAGES_PEEK).toBeLessThan(MESSAGES_FOLLOW_MAX);
  });
});

describe("the hint's record", () => {
  it("is fresh for a member with nothing stored", async () => {
    expect(await readMessagesHint("u-1", memoryStorage())).toEqual(
      MESSAGES_HINT_FRESH,
    );
  });

  it("is kept per member, so a second account on the phone gets its own", async () => {
    const storage = memoryStorage();
    await writeMessagesHint(
      "u-1",
      messagesHintSwiped(MESSAGES_HINT_FRESH),
      storage,
    );
    expect((await readMessagesHint("u-1", storage))?.swiped).toBe(true);
    expect(await readMessagesHint("u-2", storage)).toEqual(MESSAGES_HINT_FRESH);
  });

  it("reads a damaged record as fresh rather than throwing", async () => {
    const key = "frapp.mobile.messages-swipe-hint:u-1";
    for (const raw of ["{not json", "null", '"x"', '{"shown":"2"}']) {
      expect(
        await readMessagesHint("u-1", memoryStorage({ [key]: raw })),
      ).toEqual(MESSAGES_HINT_FRESH);
    }
  });

  it("says nothing is known when storage can't be read, so the hint stays quiet", async () => {
    const broken = {
      getItem: async () => {
        throw new Error("disk");
      },
      setItem: async () => undefined,
    };
    expect(await readMessagesHint("u-1", broken)).toBeNull();
  });

  it("swallows a failed write", async () => {
    const broken = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error("disk");
      },
    };
    // It says so, and the caller doesn't play a hint it couldn't record.
    await expect(
      writeMessagesHint("u-1", MESSAGES_HINT_FRESH, broken),
    ).resolves.toBe(false);
    await expect(
      writeMessagesHint("u-1", MESSAGES_HINT_FRESH, memoryStorage()),
    ).resolves.toBe(true);
  });
});
