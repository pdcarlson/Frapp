import { describe, expect, it } from "vitest";
import { notificationScreensForPath } from "./seen-screens";

describe("notificationScreensForPath", () => {
  it("names the screens a page shows the subject of", () => {
    expect(notificationScreensForPath("/events")).toEqual(["events"]);
    expect(notificationScreensForPath("/events/abc")).toEqual(["events"]);
    expect(notificationScreensForPath("/members")).toEqual(["members"]);
    expect(notificationScreensForPath("/chat-admin")).toEqual(["chat_reports"]);
    expect(notificationScreensForPath("/discord-import")).toEqual([
      "discord_import",
    ]);
  });

  it("leaves chat to the channel read, and matches whole segments only", () => {
    expect(notificationScreensForPath("/chat")).toEqual([]);
    expect(notificationScreensForPath("/chat/abc")).toEqual([]);
    expect(notificationScreensForPath("/eventsfoo")).toEqual([]);
    expect(notificationScreensForPath("/")).toEqual([]);
    expect(notificationScreensForPath(null)).toEqual([]);
  });
});
