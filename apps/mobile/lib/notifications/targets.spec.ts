import { describe, expect, it, vi } from "vitest";
import {
  chatChannelIdFrom,
  notificationHref,
  notificationIdFrom,
  openNotificationTarget,
  replaceablePathname,
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

  it("opens the suggested tasks list for a new batch (#4313)", () => {
    expect(
      resolveNotificationTarget(
        payload({
          screen: "ai_suggestions",
          batchId: "b1",
          sourceType: "meeting",
          sourceId: "m1",
        }),
      ),
    ).toEqual({ pathname: "/suggested-tasks" });
  });

  it("opens the minutes, not the event, for a minutes-posted push (#4312)", () => {
    expect(
      resolveNotificationTarget(
        payload({ screen: "events", eventId: "e1", meetingId: "m1" }),
      ),
    ).toEqual({ pathname: "/minutes-details", params: { id: "m1" } });
    // Only an events target names minutes this way.
    expect(
      resolveNotificationTarget(payload({ screen: "tasks", meetingId: "m1" })),
    ).toEqual({ pathname: "/tasks" });
  });

  it("sends points to the task board, which absorbed it", () => {
    // C3 folded points into s08; there is no points route to send anyone to.
    expect(resolveNotificationTarget(payload({ screen: "points" }))).toEqual({
      pathname: "/tasks",
    });
  });

  it("sends the officer report queue to the list, since mobile has no queue", () => {
    // `chat_reports` is emitted (the API's new-report notification) but routes
    // nowhere on mobile: the queue is web-only (`/chat-admin`). The list is the
    // honest landing rather than a guessed screen.
    expect(
      resolveNotificationTarget(payload({ screen: "chat_reports" })),
    ).toEqual({ pathname: "/notifications" });
  });

  it("sends the Discord import notice to the list, since its page is web-only", () => {
    expect(
      resolveNotificationTarget(payload({ screen: "discord_import" })),
    ).toEqual({ pathname: "/notifications" });
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

describe("resolveNotificationTarget, thread replies (#4054)", () => {
  it("opens a thread reply's thread, with its channel under it", () => {
    expect(
      resolveNotificationTarget(
        payload({ screen: "chat", channelId: "c1", threadRootId: "m1" }),
      ),
    ).toEqual({
      pathname: "/chat-thread",
      params: { channelId: "c1", threadRootId: "m1" },
      under: { pathname: "/chat-thread", params: { channelId: "c1" } },
    });
  });

  it("still opens the channel for a timeline push", () => {
    // No root, or an empty one: the channel, with nothing stacked under it.
    for (const extra of [{}, { threadRootId: "" }, { threadRootId: 7 }]) {
      expect(
        resolveNotificationTarget(
          payload({ screen: "chat", channelId: "c1", ...extra }),
        ),
      ).toEqual({ pathname: "/chat-thread", params: { channelId: "c1" } });
    }
  });

  it("falls back for a thread reply with no channel", () => {
    // The thread screen needs its channel, and so does the screen under it.
    expect(
      resolveNotificationTarget(
        payload({ screen: "chat", threadRootId: "m1" }),
      ),
    ).toEqual({ pathname: "/notifications" });
  });

  it("reads a root only on a chat push", () => {
    expect(
      resolveNotificationTarget(
        payload({ screen: "events", eventId: "e1", threadRootId: "m1" }),
      ),
    ).toEqual({ pathname: "/event-details", params: { id: "e1" } });
  });
});

describe("openNotificationTarget", () => {
  function fakeRouter() {
    const calls: string[] = [];
    const record = (kind: string) =>
      vi.fn((href: unknown) => {
        calls.push(`${kind} ${String(href)}`);
      });
    return {
      calls,
      router: {
        push: record("push"),
        replace: record("replace"),
        navigate: record("navigate"),
        dismissTo: record("dismissTo"),
      },
    };
  }
  const thread = resolveNotificationTarget(
    payload({ screen: "chat", channelId: "c1", threadRootId: "m1" }),
  );

  it("opens a target with nothing under it as openHref does", () => {
    const { calls, router } = fakeRouter();
    openNotificationTarget(router, { pathname: "/tasks" }, "/profile");
    openNotificationTarget(
      router,
      { pathname: "/chat-thread", params: { channelId: "c2" } },
      "/chat-thread",
    );
    expect(calls).toEqual([
      "dismissTo /tasks",
      "replace /chat-thread?channelId=c2",
    ]);
  });

  it("pushes the channel, then the thread over it", () => {
    const { calls, router } = fakeRouter();
    openNotificationTarget(router, thread, "/profile");
    expect(calls).toEqual([
      "push /chat-thread?channelId=c1",
      "push /chat-thread?channelId=c1&threadRootId=m1",
    ]);
  });

  it("replaces an open channel with the thread's, then pushes the thread", () => {
    // The thread is never what replaces: its path is a channel's, and
    // replacing would take the channel just opened under it back off.
    const { calls, router } = fakeRouter();
    openNotificationTarget(router, thread, "/chat-thread");
    expect(calls).toEqual([
      "replace /chat-thread?channelId=c1",
      "push /chat-thread?channelId=c1&threadRootId=m1",
    ]);
  });

  it("stacks both over an open thread, which is never replaced", () => {
    const { calls, router } = fakeRouter();
    openNotificationTarget(
      router,
      thread,
      replaceablePathname("/chat-thread", "m0"),
    );
    expect(calls).toEqual([
      "push /chat-thread?channelId=c1",
      "push /chat-thread?channelId=c1&threadRootId=m1",
    ]);
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

describe("chatChannelIdFrom", () => {
  it("reads the channel of a chat push and nothing else", () => {
    expect(
      chatChannelIdFrom({ target: { screen: "chat", channelId: "c-1" } }),
    ).toBe("c-1");
    expect(
      chatChannelIdFrom({ target: { screen: "events", eventId: "e-1" } }),
    ).toBeNull();
    expect(chatChannelIdFrom({ target: { screen: "chat" } })).toBeNull();
    expect(chatChannelIdFrom(null)).toBeNull();
  });
});

describe("replaceablePathname (#3785)", () => {
  it("lets a channel on top be replaced by a push for another channel", () => {
    expect(replaceablePathname("/chat-thread", undefined)).toBe("/chat-thread");
  });

  it("never replaces a message thread, which shares the channel's path", () => {
    expect(replaceablePathname("/chat-thread", "root-1")).toBeUndefined();
    expect(replaceablePathname("/chat-thread", ["root-1"])).toBeUndefined();
  });
});
