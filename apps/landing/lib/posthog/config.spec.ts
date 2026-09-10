import { afterEach, describe, expect, it, vi } from "vitest";

describe("landing PostHog credentials", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("is unconfigured when NEXT_PUBLIC_POSTHOG_KEY is blank", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const config = await import("./config");
    expect(config.landingPostHogKey()).toBeUndefined();
    expect(config.isPostHogConfigured()).toBe(false);
  });

  it("defaults the ingest host to US Cloud when the host env is empty", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
    expect((await import("./config")).landingPostHogHost()).toBe(
      "https://us.i.posthog.com",
    );
  });
});

describe("landing-only person profiles", () => {
  it("never creates person profiles, flags, or a cross-subdomain cookie", async () => {
    const { buildLandingPostHogInitOptions } = await import("./config");
    const options = buildLandingPostHogInitOptions({ environment: "preview" });
    expect(options.person_profiles).toBe("never");
    expect(options.cross_subdomain_cookie).toBe(false);
    expect(options.advanced_disable_feature_flags).toBe(true);
    expect(options.property_denylist).toEqual(["$ip", "ip", "email", "$email"]);
    expect(typeof options.before_send).toBe("function");
  });
});
