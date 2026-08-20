import { describe, expect, it } from "vitest";
import {
  inviteTokenOf,
  onboardedChapterId,
  webAppOrigin,
  webJoinUrl,
} from "./invite-link";

describe("webAppOrigin", () => {
  it("strips a trailing slash from EXPO_PUBLIC_APP_URL", () => {
    expect(
      webAppOrigin({ EXPO_PUBLIC_APP_URL: "https://app.staging.frapp.live/" }),
    ).toBe("https://app.staging.frapp.live");
  });

  it("defaults to production when the env is unset", () => {
    expect(webAppOrigin({})).toBe("https://app.frapp.live");
  });
});

describe("webJoinUrl", () => {
  it("encodes the token on /join", () => {
    expect(webJoinUrl("a b", "https://app.frapp.live")).toBe(
      "https://app.frapp.live/join?token=a%20b",
    );
  });
});

describe("inviteTokenOf / onboardedChapterId", () => {
  it("reads the API fields the web wizard reads", () => {
    expect(inviteTokenOf({ token: "inv-1", role: "Member" })).toBe("inv-1");
    expect(inviteTokenOf({ invite_token: "inv-1" })).toBeNull();
    expect(onboardedChapterId({ id: "ch-1" })).toBe("ch-1");
    expect(onboardedChapterId({ chapter_id: "ch-1" })).toBeNull();
  });
});
