import { describe, expect, it } from "vitest";
import {
  channelRowActions,
  type ChannelRowActionInput,
} from "./channel-row-actions";

const WEB = { copyLink: true, edit: true };
const MOBILE = { copyLink: false, edit: false };

function input(
  over: Partial<ChannelRowActionInput> = {},
): ChannelRowActionInput {
  return {
    channel: { type: "PUBLIC", name: "general" },
    unread: false,
    pinned: false,
    permissions: [],
    surface: WEB,
    ...over,
  };
}

describe("channelRowActions", () => {
  it("gives a member their own actions and nothing an officer does", () => {
    expect(channelRowActions(input())).toEqual({
      member: ["toggle-pin", "notifications", "copy-link"],
      officer: [],
    });
  });

  it("offers Mark as read only on an unread row", () => {
    expect(channelRowActions(input({ unread: true })).member[0]).toBe(
      "mark-read",
    );
  });

  it("offers no pin when the surface has no arrangement, or the DM is hidden", () => {
    expect(channelRowActions(input({ pinned: null })).member).not.toContain(
      "toggle-pin",
    );
    const hidden = input({
      channel: { type: "DM", name: "dm-a-b", hidden: true },
    });
    expect(channelRowActions(hidden).member).not.toContain("toggle-pin");
    expect(channelRowActions(hidden).member).not.toContain("hide");
  });

  it("offers Hide on a 1:1 DM only", () => {
    expect(
      channelRowActions(input({ channel: { type: "DM", name: "dm-a-b" } }))
        .member,
    ).toContain("hide");
    expect(
      channelRowActions(input({ channel: { type: "GROUP_DM", name: "g" } }))
        .member,
    ).not.toContain("hide");
  });

  it("scopes Edit and Delete to channels:manage, and the wildcard", () => {
    for (const permissions of [["channels:manage"], ["*"]]) {
      expect(channelRowActions(input({ permissions })).officer).toEqual([
        "edit",
        "delete",
      ]);
    }
    expect(
      channelRowActions(input({ permissions: ["chat:post"] })).officer,
    ).toEqual([]);
    // Unknown permissions fail closed.
    expect(
      channelRowActions(input({ permissions: undefined })).officer,
    ).toEqual([]);
  });

  it("never offers Edit or Delete on a DM or the audit channel", () => {
    const permissions = ["*"];
    for (const channel of [
      { type: "DM", name: "dm-a-b" },
      { type: "GROUP_DM", name: "g" },
      { type: "PRIVATE", name: "chapter-audit" },
    ]) {
      expect(
        channelRowActions(input({ channel, permissions })).officer,
      ).toEqual([]);
    }
  });

  it("leaves out what the surface can't do", () => {
    expect(
      channelRowActions(input({ surface: MOBILE, permissions: ["*"] })),
    ).toEqual({ member: ["toggle-pin", "notifications"], officer: ["delete"] });
  });
});
