import { describe, expect, it } from "vitest";
import { decideNavigation, isPermissionAllowed } from "./navigation";

const APP = "https://app.frapp.live";

describe("decideNavigation", () => {
  it("keeps the app's own pages in the window", () => {
    expect(decideNavigation("https://app.frapp.live/chat/abc", APP)).toEqual({ kind: "stay" });
  });

  it("sends other web and mail links to the default browser", () => {
    expect(decideNavigation("https://maps.google.com/?q=RPI", APP)).toEqual({
      kind: "external",
      url: "https://maps.google.com/?q=RPI",
    });
    expect(decideNavigation("mailto:paul@example.com", APP).kind).toBe("external");
    // Same host, different scheme or port, is another site.
    expect(decideNavigation("http://app.frapp.live/chat", APP).kind).toBe("external");
    expect(decideNavigation("https://app.frapp.live.evil.example/", APP).kind).toBe("external");
  });

  it("drops schemes that could start a program", () => {
    for (const url of [
      "file:///C:/Windows/System32/calc.exe",
      "javascript:alert(1)",
      "ms-settings:privacy",
      "smb://host/share",
      "frapp-desktop://auth/callback?code=x",
      "not a url",
    ]) {
      expect(decideNavigation(url, APP)).toEqual({ kind: "block" });
    }
  });
});

describe("isPermissionAllowed", () => {
  it("allows the app's own notifications, microphone, clipboard writes and full screen", () => {
    expect(isPermissionAllowed("notifications", `${APP}/chat`, APP)).toBe(true);
    expect(isPermissionAllowed("media", `${APP}/meetings`, APP, ["audio"])).toBe(true);
    expect(isPermissionAllowed("clipboard-sanitized-write", APP, APP)).toBe(true);
    expect(isPermissionAllowed("fullscreen", APP, APP)).toBe(true);
  });

  it("refuses the camera, other permissions and other origins", () => {
    expect(isPermissionAllowed("media", APP, APP, ["video"])).toBe(false);
    expect(isPermissionAllowed("media", APP, APP, ["audio", "video"])).toBe(false);
    // Screen capture names no device; a check without media types names none either.
    expect(isPermissionAllowed("media", APP, APP, [])).toBe(false);
    expect(isPermissionAllowed("media", APP, APP)).toBe(false);
    expect(isPermissionAllowed("geolocation", APP, APP)).toBe(false);
    expect(isPermissionAllowed("openExternal", APP, APP)).toBe(false);
    expect(isPermissionAllowed("notifications", "https://evil.example", APP)).toBe(false);
    expect(isPermissionAllowed("notifications", "", APP)).toBe(false);
  });
});
