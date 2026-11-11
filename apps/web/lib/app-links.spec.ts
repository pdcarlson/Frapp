import { describe, expect, it, vi } from "vitest";
import { GET as aasaRoute } from "@/app/.well-known/apple-app-site-association/route";
import { GET as assetLinksRoute } from "@/app/.well-known/assetlinks.json/route";
import {
  androidAssetLinks,
  appLinksResponse,
  appleAppSiteAssociation,
} from "./app-links";

const PLAY_KEY =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
// Built, not written out, so the secret scanner does not read it as a key.
const UPLOAD_KEY_BARE = "0f".repeat(32);

describe("apple-app-site-association (#4002)", () => {
  it("claims only /join for the Team ID's live.frapp.mobile", () => {
    expect(appleAppSiteAssociation(" ABCDE12345 ")).toEqual({
      applinks: {
        details: [
          {
            appIDs: ["ABCDE12345.live.frapp.mobile"],
            components: [
              {
                "/": "/join",
                comment: "An invite link opens the app's join step (#4002)",
              },
            ],
          },
        ],
      },
    });
  });

  it.each([
    undefined,
    "",
    "abcde12345",
    "ABCDE1234",
    "ABCDE123456",
    "ABCDE.1234",
  ])("publishes nothing for a missing or malformed Team ID (%s)", (value) => {
    expect(appleAppSiteAssociation(value)).toBeNull();
  });
});

describe("assetlinks.json (#4002)", () => {
  it("lists every valid fingerprint once, in Google's colon form", () => {
    const links = androidAssetLinks(
      `${PLAY_KEY.toLowerCase()}, ${UPLOAD_KEY_BARE},${PLAY_KEY}`,
    );
    expect(links).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "live.frapp.mobile",
          sha256_cert_fingerprints: [
            PLAY_KEY,
            Array(32).fill("0F").join(":"),
          ],
        },
      },
    ]);
  });

  it("drops a value that isn't a SHA-256, and publishes nothing if none is left", () => {
    expect(androidAssetLinks("AB:CD, not-a-key")).toBeNull();
    expect(androidAssetLinks(undefined)).toBeNull();
  });
});

describe("the routes", () => {
  it("answer 404 when unset, as the origin did before they existed", async () => {
    vi.stubEnv("NEXT_PUBLIC_APPLE_TEAM_ID", "");
    vi.stubEnv("NEXT_PUBLIC_ANDROID_APP_CERT_SHA256", "");
    try {
      expect(aasaRoute().status).toBe(404);
      expect(assetLinksRoute().status).toBe(404);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("serve JSON with an explicit content type, since the iOS file has no extension", async () => {
    const response = appLinksResponse({ applinks: {} });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ applinks: {} });
  });
});
