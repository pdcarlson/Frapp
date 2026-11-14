import { describe, expect, it } from "vitest";
import {
  APP_LINK_PATHS,
  CHECK_IN_LINK_PATH,
  checkInLinkUrl,
  checkInTargetFrom,
  openCheckInInAppUrl,
  parseCheckInLink,
} from "./index";

const EVENT = "11111111-1111-4111-8111-111111111111";
const TOKEN = "abc_DEF-123";

describe("checkInLinkUrl", () => {
  it("builds the link the host screen draws, on the configured origin", () => {
    expect(checkInLinkUrl("https://app.frapp.live/", EVENT, TOKEN)).toBe(
      `https://app.frapp.live/check-in?event=${EVENT}&t=${TOKEN}`,
    );
  });

  it("carries what the app's route and the web page read back", () => {
    const url = new URL(
      checkInLinkUrl("https://app.staging.frapp.live", EVENT, TOKEN),
    );
    expect(url.pathname).toBe(CHECK_IN_LINK_PATH);
    expect(
      checkInTargetFrom(
        url.searchParams.get("event"),
        url.searchParams.get("t"),
      ),
    ).toEqual({ eventId: EVENT, token: TOKEN });
  });

  it("is a path the app claims as a universal link and App Link", () => {
    expect(APP_LINK_PATHS).toContain(CHECK_IN_LINK_PATH);
  });
});

describe("checkInTargetFrom", () => {
  it("takes the first of a repeated parameter and refuses a blank one", () => {
    expect(checkInTargetFrom([EVENT, "x"], TOKEN)).toEqual({
      eventId: EVENT,
      token: TOKEN,
    });
    expect(checkInTargetFrom(EVENT, " ")).toBeNull();
    expect(checkInTargetFrom(undefined, TOKEN)).toBeNull();
  });
});

describe("openCheckInInAppUrl", () => {
  it("opens the app's own route on iOS and names the package on Android", () => {
    const target = { eventId: EVENT, token: TOKEN };
    expect(openCheckInInAppUrl("ios", target)).toBe(
      `frapp://check-in?event=${EVENT}&t=${TOKEN}`,
    );
    expect(openCheckInInAppUrl("android", target)).toBe(
      `intent://check-in?event=${EVENT}&t=${TOKEN}#Intent;scheme=frapp;package=live.frapp.mobile;end`,
    );
  });
});

describe("parseCheckInLink", () => {
  const link = checkInLinkUrl("https://app.frapp.live", EVENT, TOKEN);

  it("reads the code the host screen draws", () => {
    expect(parseCheckInLink(link)).toEqual({ eventId: EVENT, token: TOKEN });
    expect(parseCheckInLink(`  ${link}\n`)).toEqual({
      eventId: EVENT,
      token: TOKEN,
    });
  });

  it("reads a staging code only on a build whose origin is staging", () => {
    const staging = checkInLinkUrl(
      "https://app.staging.frapp.live",
      EVENT,
      TOKEN,
    );
    expect(parseCheckInLink(staging)).toBeNull();
    expect(
      parseCheckInLink(staging, ["https://app.staging.frapp.live/"]),
    ).toEqual({ eventId: EVENT, token: TOKEN });
  });

  it("refuses anything that isn't a check-in link on the origin", () => {
    for (const raw of [
      "",
      "hello",
      `frapp-checkin:v1:${EVENT}:${TOKEN}`,
      `https://evil.example/check-in?event=${EVENT}&t=${TOKEN}`,
      `http://app.frapp.live/check-in?event=${EVENT}&t=${TOKEN}`,
      `https://app.frapp.live/join?event=${EVENT}&t=${TOKEN}`,
      `https://app.frapp.live/check-in?event=${EVENT}`,
      `https://app.frapp.live/check-in?t=${TOKEN}`,
    ]) {
      expect(parseCheckInLink(raw), raw).toBeNull();
    }
  });
});
