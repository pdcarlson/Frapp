import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load() {
  return import("./config");
}

describe("web PostHog credentials", () => {
  it("is unconfigured when the write-only key is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    const { isPostHogConfigured, webPostHogKey } = await load();
    expect(webPostHogKey()).toBeUndefined();
    expect(isPostHogConfigured()).toBe(false);
  });

  it("reads the host from env and defaults to US Cloud", async () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");
    const { webPostHogHost } = await load();
    expect(webPostHogHost()).toBe("https://us.i.posthog.com");
  });
});

describe("web-only person profiles", () => {
  it("uses identified_only and does not add landing's never-profile extras", async () => {
    const { buildWebPostHogInitOptions } = await load();
    const options = buildWebPostHogInitOptions({ environment: "preview" });
    expect(options.person_profiles).toBe("identified_only");
    expect(options).not.toHaveProperty("cross_subdomain_cookie");
    expect(options).not.toHaveProperty("advanced_disable_feature_flags");
    expect(options).not.toHaveProperty("before_send");
    expect(options).not.toHaveProperty("property_denylist");
  });
});
