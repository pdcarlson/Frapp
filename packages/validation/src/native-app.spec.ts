import { describe, expect, it } from "vitest";
import {
  STORE_LISTING_URLS,
  extractInviteToken,
  openAppUrl,
  openInAppUrl,
  phonePlatform,
} from "./index";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15";
const ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 16; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

describe("phonePlatform (#4002)", () => {
  it("names an iPhone and an Android phone", () => {
    expect(phonePlatform(IPHONE)).toBe("ios");
    expect(phonePlatform(ANDROID_PHONE)).toBe("android");
  });

  it("leaves tablets, desktops and no user agent on the web", () => {
    expect(phonePlatform(IPAD)).toBeNull();
    expect(phonePlatform(ANDROID_TABLET)).toBeNull();
    expect(phonePlatform(DESKTOP)).toBeNull();
    expect(phonePlatform(null)).toBeNull();
    expect(phonePlatform(undefined)).toBeNull();
  });
});

describe("openInAppUrl (#4002)", () => {
  it("opens the app's join route with the token, which the app's parser reads back", () => {
    const ios = openInAppUrl("ios", "tok en/1");
    expect(ios).toBe("frapp://join?token=tok%20en%2F1");
    expect(extractInviteToken(ios)).toBe("tok en/1");
  });

  it("names the package on Android, so Chrome opens Play when the app is missing", () => {
    expect(openInAppUrl("android", "abc")).toBe(
      "intent://join?token=abc#Intent;scheme=frapp;package=live.frapp.mobile;end",
    );
  });
});

describe("STORE_LISTING_URLS", () => {
  it("names the App Store id eas.json submits to and the permanent package", () => {
    expect(STORE_LISTING_URLS).toEqual({
      ios: "https://apps.apple.com/app/id6812025642",
      android:
        "https://play.google.com/store/apps/details?id=live.frapp.mobile",
    });
  });
});

describe("openAppUrl (#4002)", () => {
  it("opens the app at home on iOS, and through Chrome's intent on Android", () => {
    expect(openAppUrl("ios")).toBe("frapp://");
    expect(openAppUrl("android")).toBe(
      "intent://#Intent;scheme=frapp;package=live.frapp.mobile;end",
    );
  });
});
