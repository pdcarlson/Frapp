import { describe, expect, it } from "vitest";
import { getAnonymousSentryBuildConfig } from "./sentry-build-config.mjs";

describe("getAnonymousSentryBuildConfig", () => {
  it("always enables source maps / debug IDs and stays silent without a token", () => {
    const withoutToken = getAnonymousSentryBuildConfig({
      project: "frapp-web",
      authToken: "",
    });
    expect(withoutToken.sourcemaps.disable).toBe(false);
    expect(withoutToken.silent).toBe(true);
    expect(withoutToken.telemetry).toBe(false);
    expect(withoutToken.org).toBe("frapp-live");
    expect(withoutToken.project).toBe("frapp-web");
    expect(withoutToken).not.toHaveProperty("debugIds");
    expect(JSON.stringify(withoutToken)).not.toContain('"debugIds":false');
    expect(withoutToken).not.toHaveProperty("errorHandler");

    const withToken = getAnonymousSentryBuildConfig({
      project: "frapp-landing",
      authToken: "sntrys_test",
    });
    expect(withToken.sourcemaps.disable).toBe(false);
    expect(withToken.silent).toBe(false);
    expect(withToken.project).toBe("frapp-landing");
  });

  it("includes errorHandler only when the caller passes one", () => {
    const handler = () => undefined;
    const withHandler = getAnonymousSentryBuildConfig({
      project: "frapp-landing",
      authToken: "",
      errorHandler: handler,
    });
    expect(withHandler.errorHandler).toBe(handler);
  });
});
