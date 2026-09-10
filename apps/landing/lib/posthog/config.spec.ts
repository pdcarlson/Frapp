import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  return import("./config");
}

describe("landing PostHog credentials", () => {
  it("is unconfigured when the write-only key is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const { isPostHogConfigured, landingPostHogKey } = await load();
    expect(landingPostHogKey()).toBeUndefined();
    expect(isPostHogConfigured()).toBe(false);
  });

  it("reads the host from env and defaults to US Cloud", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
    const { landingPostHogHost } = await load();
    expect(landingPostHogHost()).toBe("https://us.i.posthog.com");
  });
});

describe("landing-only person profiles", () => {
  it("never creates person profiles, flags, or a cross-subdomain cookie", async () => {
    const { buildLandingPostHogInitOptions } = await load();
    const options = buildLandingPostHogInitOptions({ environment: "preview" });
    expect(options.person_profiles).toBe("never");
    expect(options.cross_subdomain_cookie).toBe(false);
    expect(options.advanced_disable_feature_flags).toBe(true);
    expect(options.property_denylist).toEqual(["$ip", "ip", "email", "$email"]);
    expect(typeof options.before_send).toBe("function");
  });
});
