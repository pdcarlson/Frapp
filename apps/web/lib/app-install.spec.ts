import { describe, expect, it } from "vitest";
import {
  PRODUCTION_NATIVE_APP,
  STAGING_NATIVE_APP,
  STORE_LISTING_URLS,
} from "@repo/validation";
import { appInstallUrl, installSource } from "./app-install";

const none = { ios: undefined, android: undefined };

describe("appInstallUrl", () => {
  it("uses the environment's link for the platform when one is set", () => {
    const configured = {
      ios: " https://testflight.apple.com/join/AbCd1234 ",
      android: "https://play.google.com/apps/internaltest/4701234567890",
    };
    expect(appInstallUrl("ios", STAGING_NATIVE_APP, configured)).toBe(
      "https://testflight.apple.com/join/AbCd1234",
    );
    expect(appInstallUrl("android", STAGING_NATIVE_APP, configured)).toBe(
      "https://play.google.com/apps/internaltest/4701234567890",
    );
  });

  it("falls back to the store listing for the store app, and to none for Frapp Staging", () => {
    expect(appInstallUrl("ios", PRODUCTION_NATIVE_APP, none)).toBe(
      STORE_LISTING_URLS.ios,
    );
    expect(appInstallUrl("android", PRODUCTION_NATIVE_APP, none)).toBe(
      STORE_LISTING_URLS.android,
    );
    expect(appInstallUrl("ios", STAGING_NATIVE_APP, none)).toBeNull();
  });

  it("ignores a value that isn't an https URL", () => {
    for (const ios of [
      "",
      "testflight.apple.com/join/x",
      "http://x.test/a",
      // The API's boot check refuses it too (`isHttpsUrl`).
      "https:testflight.apple.com/join/x",
    ]) {
      expect(
        appInstallUrl("ios", STAGING_NATIVE_APP, { ios, android: undefined }),
      ).toBeNull();
    }
  });
});

describe("installSource", () => {
  it("tells TestFlight, Play's tester page and a store listing apart", () => {
    expect(installSource("https://testflight.apple.com/join/AbCd1234")).toBe(
      "testflight",
    );
    expect(
      installSource("https://play.google.com/apps/internaltest/4701234567890"),
    ).toBe("play-testing");
    expect(
      installSource("https://play.google.com/apps/testing/live.frapp.mobile"),
    ).toBe("play-testing");
    expect(installSource(STORE_LISTING_URLS.android)).toBe("store");
    expect(installSource(STORE_LISTING_URLS.ios)).toBe("store");
  });
});
