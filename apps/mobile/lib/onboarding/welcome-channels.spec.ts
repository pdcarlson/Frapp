import { describe, expect, it } from "vitest";
import {
  displayChannelLabel,
  selectJoinedPublicChannels,
} from "./welcome-channels";

describe("selectJoinedPublicChannels", () => {
  it("keeps public channels and drops DMs and role-gated rows", () => {
    expect(
      selectJoinedPublicChannels([
        { id: "1", name: "general", type: "PUBLIC", member_ids: [] },
        { id: "2", name: "alumni", type: "ROLE_GATED", member_ids: [] },
        { id: "3", name: "dm-a-b", type: "DM", member_ids: ["a", "b"] },
      ]).map((row) => row.name),
    ).toEqual(["general"]);
  });

  it("returns an empty list for unusable payloads", () => {
    expect(selectJoinedPublicChannels(null)).toEqual([]);
    expect(selectJoinedPublicChannels({})).toEqual([]);
  });
});

describe("displayChannelLabel", () => {
  it("prefixes a hash once", () => {
    expect(displayChannelLabel("general")).toBe("#general");
    expect(displayChannelLabel("#announcements")).toBe("#announcements");
  });
});
