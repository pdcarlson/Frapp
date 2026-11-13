import { describe, expect, it } from "vitest";
import {
  APP_LINK_PATHS,
  CHAT_LINK_PATH,
  messageLinkUrl,
  parseMessageLink,
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
      parseMessageLink(messageLinkUrl(PRODUCTION_APP_ORIGIN, TARGET)),
    ).toEqual(TARGET);
  });

  it("read a build's own origin only when it is passed", () => {
    const staging = "https://staging.frapp.live";
    const href = messageLinkUrl(staging, TARGET);
    expect(parseMessageLink(href)).toBeNull();
    expect(parseMessageLink(href, [staging, PRODUCTION_APP_ORIGIN])).toEqual(
      TARGET,
    );
  });

  it("are not any other address", () => {
    expect(
      parseMessageLink("https://app.frapp.live/chat?channel=a"),
    ).toBeNull();
    expect(
      parseMessageLink("https://app.frapp.live/join?channel=a&message=b"),
    ).toBeNull();
    expect(
      parseMessageLink("https://evil.example/chat?channel=a&message=b"),
    ).toBeNull();
    expect(parseMessageLink("not a url")).toBeNull();
  });

  it("are a path the app claims", () => {
    expect(APP_LINK_PATHS).toContain(CHAT_LINK_PATH);
  });
});
