import { describe, expect, it } from "vitest";
import { findTargetRoute } from "./find-route";

describe("findTargetRoute", () => {
  it("opens a channel, and a message at that message in its channel", () => {
    expect(findTargetRoute({ type: "channel", channelId: "c1" })).toEqual({
      pathname: "/chat-thread",
      params: { channelId: "c1" },
    });
    expect(
      findTargetRoute({ type: "message", channelId: "c1", messageId: "m9" }),
    ).toEqual({
      pathname: "/chat-thread",
      params: { channelId: "c1", focusMessageId: "m9" },
    });
    expect(
      findTargetRoute({ type: "message", channelId: "c1", messageId: null }),
    ).toEqual({ pathname: "/chat-thread", params: { channelId: "c1" } });
  });

  it("opens an event's details and the directory for a member", () => {
    expect(findTargetRoute({ type: "event", eventId: "e1" })).toEqual({
      pathname: "/event-details",
      params: { id: "e1" },
    });
    expect(findTargetRoute({ type: "member", userId: "u1" })).toEqual({
      pathname: "/directory",
    });
  });

  it("has no screen for backwork, or for a row that names nothing", () => {
    expect(findTargetRoute({ type: "backwork", entryId: "b1" })).toBeNull();
    expect(findTargetRoute({ type: "channel", channelId: null })).toBeNull();
    expect(
      findTargetRoute({ type: "message", channelId: null, messageId: "m" }),
    ).toBeNull();
    expect(findTargetRoute({ type: "event", eventId: null })).toBeNull();
  });
});
