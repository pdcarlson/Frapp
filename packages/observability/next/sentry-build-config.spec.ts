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
    expect(withoutToken).not.toHaveProperty("authToken");
    expect(withoutToken).not.toHaveProperty("release");

    const withToken = getAnonymousSentryBuildConfig({
      project: "frapp-landing",
      authToken: "sntrys_test",
    });
    expect(withToken.sourcemaps.disable).toBe(false);
    expect(withToken.silent).toBe(false);
    expect(withToken.project).toBe("frapp-landing");
    expect(withToken.authToken).toBe("sntrys_test");
  });

  it("forwards a git SHA as release.name so maps match runtime init", () => {
    const withRelease = getAnonymousSentryBuildConfig({
      project: "frapp-web",
      authToken: "sntrys_test",
      release: "267dafa55b9e85b788c3662c44588c0197473b68",
    });
    expect(withRelease.release).toEqual({
      name: "267dafa55b9e85b788c3662c44588c0197473b68",
    });

    const garbage = getAnonymousSentryBuildConfig({
      project: "frapp-web",
      release: "not-a-sha",
    });
    expect(garbage).not.toHaveProperty("release");

    const empty = getAnonymousSentryBuildConfig({
      project: "frapp-web",
      release: "",
    });
    expect(empty).not.toHaveProperty("release");
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
