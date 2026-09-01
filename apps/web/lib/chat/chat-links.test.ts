import { describe, it, expect } from "vitest";
import { chatDeepLink, CHAT_CHANNEL_PARAM, CHAT_MESSAGE_PARAM } from "./chat-links";

describe("chatDeepLink", () => {
  it("returns a bare /chat with no target", () => {
    expect(chatDeepLink()).toBe("/chat");
    expect(chatDeepLink({})).toBe("/chat");
  });

  it("carries only channelId when messageId is absent", () => {
    expect(chatDeepLink({ channelId: "c1" })).toBe(
      `/chat?${CHAT_CHANNEL_PARAM}=c1`,
    );
  });

  it("carries both channelId and messageId", () => {
    expect(chatDeepLink({ channelId: "c1", messageId: "m1" })).toBe(
      `/chat?${CHAT_CHANNEL_PARAM}=c1&${CHAT_MESSAGE_PARAM}=m1`,
    );
  });

  it("ignores null/undefined/empty-string targets", () => {
    expect(chatDeepLink({ channelId: null, messageId: undefined })).toBe(
      "/chat",
    );
    expect(chatDeepLink({ channelId: "", messageId: "" })).toBe("/chat");
  });

  it("URL-encodes special characters", () => {
    expect(chatDeepLink({ channelId: "a b/c" })).toBe(
      `/chat?${CHAT_CHANNEL_PARAM}=a+b%2Fc`,
    );
  });
});
