import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEmailOnlyAccount, isNewEmailAccount } from "./new-account-detection";

describe("isEmailOnlyAccount", () => {
  it("is true when every identity is email", () => {
    expect(isEmailOnlyAccount({ identities: [{ provider: "email" }] })).toBe(true);
  });

  it("is false when any identity is a provider", () => {
    expect(
      isEmailOnlyAccount({
        identities: [{ provider: "email" }, { provider: "google" }],
      }),
    ).toBe(false);
  });

  it("is false for an empty, absent, or null identity list", () => {
    expect(isEmailOnlyAccount({ identities: [] })).toBe(false);
    expect(isEmailOnlyAccount({})).toBe(false);
    expect(isEmailOnlyAccount(null)).toBe(false);
    expect(isEmailOnlyAccount(undefined)).toBe(false);
  });
});

describe("isNewEmailAccount", () => {
  const emailUser = { identities: [{ provider: "email" }] };
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.frapp.live");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function respond(body: unknown, ok = true) {
    fetchMock.mockResolvedValue({ ok, json: async () => body });
  }

  it("flags an email-only account that belongs to no chapter", async () => {
    respond([]);
    expect(await isNewEmailAccount(emailUser, "tok")).toBe(true);
    const [reqUrl, init] = fetchMock.mock.calls[0]!;
    expect(reqUrl).toBe("https://api.frapp.live/v1/chapters");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok" });
  });

  it("does not flag an email member who belongs to a chapter", async () => {
    respond([{ chapter_id: "c1" }]);
    expect(await isNewEmailAccount(emailUser, "tok")).toBe(false);
  });

  it("does not flag an account with an OAuth identity, and makes no read", async () => {
    expect(
      await isNewEmailAccount({ identities: [{ provider: "google" }] }, "tok"),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes no read and does not flag when there is no access token", async () => {
    expect(await isNewEmailAccount(emailUser, null)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls open to not-new on a non-OK status", async () => {
    respond({}, false);
    expect(await isNewEmailAccount(emailUser, "tok")).toBe(false);
  });

  it("falls open to not-new on a non-array body", async () => {
    respond({ oops: true });
    expect(await isNewEmailAccount(emailUser, "tok")).toBe(false);
  });

  it("falls open to not-new when the read throws (timeout or network)", async () => {
    fetchMock.mockRejectedValue(new Error("aborted"));
    expect(await isNewEmailAccount(emailUser, "tok")).toBe(false);
  });

  it("strips a trailing /v1 from the configured base", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.frapp.live/v1");
    respond([]);
    await isNewEmailAccount(emailUser, "tok");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.frapp.live/v1/chapters");
  });
});
