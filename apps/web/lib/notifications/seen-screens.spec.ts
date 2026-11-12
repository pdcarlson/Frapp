import { describe, expect, it } from "vitest";
import { notificationScreensForPath } from "./seen-screens";

describe("notificationScreensForPath", () => {
  it("names the screens a page shows the subject of", () => {
    expect(notificationScreensForPath("/events")).toEqual([
      "events",
      "ai_suggestions",
    ]);
    expect(notificationScreensForPath("/events/abc")).toEqual([
      "events",
      "ai_suggestions",
    ]);
    expect(notificationScreensForPath("/members")).toEqual(["members"]);
    // Suggested tasks are reviewed on the board and under their minutes.
    expect(notificationScreensForPath("/tasks")).toEqual([
      "tasks",
      "ai_suggestions",
    ]);
    expect(notificationScreensForPath("/meetings/abc")).toEqual([
      "ai_suggestions",
    ]);
  });

  it("leaves chat to the channel read, and matches whole segments only", () => {
    expect(notificationScreensForPath("/chat")).toEqual([]);
    // The tools inside Chapter settings mark their own rows (#3837).
    expect(notificationScreensForPath("/settings")).toEqual([]);
    expect(notificationScreensForPath("/chat/abc")).toEqual([]);
    expect(notificationScreensForPath("/eventsfoo")).toEqual([]);
    expect(notificationScreensForPath("/")).toEqual([]);
    expect(notificationScreensForPath(null)).toEqual([]);
  });
});
