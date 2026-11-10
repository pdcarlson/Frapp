import { describe, expect, it } from "vitest";
import { notificationScreensForPathname } from "./seen-screens";
import { resolveNotificationTarget } from "./targets";

describe("notificationScreensForPathname", () => {
  it("names the screens whose notifications a route shows the subject of", () => {
    expect(notificationScreensForPathname("/events")).toEqual(["events"]);
    expect(notificationScreensForPathname("/event-details")).toEqual(["events"]);
    expect(notificationScreensForPathname("/tasks")).toEqual(["tasks", "points"]);
    expect(notificationScreensForPathname("/dues")).toEqual(["billing"]);
    expect(notificationScreensForPathname("/directory")).toEqual(["members"]);
  });

  it("leaves chat to the channel read, and unknown routes alone", () => {
    expect(notificationScreensForPathname("/chat-thread")).toEqual([]);
    expect(notificationScreensForPathname("/notifications")).toEqual([]);
    expect(notificationScreensForPathname(null)).toEqual([]);
  });

  it("covers every non-chat screen a notification tap can route to", () => {
    const params = { eventId: "e-1", taskId: "t-1" };
    for (const screen of ["events", "tasks", "points", "billing", "service", "members"]) {
      const { pathname } = resolveNotificationTarget({
        target: { screen, ...params },
      });
      expect(notificationScreensForPathname(pathname)).toContain(screen);
    }
  });
});
