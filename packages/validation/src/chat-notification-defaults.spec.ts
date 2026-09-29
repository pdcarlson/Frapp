import { describe, expect, it } from "vitest";
import {
  builtInChannelDefault,
  isAnnouncementChannel,
  isDirectChannel,
  type NotificationDefaultChannel,
} from "./chat-notification-defaults";

const ch = (
  name: string,
  over: Partial<NotificationDefaultChannel> = {},
): NotificationDefaultChannel => ({
  name,
  type: "PUBLIC",
  is_read_only: false,
  ...over,
});

describe("builtInChannelDefault", () => {
  it("is all for #general and the announcements channel", () => {
    expect(builtInChannelDefault(ch("general"))).toBe("all");
    expect(builtInChannelDefault(ch("announcements"))).toBe("all");
  });
  it("is off for #chapter-audit", () => {
    expect(builtInChannelDefault(ch("chapter-audit"))).toBe("off");
  });
  it("is all for a DM and a group DM", () => {
    expect(builtInChannelDefault(ch("dm-a-b", { type: "DM" }))).toBe("all");
    expect(builtInChannelDefault(ch("Rush", { type: "GROUP_DM" }))).toBe("all");
  });
  it("is mentions for every other channel", () => {
    expect(builtInChannelDefault(ch("random"))).toBe("mentions");
    expect(builtInChannelDefault(ch("exec", { type: "PRIVATE" }))).toBe(
      "mentions",
    );
  });
});

describe("isAnnouncementChannel", () => {
  it("matches the seeded channel by name alone", () => {
    expect(isAnnouncementChannel(ch("announcements"))).toBe(true);
  });
  it("matches a public read-only channel whose name contains it", () => {
    expect(
      isAnnouncementChannel(
        ch("Chapter-Announcements", { is_read_only: true }),
      ),
    ).toBe(true);
  });
  it("does not match one anyone can post in", () => {
    expect(isAnnouncementChannel(ch("intramural-announcements"))).toBe(false);
  });
  it("does not match a private or role-gated one", () => {
    expect(
      isAnnouncementChannel(
        ch("exec-announcements", { type: "PRIVATE", is_read_only: true }),
      ),
    ).toBe(false);
    expect(
      isAnnouncementChannel(
        ch("alumni-announcements", { type: "ROLE_GATED", is_read_only: true }),
      ),
    ).toBe(false);
  });
});

describe("isDirectChannel", () => {
  it("is true only for DM and GROUP_DM", () => {
    expect(isDirectChannel({ type: "DM" })).toBe(true);
    expect(isDirectChannel({ type: "GROUP_DM" })).toBe(true);
    expect(isDirectChannel({ type: "PUBLIC" })).toBe(false);
  });
});
