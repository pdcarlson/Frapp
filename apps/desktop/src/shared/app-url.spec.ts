import { describe, expect, it } from "vitest";
import { APP_URL_ENV, PRODUCTION_APP_URL, resolveAppOrigin } from "./app-url";

const resolve = (argv: string[], env: Record<string, string> = {}, isPackaged = true) =>
  resolveAppOrigin({ argv, env, isPackaged });

describe("resolveAppOrigin", () => {
  it("opens production when nothing asks otherwise", () => {
    expect(resolve([])).toEqual({ origin: PRODUCTION_APP_URL, rejected: null });
  });

  it("takes staging from the flag or the environment, as an origin", () => {
    expect(resolve(["--app-url=https://app.staging.frapp.live/chat?x=1"]).origin).toBe(
      "https://app.staging.frapp.live",
    );
    expect(resolve([], { [APP_URL_ENV]: "https://app.staging.frapp.live" }).origin).toBe(
      "https://app.staging.frapp.live",
    );
  });

  it("prefers the flag over the environment", () => {
    expect(
      resolve(["--app-url=https://app.frapp.live"], { [APP_URL_ENV]: "https://app.staging.frapp.live" })
        .origin,
    ).toBe("https://app.frapp.live");
  });

  it("refuses any other site and falls back to production", () => {
    for (const url of [
      "https://evil.example",
      "https://app.frapp.live.evil.example",
      "http://app.frapp.live",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expect(resolve([`--app-url=${url}`])).toEqual({ origin: PRODUCTION_APP_URL, rejected: url });
    }
  });

  it("accepts the local web dev server only when unpackaged", () => {
    expect(resolve(["--app-url=http://localhost:3000"], {}, false).origin).toBe("http://localhost:3000");
    expect(resolve(["--app-url=http://localhost:3000"], {}, true).origin).toBe(PRODUCTION_APP_URL);
  });
});
