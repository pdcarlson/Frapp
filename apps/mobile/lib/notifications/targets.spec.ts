import { describe, expect, it } from "vitest";
import {
  notificationHref,
  notificationIdFrom,
  resolveNotificationTarget,
} from "./targets";

function payload(target: unknown, extra: Record<string, unknown> = {}) {
  return { target, ...extra };
}

describe("resolveNotificationTarget", () => {
  it("routes every screen the API actually emits", () => {
    // The authoritative set, from grepping `target: {` across `apps/api/src`.
    // A row added here without a matching emitter is a guess; a row missing is
    // a member sent to the notification list instead of the thing they tapped.
    expect(
      resolveNotificationTarget(payload({ screen: "chat", channelId: "c1" })),
    ).toEqual({ pathname: "/chat-thread", params: { channelId: "c1" } });
    expect(
      resolveNotificationTarget(payload({ screen: "events", eventId: "e1" })),
    ).toEqual({ pathname: "/event-details", params: { id: "e1" } });
    expect(resolveNotificationTarget(payload({ screen: "tasks" }))).toEqual({
      pathname: "/tasks",
    });
    expect(resolveNotificationTarget(payload({ screen: "billing" }))).toEqual({
      pathname: "/dues",
    });
    expect(resolveNotificationTarget(payload({ screen: "service" }))).toEqual({
      pathname: "/service-hours",
    });
    expect(resolveNotificationTarget(payload({ screen: "members" }))).toEqual({
      pathname: "/directory",
    });
  });

  it("sends points to the task board, which absorbed it", () => {
    // C3 folded points into s08; there is no points route to send anyone to.
    expect(resolveNotificationTarget(payload({ screen: "points" }))).toEqual({
      pathname: "/tasks",
    });
  });

  it("renames the event param to what s07 reads", () => {
    // The payload spells it `eventId`; the route reads `id`. Getting this wrong
    // opens a detail screen that can never load.
    const target = resolveNotificationTarget(
      payload({ screen: "events", eventId: "e9" }),
    );
    expect(target.params).toEqual({ id: "e9" });
  });

  it("falls back to the notification list rather than guessing", () => {
    const list = { pathname: "/notifications" };
    expect(resolveNotificationTarget(undefined)).toEqual(list);
    expect(resolveNotificationTarget({})).toEqual(list);
    expect(resolveNotificationTarget(payload(null))).toEqual(list);
    expect(
      resolveNotificationTarget(payload({ screen: "kitchen-sink" })),
    ).toEqual(list);
    // A screen this build does not know is the case that matters: the server
    // can add one at any time and old installs must not crash or wander.
    expect(resolveNotificationTarget(payload({ screen: 7 }))).toEqual(list);
  });

  it("falls back when a required param is missing", () => {
    // `/chat-thread` with no channelId renders an error state, so it is not
    // offered at all.
    expect(resolveNotificationTarget(payload({ screen: "chat" }))).toEqual({
      pathname: "/notifications",
    });
    expect(
      resolveNotificationTarget(payload({ screen: "chat", channelId: "" })),
    ).toEqual({ pathname: "/notifications" });
  });

  it("ignores the burst-bundling extras the chat worker adds", () => {
    // A bundled push carries `bundled` and `count` alongside the target; both
    // are for copy, not routing.
    expect(
      resolveNotificationTarget(
        payload(
          { screen: "chat", channelId: "c2" },
          { bundled: true, count: 4 },
        ),
      ),
    ).toEqual({ pathname: "/chat-thread", params: { channelId: "c2" } });
  });
});

describe("notificationIdFrom", () => {
  it("reads the in-app row id the service stamps into every payload", () => {
    expect(notificationIdFrom({ notificationId: "n1" })).toBe("n1");
  });

  it("is null when absent, so a tap still navigates", () => {
    expect(notificationIdFrom({})).toBeNull();
    expect(notificationIdFrom(null)).toBeNull();
  });
});

describe("notificationHref", () => {
  it("returns a bare path when there are no params", () => {
    expect(notificationHref({ pathname: "/tasks" })).toBe("/tasks");
  });

  it("encodes params into a query string", () => {
    expect(
      notificationHref({
        pathname: "/chat-thread",
        params: { channelId: "c1" },
      }),
    ).toBe("/chat-thread?channelId=c1");
  });

  it("percent-encodes values so an id with a reserved character survives", () => {
    expect(
      notificationHref({
        pathname: "/chat-thread",
        params: { channelId: "a&b=c" },
      }),
    ).toBe("/chat-thread?channelId=a%26b%3Dc");
  });
});
