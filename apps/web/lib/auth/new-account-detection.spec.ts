import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAPTERS_READ_TIMEOUT_MS,
  isConfirmedByThisSignIn,
  isEmailOnlyAccount,
  isNewAccount,
  isNewEmailAccount,
} from "./new-account-detection";

/**
 * A magic-link account as GoTrue hands it back on the sign-in that opened its
 * first link: created when the link was asked for, confirmed and signed in
 * when it was opened (#3801).
 */
function newEmailUser(overrides: Record<string, unknown> = {}) {
  return {
    identities: [{ provider: "email" }],
    created_at: "2026-11-13T09:00:00.000Z",
    email_confirmed_at: "2026-11-13T09:40:00.000Z",
    last_sign_in_at: "2026-11-13T09:40:00.300Z",
    app_metadata: { provider: "email" },
    ...overrides,
  };
}

/** An account that confirmed its address weeks ago and has no chapter. */
const returningChapterlessUser = newEmailUser({
  created_at: "2026-10-01T12:00:00.000Z",
  email_confirmed_at: "2026-10-01T12:03:00.000Z",
  last_sign_in_at: "2026-11-13T09:40:00.300Z",
});

describe("isEmailOnlyAccount", () => {
  it("is true when every identity is email", () => {
    expect(isEmailOnlyAccount({ identities: [{ provider: "email" }] })).toBe(true);
  });

  it("is false when any identity is a provider", () => {
    expect(
      isEmailOnlyAccount({ identities: [{ provider: "email" }, { provider: "google" }] }),
    ).toBe(false);
  });

  it("is false for an empty, absent, or null identity list", () => {
    expect(isEmailOnlyAccount({ identities: [] })).toBe(false);
    expect(isEmailOnlyAccount({})).toBe(false);
    expect(isEmailOnlyAccount(null)).toBe(false);
    expect(isEmailOnlyAccount(undefined)).toBe(false);
  });
});

describe("isConfirmedByThisSignIn", () => {
  it("is true when this sign-in confirmed the address of an account made by its link", () => {
    expect(isConfirmedByThisSignIn(newEmailUser())).toBe(true);
  });

  it("is false for an address confirmed long before this sign-in", () => {
    expect(isConfirmedByThisSignIn(returningChapterlessUser)).toBe(false);
  });

  it("is false when the account is older than any email link lives", () => {
    // A password sign-up left unconfirmed for days, then confirmed by a link.
    expect(
      isConfirmedByThisSignIn(
        newEmailUser({
          created_at: "2026-11-10T09:00:00.000Z",
          email_confirmed_at: "2026-11-13T09:40:00.000Z",
        }),
      ),
    ).toBe(false);
  });

  it("is false when a timestamp is missing or unreadable", () => {
    expect(isConfirmedByThisSignIn(newEmailUser({ email_confirmed_at: null }))).toBe(false);
    expect(isConfirmedByThisSignIn(newEmailUser({ last_sign_in_at: undefined }))).toBe(false);
    expect(isConfirmedByThisSignIn(newEmailUser({ created_at: "not a date" }))).toBe(false);
    expect(isConfirmedByThisSignIn(null)).toBe(false);
  });
});

describe("isNewEmailAccount", () => {
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

  it("flags a brand-new email account that belongs to no chapter", async () => {
    respond([]);
    expect(await isNewEmailAccount(newEmailUser(), "tok")).toBe(true);
    const [reqUrl, init] = fetchMock.mock.calls[0]!;
    expect(reqUrl).toBe("https://api.frapp.live/v1/chapters");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer tok");
    // Correlates the read in the API's logs, as the SDK's own requests do.
    expect(headers.get("x-request-id")).toMatch(/^req_/);
  });

  it("does not flag an email account that joined a chapter moments ago", async () => {
    respond([{ chapter_id: "c1" }]);
    expect(await isNewEmailAccount(newEmailUser(), "tok")).toBe(false);
  });

  it("does not flag a returning chapterless account, and makes no read", async () => {
    // Waiting on an invite, or removed from its only chapter: not new.
    respond([]);
    expect(await isNewEmailAccount(returningChapterlessUser, "tok")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not flag an account with an OAuth identity, and makes no read", async () => {
    expect(
      await isNewEmailAccount(newEmailUser({ identities: [{ provider: "google" }] }), "tok"),
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("makes no read and does not flag when there is no access token", async () => {
    expect(await isNewEmailAccount(newEmailUser(), null)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls open to not-new on a non-OK status", async () => {
    respond({}, false);
    expect(await isNewEmailAccount(newEmailUser(), "tok")).toBe(false);
  });

  it("falls open to not-new on a body that isn't a list", async () => {
    respond({ oops: true });
    expect(await isNewEmailAccount(newEmailUser(), "tok")).toBe(false);
  });

  it("falls open to not-new when the read throws", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect(await isNewEmailAccount(newEmailUser(), "tok")).toBe(false);
  });

  it("bounds the read by a timeout, so a hung API falls open instead of holding sign-in", async () => {
    vi.useFakeTimers();
    try {
      // A fetch that never answers on its own, only to its abort signal.
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      );
      const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
        const controller = new AbortController();
        setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), ms);
        return controller.signal;
      });
      const verdict = isNewEmailAccount(newEmailUser(), "tok");
      await vi.advanceTimersByTimeAsync(CHAPTERS_READ_TIMEOUT_MS);
      expect(await verdict).toBe(false);
      expect(timeout).toHaveBeenCalledWith(CHAPTERS_READ_TIMEOUT_MS);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it("normalizes the configured base the way the SDK does", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", " https://api.frapp.live/v1/ ");
    respond([]);
    await isNewEmailAccount(newEmailUser(), "tok");
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.frapp.live/v1/chapters");
  });
});

describe("isNewAccount", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is true for a brand-new Google account without reading the API", async () => {
    const user = {
      created_at: "2026-11-09T04:23:05.120Z",
      last_sign_in_at: "2026-11-09T04:23:05.410Z",
      app_metadata: { provider: "google" },
      identities: [{ provider: "google" }],
    };
    expect(await isNewAccount(user, "tok")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is true for a brand-new chapterless email account", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    expect(await isNewAccount(newEmailUser(), "tok")).toBe(true);
  });

  it("is false for a returning chapterless email account", async () => {
    expect(await isNewAccount(returningChapterlessUser, "tok")).toBe(false);
  });
});
