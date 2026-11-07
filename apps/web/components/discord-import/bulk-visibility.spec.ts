import { describe, expect, it } from "vitest";
import { bulkVisibilityState } from "./bulk-visibility";
import type { ChannelChoice } from "./mapping-issues";

const channel = (channelId: string) => ({
  channelId,
  channelName: channelId,
  category: null,
});
const pub = channel("pub");
const priv = channel("priv");
const readersOf = (target: { channelId: string }) =>
  target.channelId === "priv" ? { roles: ["Cabinet"], ignored: [] } : null;
const create = (visibility?: ChannelChoice["visibility"]): ChannelChoice => ({
  action: "create_new",
  visibility,
});

describe("bulkVisibilityState", () => {
  it("is null when nothing in reach is a new channel", () => {
    expect(
      bulkVisibilityState([pub], { pub: { action: "skip" } }, readersOf),
    ).toBeNull();
  });

  it("reads Same as Discord when the private ones are and the rest are whole chapter", () => {
    expect(
      bulkVisibilityState(
        [pub, priv],
        { pub: create("chapter"), priv: create("discord") },
        readersOf,
      ),
    ).toBe("discord");
  });

  it("reads the shared answer, Mixed when they differ, Choose when none is answered", () => {
    expect(
      bulkVisibilityState(
        [pub, priv],
        { pub: create("chapter"), priv: create("chapter") },
        readersOf,
      ),
    ).toBe("chapter");
    expect(
      bulkVisibilityState(
        [pub, priv],
        { pub: create("restricted"), priv: create("discord") },
        readersOf,
      ),
    ).toBe("mixed");
    expect(
      bulkVisibilityState(
        [pub, priv],
        { pub: create(), priv: create() },
        readersOf,
      ),
    ).toBe("unset");
  });

  it("reads Mixed while one is unanswered, so picking the others' answer still applies", () => {
    expect(
      bulkVisibilityState(
        [pub, priv],
        { pub: create("chapter"), priv: create() },
        readersOf,
      ),
    ).toBe("mixed");
  });

  it("reads Mixed when Same as Discord has none of its readers mapped", () => {
    // Every reader role set to Skip: the row reads Choose…, so the bulk
    // control must not claim Same as Discord is applied.
    const unmapped = () => ({ roles: [], ignored: ["Cabinet"] });
    expect(
      bulkVisibilityState(
        [pub, priv],
        { pub: create("chapter"), priv: create("discord") },
        (target) => (target.channelId === "priv" ? unmapped() : null),
      ),
    ).toBe("mixed");
  });
});
