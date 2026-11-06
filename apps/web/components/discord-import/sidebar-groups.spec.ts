import { describe, expect, it } from "vitest";
import type { ChannelChoice } from "./mapping-issues";
import {
  NO_SIDEBAR_GROUPS,
  keptSidebarGroups,
  sidebarGroupFor,
  sidebarPreview,
} from "./sidebar-groups";

const channel = (id: string, category: string | null) => ({
  channelId: id,
  channelName: `channel-${id}`,
  category,
});
const created: ChannelChoice = { action: "create_new", newName: "x" };
const merged: ChannelChoice = { action: "use_existing", targetChannelId: "c" };
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
    expect(sidebarGroupFor(channel("1", "Generic"), merged, keep)).toBeNull();
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

describe("sidebarPreview", () => {
  const at = (
    id: string,
    category: string | null,
    categoryPosition: number | null = null,
  ) => ({ ...channel(id, category), categoryPosition });
  const named = (newName: string, visibility = "chapter"): ChannelChoice =>
    ({ action: "create_new", newName, visibility }) as ChannelChoice;
  const shape = (sections: ReturnType<typeof sidebarPreview>) =>
    sections.map((section) => [
      section.group,
      section.channels.map(
        (row) => `${row.locked ? "locked " : ""}${row.name}`,
      ),
    ]);

  it("lists every new channel under Channels while categories aren't kept, A to Z", () => {
    expect(
      shape(
        sidebarPreview(
          [at("1", "Generic"), at("2", "Secret"), at("3", null)],
          {
            "1": named("random"),
            "2": named("cabinet", "restricted"),
            "3": named("announcements"),
          },
          NO_SIDEBAR_GROUPS,
        ),
      ),
    ).toEqual([[null, ["announcements", "locked cabinet", "random"]]]);
  });

  it("leaves out merges and skips, which make no channel", () => {
    expect(
      sidebarPreview(
        [at("1", null), at("2", null)],
        { "1": merged, "2": { action: "skip" } },
        keep,
      ),
    ).toEqual([]);
  });

  it("puts Channels first, then kept groups in Discord's order, then by name", () => {
    expect(
      shape(
        sidebarPreview(
          [
            at("1", "Secret", 5),
            at("2", "Generic", 2),
            at("3", null),
            // No place from the scan: after every positioned group.
            at("4", "Archive"),
            at("5", "Zeta"),
          ],
          {
            "1": named("vault"),
            "2": named("random"),
            "3": named("general"),
            "4": named("old"),
            "5": named("last"),
          },
          keep,
        ),
      ),
    ).toEqual([
      [null, ["general"]],
      ["Generic", ["random"]],
      ["Secret", ["vault"]],
      ["Archive", ["old"]],
      ["Zeta", ["last"]],
    ]);
  });

  it("draws Discord channels given one new name and the same readers as one row", () => {
    expect(
      shape(
        sidebarPreview(
          [at("1", "Rush"), at("2", "Rush"), at("3", "Rush")],
          {
            "1": named("rush"),
            // A leading # is not part of the name, as the merge rule reads it.
            "2": named("#Rush"),
            // Other readers: a channel of its own, which Needs attention asks about.
            "3": named("rush", "discord"),
          },
          keep,
        ),
      ),
    ).toEqual([["Rush", ["rush", "locked rush"]]]);
  });

  it("joins a group the chapter already has, under its spelling and before new ones", () => {
    const sections = sidebarPreview(
      [at("1", "Committees", 1), at("2", "Events", 3)],
      { "1": named("rush"), "2": named("formal") },
      keep,
      [{ name: "events" }, { name: "Ops" }],
    );
    expect(shape(sections)).toEqual([
      ["events", ["formal"]],
      ["Committees", ["rush"]],
    ]);
    expect(sections.map((section) => section.existing)).toEqual([true, false]);
  });

  it("sends a dropped category's channels to Channels", () => {
    expect(
      shape(
        sidebarPreview(
          [at("1", "Other")],
          { "1": named("misc") },
          { keep: true, dropped: new Set(["Other"]) },
        ),
      ),
    ).toEqual([[null, ["misc"]]]);
  });
});
