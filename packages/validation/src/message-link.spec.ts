import { describe, expect, it } from "vitest";
import {
  APP_LINK_PATHS,
  CHAT_LINK_PATH,
  messageLinkUrl,
  parseChatLink,
  PRODUCTION_APP_ORIGIN,
} from "./index";

const TARGET = {
  channelId: "11111111-1111-4111-8111-111111111111",
  messageId: "22222222-2222-4222-8222-222222222222",
};

describe("message links (#3723)", () => {
  it("are a /chat link carrying the channel and the message", () => {
    expect(messageLinkUrl("https://app.frapp.live/", TARGET)).toBe(
      `https://app.frapp.live/chat?channel=${TARGET.channelId}&message=${TARGET.messageId}`,
    );
  });

  it("read back what they were made from", () => {
    expect(
      parseChatLink(messageLinkUrl(PRODUCTION_APP_ORIGIN, TARGET)),
    ).toEqual(TARGET);
  });

  it("read a build's own origin only when it is passed", () => {
    const staging = "https://staging.frapp.live";
    const href = messageLinkUrl(staging, TARGET);
    expect(parseChatLink(href)).toBeNull();
    expect(parseChatLink(href, [staging, PRODUCTION_APP_ORIGIN])).toEqual(
      TARGET,
    );
  });

  it("are not any other address", () => {
    expect(parseChatLink("https://app.frapp.live/chat?message=a")).toBeNull();
    expect(
      parseChatLink("https://app.frapp.live/join?channel=a&message=b"),
    ).toBeNull();
    expect(
      parseChatLink("https://evil.example/chat?channel=a&message=b"),
    ).toBeNull();
    expect(parseChatLink("not a url")).toBeNull();
  });

  it("name a channel alone too, as the web's channel Copy link does", () => {
    expect(
      parseChatLink(`https://app.frapp.live/chat?channel=${TARGET.channelId}`),
    ).toEqual({ channelId: TARGET.channelId, messageId: null });
  });

  it("are not a path the app claims yet (#4869)", () => {
    expect(APP_LINK_PATHS as readonly string[]).not.toContain(CHAT_LINK_PATH);
  });
});
