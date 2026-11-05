import { describe, expect, it } from "vitest";
import type { ChannelChoice } from "./mapping-issues";
import {
  NO_SIDEBAR_GROUPS,
  keptSidebarGroups,
  sidebarGroupFor,
} from "./sidebar-groups";

const channel = (id: string, category: string | null) => ({
  channelId: id,
  channelName: `channel-${id}`,
  category,
});
const created: ChannelChoice = { action: "create_new", newName: "x" };
const keep = { keep: true, dropped: new Set<string>() };

describe("sidebarGroupFor", () => {
  it("names no group while categories aren't kept", () => {
    expect(
      sidebarGroupFor(channel("1", "Generic"), created, NO_SIDEBAR_GROUPS),
    ).toBeNull();
  });

  it("puts a new channel in the group named after its category, trimmed", () => {
    expect(sidebarGroupFor(channel("1", " Generic "), created, keep)).toBe(
      "Generic",
    );
  });

  it("names no group for a merge, a skip, or a channel in no category", () => {
    expect(
      sidebarGroupFor(
        channel("1", "Generic"),
        { action: "use_existing", targetChannelId: "c" },
        keep,
      ),
    ).toBeNull();
    expect(
      sidebarGroupFor(channel("1", "Generic"), { action: "skip" }, keep),
    ).toBeNull();
    expect(sidebarGroupFor(channel("1", null), created, keep)).toBeNull();
    expect(sidebarGroupFor(channel("1", "   "), created, keep)).toBeNull();
  });

  it("names no group for a category the admin dropped", () => {
    expect(
      sidebarGroupFor(channel("1", "Secret"), created, {
        keep: true,
        dropped: new Set(["Secret"]),
      }),
    ).toBeNull();
  });
});

describe("keptSidebarGroups", () => {
  it("lists each group once, in channel order, under its first spelling", () => {
    const channels = [
      channel("1", "Generic"),
      channel("2", "Secret"),
      channel("3", "generic"),
      channel("4", "Skipped"),
    ];
    const choices: Record<string, ChannelChoice> = {
      "1": created,
      "2": created,
      "3": created,
      "4": { action: "skip" },
    };

    expect(keptSidebarGroups(channels, choices, keep)).toEqual([
      "Generic",
      "Secret",
    ]);
  });
});
