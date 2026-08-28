/** @vitest-environment jsdom */
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthChangeHandler = (
  event: string,
  session: {
    access_token: string;
    user: { email: string; id?: string };
  } | null,
) => void;

const mockState = vi.hoisted(() => ({
  /** Backing store for the mocked SecureStore — key -> value. */
  secureStore: new Map<string, string>(),
  /** Session returned by getSession() on mount. */
  initialSession: null as {
    access_token: string;
    user: { email: string; id?: string };
  } | null,
  claims: null as Record<string, unknown> | null,
  claimsError: null as { message: string } | null,
  /**
   * When closed, `getClaims` parks until the test releases it. Without this the
   * mocked read settles inside the same `act()` that triggered it, so the
   * in-flight window — the only place a gate-blocking regression is visible —
   * cannot be observed at all.
   *
   * Waiters are a list rather than a single resolver because more than one read
   * can be parked at once: a token change re-runs the claim effect while the
   * mount read is still behind the gate. Holding one resolver overwrote the
   * earlier one, stranding a promise that could then never settle.
   */
  claimsGateClosed: false,
  claimsGateWaiters: [] as Array<() => void>,
  authChangeHandlers: [] as AuthChangeHandler[],
  signInWithPasswordResult: { error: null as { message: string } | null },
  signInWithOtpResult: { error: null as { message: string } | null },
  signInWithPasswordCalls: [] as Array<{ email: string; password: string }>,
  signInWithOtpCalls: [] as Array<{ email: string }>,
  signOutCalls: 0,
  configured: true,
  deepLinkUrl: null as string | null,
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(
    async (key: string) => mockState.secureStore.get(key) ?? null,
  ),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    mockState.secureStore.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    mockState.secureStore.delete(key);
  }),
}));

vi.mock("expo-linking", () => ({
  useURL: vi.fn(() => mockState.deepLinkUrl),
  createURL: vi.fn((path: string) => `frapp://${path}`),
}));

vi.mock("./supabase", async () => {
  const actual =
    await vi.importActual<typeof import("./supabase")>("./supabase");
  // One client for the whole file. A factory that built a fresh object per call
  // would hand the test a different instance than the provider holds, so every
  // `expect(client.auth.X).toHaveBeenCalled()` would inspect an untouched mock
  // and quietly pass or fail for the wrong reason.
  const client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: mockState.initialSession },
      })),
      onAuthStateChange: vi.fn((handler: AuthChangeHandler) => {
        mockState.authChangeHandlers.push(handler);
        return {
          data: {
            subscription: {
              unsubscribe: vi.fn(() => {
                mockState.authChangeHandlers =
                  mockState.authChangeHandlers.filter((h) => h !== handler);
              }),
            },
          },
        };
      }),
      getClaims: vi.fn(async () => {
        if (mockState.claimsGateClosed) {
          await new Promise<void>((release) => {
            mockState.claimsGateWaiters.push(release);
          });
        }
        return {
          data: mockState.claims ? { claims: mockState.claims } : null,
          error: mockState.claimsError,
        };
      }),
      signInWithPassword: vi.fn(
        async (input: { email: string; password: string }) => {
          mockState.signInWithPasswordCalls.push(input);
          return mockState.signInWithPasswordResult;
        },
      ),
      signInWithOtp: vi.fn(async (input: { email: string }) => {
        mockState.signInWithOtpCalls.push(input);
        return mockState.signInWithOtpResult;
      }),
      signOut: vi.fn(async () => {
        mockState.signOutCalls += 1;
        return { error: null };
      }),
      setSession: vi.fn(async () => ({ data: {}, error: null })),
      exchangeCodeForSession: vi.fn(async () => ({ data: {}, error: null })),
      startAutoRefresh: vi.fn(async () => undefined),
      stopAutoRefresh: vi.fn(async () => undefined),
    },
  };

  return {
    ...actual,
    isSupabaseConfigured: vi.fn(() => mockState.configured),
    getSupabaseClient: vi.fn(() => (mockState.configured ? client : null)),
  };
});

import { AuthSessionProvider, useAuthSession } from "./auth-session";
import { AUTH_TOKEN_STORAGE_KEY } from "./auth-token";
import { useIsApiAuthenticated } from "./use-is-api-authenticated";
import { sessionStorageAdapter, getSupabaseClient } from "./supabase";
import { queryClient } from "./query-client";

/**
 * A cache entry whose key carries no account scope — `["settings"]` and
 * `["user","me"]` are the real ones. These are the entries that would otherwise
 * survive into the next member's session on a shared device.
 */
const ACCOUNT_AGNOSTIC_KEY = ["settings"];

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthSessionProvider>{children}</AuthSessionProvider>;
}

function emitAuthChange(
  session: {
    access_token: string;
    user: { email: string; id?: string };
  } | null,
) {
  for (const handler of [...mockState.authChangeHandlers]) {
    handler(session ? "SIGNED_IN" : "SIGNED_OUT", session);
  }
}

/** Hold every claim read issued from here on until `releaseClaimsGate()`. */
function closeClaimsGate() {
  mockState.claimsGateClosed = true;
}

/**
 * Let every parked claim read finish, and settle the resulting renders here.
 *
 * Releasing after the test body returns lands those state updates in whatever
 * test runs next, where it lands on a provider Testing Library has already
 * unmounted — so it exercises nothing and this test's last third silently stops
 * asserting. Not a state leak across tests; the `act` is here to keep the
 * release and its renders inside the test that asked for them.
 */
async function releaseClaimsGate() {
  mockState.claimsGateClosed = false;
  const waiters = mockState.claimsGateWaiters;
  mockState.claimsGateWaiters = [];
  await act(async () => {
    for (const release of waiters) release();
  });
}

/** The `getClaims` mock, for asserting on or awaiting the reads it recorded. */
function claimsMock() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error(
      "claimsMock() needs a configured client; mockState.configured is false",
    );
  }
  return vi.mocked(client.auth.getClaims).mock;
}

/** How many chapter-claim reads have been issued so far. */
function claimReadCount(): number {
  return claimsMock().results.length;
}

/**
 * Wait for the *first* chapter-claim read to have actually landed.
 *
 * Waiting on `isChapterResolving` alone does not do this. It is
 * `status === "authenticated" && !hasReadChapterClaim`
 * ([`auth-session.tsx`](./auth-session.tsx)), so it also reads false for the
 * whole `hydrating` window — before `getSession()` resolves and before any read
 * is issued. Pairing it with the authenticated state is what rules that window
 * out, and the pair is exactly equivalent to `hasReadChapterClaim === true`.
 *
 * Before shortening a product constant, note the other producer of that flag:
 * the bounded bail-out timer in the claim effect. What keeps it out of reach
 * here is `waitFor`'s own `asyncUtilTimeout` — 1000ms, Testing Library's
 * default, which nothing in `apps/mobile` overrides — not vitest's 5s
 * `testTimeout`. So the invariant is `CLAIM_READ_TIMEOUT_MS > 1000`, and it is
 * comfortably met at 8s. Drop it under a second, or raise `asyncUtilTimeout`
 * past it, and this helper goes back to proving nothing.
 */
async function waitForFirstClaimRead(result: {
  current: ReturnType<typeof useAuthSession>;
}) {
  await waitFor(() => {
    expect(result.current.status).toBe("authenticated");
    expect(result.current.isChapterResolving).toBe(false);
  });
}

/**
 * Let every claim read issued so far settle, along with the renders it causes.
 *
 * Needed wherever a *later* read is the thing under test: after the first read
 * lands, `hasReadChapterClaim` stays true by design, so a re-read changes no
 * flag and there is nothing for `waitFor` to observe.
 *
 * The `act` is what makes this correct, not the `allSettled`. `allSettled`
 * registers on the mock's promise *after* the provider's own `.then`, and the
 * `.finally` that sets the flag is two links further down — so awaiting the
 * source promise alone can return before the chain and its renders have landed.
 * React's async `act` hops macrotasks until its queue drains, which flushes all
 * of it. Do not "simplify" this by dropping the `act`.
 *
 * Pair this with an open gate. A read parked by `closeClaimsGate()` is resolved
 * only by `releaseClaimsGate()`, so awaiting it here would hang until the test
 * timeout with nothing to point at the cause — hence the explicit guard.
 */
async function settleClaimReads() {
  if (mockState.claimsGateClosed) {
    throw new Error(
      "settleClaimReads() would hang: the claims gate is closed and parked " +
        "reads can only be resolved by releaseClaimsGate().",
    );
  }
  const pending = claimsMock().results.map((r) => r.value);
  await act(async () => {
    await Promise.allSettled(pending);
  });
}

const SESSION = {
  access_token: "access-token-1",
  user: { email: "officer@university.edu" },
};

beforeEach(async () => {
  // Re-seat the Map-backed implementations: the hostile-keystore tests replace
  // them with rejections, and clearAllMocks() clears calls but not
  // implementations, so without this they leak into whatever runs next.
  const SecureStore = await import("expo-secure-store");
  vi.mocked(SecureStore.getItemAsync).mockImplementation(
    async (key: string) => mockState.secureStore.get(key) ?? null,
  );
  vi.mocked(SecureStore.setItemAsync).mockImplementation(
    async (key: string, value: string) => {
      mockState.secureStore.set(key, value);
    },
  );
  vi.mocked(SecureStore.deleteItemAsync).mockImplementation(
    async (key: string) => {
      mockState.secureStore.delete(key);
    },
  );

  mockState.secureStore.clear();
  mockState.initialSession = null;
  mockState.claims = null;
  mockState.claimsError = null;
  mockState.claimsGateClosed = false;
  mockState.claimsGateWaiters = [];
  mockState.authChangeHandlers = [];
  mockState.signInWithPasswordResult = { error: null };
  mockState.signInWithOtpResult = { error: null };
  mockState.signInWithPasswordCalls = [];
  mockState.signInWithOtpCalls = [];
  mockState.signOutCalls = 0;
  mockState.configured = true;
  mockState.deepLinkUrl = null;
  queryClient.clear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AuthSessionProvider — token persistence", () => {
  it("writes the access token to the key the API SDK reads when a session arrives", async () => {
    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(mockState.secureStore.get(AUTH_TOKEN_STORAGE_KEY)).toBeUndefined();

    await act(async () => {
      emitAuthChange(SESSION);
    });

    await waitFor(() =>
      expect(mockState.secureStore.get(AUTH_TOKEN_STORAGE_KEY)).toBe(
        "access-token-1",
      ),
    );
    expect(result.current.status).toBe("authenticated");
    expect(result.current.email).toBe("officer@university.edu");
  });

  it("re-mirrors a refreshed access token", async () => {
    mockState.initialSession = SESSION;
    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() =>
      expect(mockState.secureStore.get(AUTH_TOKEN_STORAGE_KEY)).toBe(
        "access-token-1",
      ),
    );

    await act(async () => {
      emitAuthChange({ ...SESSION, access_token: "access-token-2" });
    });

    await waitFor(() =>
      expect(mockState.secureStore.get(AUTH_TOKEN_STORAGE_KEY)).toBe(
        "access-token-2",
      ),
    );
    expect(result.current.status).toBe("authenticated");
  });

  it("clears the token on sign-out", async () => {
    mockState.initialSession = SESSION;
    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() =>
      expect(mockState.secureStore.get(AUTH_TOKEN_STORAGE_KEY)).toBe(
        "access-token-1",
      ),
    );

    queryClient.setQueryData(ACCOUNT_AGNOSTIC_KEY, ["outgoing-member-row"]);

    await act(async () => {
      await result.current.signOut();
    });

    await waitFor(() =>
      expect(mockState.secureStore.has(AUTH_TOKEN_STORAGE_KEY)).toBe(false),
    );
    expect(mockState.signOutCalls).toBe(1);
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.chapterId).toBeNull();
    // Owned here rather than in each screen: there are three sign-out paths and
    // the picker's clear landed only after the leak was noticed a second time.
    expect(queryClient.getQueryData(ACCOUNT_AGNOSTIC_KEY)).toBeUndefined();
  });

  it("signs out locally, without throwing, when the remote revoke fails", async () => {
    mockState.initialSession = SESSION;
    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() =>
      expect(mockState.secureStore.get(AUTH_TOKEN_STORAGE_KEY)).toBe(
        "access-token-1",
      ),
    );

    queryClient.setQueryData(ACCOUNT_AGNOSTIC_KEY, ["outgoing-member-row"]);

    const { getSupabaseClient } = await import("./supabase");
    const client = vi.mocked(getSupabaseClient)();
    vi.mocked(client!.auth.signOut).mockRejectedValueOnce(
      new Error("network down"),
    );

    // Must not reject: profile.tsx navigates away on return, so a thrown error
    // would strand the member on an authenticated screen while the local
    // session is already gone.
    await act(async () => {
      await expect(result.current.signOut()).resolves.toBeUndefined();
    });

    // A token left behind here would keep the SDK sending a Bearer header for a
    // session the member believes they ended.
    await waitFor(() =>
      expect(mockState.secureStore.has(AUTH_TOKEN_STORAGE_KEY)).toBe(false),
    );
    expect(result.current.status).toBe("unauthenticated");
    // The cache drop is on the same always-run path as the token clear, so a
    // failed remote revoke must not leave the previous member's rows behind.
    expect(queryClient.getQueryData(ACCOUNT_AGNOSTIC_KEY)).toBeUndefined();
  });
});

describe("AuthSessionProvider — chapter context", () => {
  it("resolves chapterId from the active_chapter_id claim", async () => {
    mockState.initialSession = SESSION;
    mockState.claims = { active_chapter_id: "chapter-uuid-1", sub: "user-1" };

    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() =>
      expect(result.current.chapterId).toBe("chapter-uuid-1"),
    );
  });

  it("resolves null when the claim is absent (multi-chapter, no selection)", async () => {
    mockState.initialSession = SESSION;
    mockState.claims = { sub: "user-1" };

    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitForFirstClaimRead(result);
    expect(result.current.chapterId).toBeNull();
  });

  it("does not invent a chapter when the very first claim read errors", async () => {
    mockState.initialSession = SESSION;
    mockState.claims = { active_chapter_id: "chapter-uuid-1" };
    mockState.claimsError = { message: "jwks unreachable" };

    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitForFirstClaimRead(result);
    // Nothing to fall back to, so null — but note this is "retain what we had",
    // not "null on error"; the next test is the half that distinguishes them.
    expect(result.current.chapterId).toBeNull();
  });

  it("retains the resolved chapter when a later claim read fails", async () => {
    mockState.initialSession = SESSION;
    mockState.claims = { active_chapter_id: "chapter-uuid-1", sub: "user-1" };

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() =>
      expect(result.current.chapterId).toBe("chapter-uuid-1"),
    );

    // `getClaims` is a real network round trip on this platform, and it re-runs
    // on every token refresh and every foreground. Demoting to null on failure
    // would make a flaky connection look like "this member has no chapter" —
    // which the routing gate would act on.
    mockState.claimsError = { message: "network down" };
    await act(async () => {
      emitAuthChange({ ...SESSION, access_token: "access-token-2" });
    });

    // Not `waitFor(isChapterResolving === false)`: the flag is already false
    // here and stays that way by design, so that wait returns on its first
    // synchronous sample without the failing re-read having gone anywhere.
    //
    // Pin the re-read itself. `settleClaimReads()` alone would not — it is
    // satisfied by the already-settled mount read, so it stays green even if
    // the token change stops triggering a read at all.
    expect(claimReadCount()).toBe(2);
    await settleClaimReads();
    expect(result.current.chapterId).toBe("chapter-uuid-1");
  });

  it("does not re-block the gate when a later token refresh re-reads the claim", async () => {
    // The regression this pins is an outage-shaped one. The routing gate renders
    // nothing while the first claim read is pending, and the claim is re-read on
    // every token change — the hourly auto-refresh and every foreground. If a
    // re-read set the flag again, the whole tab navigator would unmount roughly
    // once an hour, losing composer drafts and scroll position.
    //
    // Note the claim is deliberately ABSENT here: that is production's current
    // shape (#805 is open, so no token carries it), and it is exactly the case
    // where "we already have a chapter" cannot be what skips the wait.
    mockState.initialSession = SESSION;
    mockState.claims = { sub: "user-1" };

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    // Waiting on `isChapterResolving` alone used to be enough to let this test
    // start with the mount read still ahead of it — see the helper for why the
    // flag is false during `hydrating` too. The mount read then either parked
    // behind the gate closed below, or was already in flight and got cancelled
    // by the token change; either way it never marked the claim read, and the
    // assertion after the gate saw `true`. That was #976's flake.
    //
    // The race is inside this one test, not across the suite. `waitFor` samples
    // synchronously in its own executor, so the first sample always lands in
    // `hydrating` and always returns immediately; what varies is whether the
    // mount read lands during the post-resolve drain Testing Library runs
    // afterwards (an awaited `setTimeout(0)` racing React's scheduler). Load
    // shifts the odds, which is why #976 reported it as suite-only — but the
    // pre-fix test reproduces on its own too, measured 4 failures in 30
    // file-alone runs against 1 in 15 for the full suite on the same box.
    await waitForFirstClaimRead(result);

    // Hold the next read open so the in-flight window is observable. If the
    // flag tracked "a read is in flight" rather than "the first read is done",
    // it would be true right here — and the gate would be rendering nothing.
    closeClaimsGate();
    await act(async () => {
      emitAuthChange({ ...SESSION, access_token: "access-token-2" });
    });

    expect(result.current.isChapterResolving).toBe(false);

    // Pin that the re-read actually happened and is still in flight, or the
    // assertion above passes just as well when the effect stops re-reading at
    // all: the gate then holds nothing, and the flag is trivially false because
    // no read is outstanding. `lib/select-chapter.ts` is what depends on the
    // re-read — activating a chapter writes no local state and relies entirely
    // on the refreshed token re-running the claim effect — so that regression
    // would leave the chapter picker doing nothing until a cold start, with the
    // suite green.
    //
    // Exactly one read is parked, never two: the mount read has already
    // finished, which is precisely what the two-part wait above guarantees.
    // A second waiter here would mean that wait had gone back to returning
    // early.
    expect(mockState.claimsGateWaiters).toHaveLength(1);

    await releaseClaimsGate();
  });

  it("drops the chapter when a different account signs in", async () => {
    mockState.initialSession = {
      ...SESSION,
      user: { ...SESSION.user, id: "user-1" },
    };
    mockState.claims = { active_chapter_id: "chapter-uuid-1", sub: "user-1" };

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() =>
      expect(result.current.chapterId).toBe("chapter-uuid-1"),
    );

    // A magic link can swap accounts with no sign-out in between. Retention is
    // scoped to one user precisely so the next member does not inherit this
    // chapter while their own claim read is still in flight or failing.
    mockState.claimsError = { message: "network down" };
    await act(async () => {
      emitAuthChange({
        access_token: "access-token-2",
        user: { email: "other@university.edu", id: "user-2" },
      });
    });

    await waitFor(() => expect(result.current.chapterId).toBeNull());
  });
});

describe("AuthSessionProvider — sign-in", () => {
  it("passes credentials through to Supabase", async () => {
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await result.current.signInWithPassword({
        email: "officer@university.edu",
        password: "hunter2",
      });
    });

    expect(mockState.signInWithPasswordCalls).toEqual([
      { email: "officer@university.edu", password: "hunter2" },
    ]);
  });

  it("throws the Supabase error so the screen can surface it", async () => {
    mockState.signInWithPasswordResult = {
      error: { message: "Invalid login credentials" },
    };
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await expect(
        result.current.signInWithPassword({
          email: "officer@university.edu",
          password: "wrong",
        }),
      ).rejects.toMatchObject({ message: "Invalid login credentials" });
    });

    expect(mockState.secureStore.has(AUTH_TOKEN_STORAGE_KEY)).toBe(false);
  });

  it("sends a magic link without creating a session", async () => {
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await result.current.sendMagicLink({ email: "officer@university.edu" });
    });

    // The redirect must be a deep link back into the app, or the emailed link
    // opens a browser page that can never hand the session to the device.
    expect(mockState.signInWithOtpCalls).toEqual([
      {
        email: "officer@university.edu",
        options: { emailRedirectTo: "frapp:///" },
      },
    ]);
    expect(result.current.status).toBe("unauthenticated");
    expect(mockState.secureStore.has(AUTH_TOKEN_STORAGE_KEY)).toBe(false);
  });
});

describe("AuthSessionProvider — magic-link callback", () => {
  it("exchanges tokens from the URL fragment", async () => {
    mockState.deepLinkUrl =
      "frapp://#access_token=deep-link-token&refresh_token=deep-refresh";

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    const { getSupabaseClient } = await import("./supabase");
    const client = vi.mocked(getSupabaseClient)();
    await waitFor(() =>
      expect(client!.auth.setSession).toHaveBeenCalledWith({
        access_token: "deep-link-token",
        refresh_token: "deep-refresh",
      }),
    );
    expect(result.current.callbackError).toBeNull();
  });

  it("surfaces the reason an expired link failed instead of failing silently", async () => {
    mockState.deepLinkUrl =
      "frapp://#error=access_denied&error_description=Email+link+is+invalid+or+has+expired";

    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() =>
      expect(result.current.callbackError).toBe(
        "Email link is invalid or has expired",
      ),
    );
    expect(result.current.status).toBe("unauthenticated");

    const { getSupabaseClient } = await import("./supabase");
    const client = vi.mocked(getSupabaseClient)();
    expect(client!.auth.setSession).not.toHaveBeenCalled();
  });

  it("clears a stale callback error when a new link is requested", async () => {
    mockState.deepLinkUrl = "frapp://#error=access_denied";

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() =>
      expect(result.current.callbackError).toBe("access_denied"),
    );

    await act(async () => {
      await result.current.sendMagicLink({ email: "officer@university.edu" });
    });

    expect(result.current.callbackError).toBeNull();
  });

  it("preserves an encoded '+' in the provider's message", async () => {
    mockState.deepLinkUrl =
      "frapp://#error_description=Rate+limit+hit%3A+wait+1%2B+minutes";

    const { result } = renderHook(() => useAuthSession(), { wrapper });

    // URLSearchParams already turns '+' into a space and %2B into '+'. A second
    // unescaping pass would render this as "1  minutes".
    await waitFor(() =>
      expect(result.current.callbackError).toBe(
        "Rate limit hit: wait 1+ minutes",
      ),
    );
  });

  it("clears a stale callback error once a session arrives", async () => {
    mockState.deepLinkUrl = "frapp://#error=access_denied";

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() =>
      expect(result.current.callbackError).toBe("access_denied"),
    );

    await act(async () => {
      emitAuthChange(SESSION);
    });

    // Otherwise the next sign-out drops the member back on a sign-in screen
    // still showing an error about a link they abandoned.
    await waitFor(() => expect(result.current.callbackError).toBeNull());
  });

  it("ignores a plain app-open deep link carrying no auth params", async () => {
    mockState.deepLinkUrl = "frapp://events";

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    const { getSupabaseClient } = await import("./supabase");
    const client = vi.mocked(getSupabaseClient)();
    expect(client!.auth.setSession).not.toHaveBeenCalled();
    expect(client!.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(result.current.callbackError).toBeNull();
  });
});

describe("sessionStorageAdapter — hostile keystore", () => {
  it("does not let a SecureStore write failure break sign-in", async () => {
    const SecureStore = await import("expo-secure-store");
    vi.mocked(SecureStore.setItemAsync).mockRejectedValue(
      new Error("Could not decrypt the item in SecureStore"),
    );

    // supabase-js awaits these inside _saveSession with no catch, so a rejection
    // here would surface out of signInWithPassword and lock the member out.
    await expect(
      sessionStorageAdapter.setItem("sb-auth", "session"),
    ).resolves.toBeUndefined();
    await expect(
      sessionStorageAdapter.removeItem("sb-auth"),
    ).resolves.toBeUndefined();
  });

  it("reads as absent when SecureStore throws", async () => {
    const SecureStore = await import("expo-secure-store");
    vi.mocked(SecureStore.getItemAsync).mockRejectedValue(
      new Error("keystore unavailable"),
    );

    await expect(sessionStorageAdapter.getItem("sb-auth")).resolves.toBeNull();
  });
});

describe("AuthSessionProvider — unconfigured build", () => {
  it("settles unauthenticated instead of throwing when env vars are missing", async () => {
    mockState.configured = false;
    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    expect(result.current.isConfigured).toBe(false);

    await act(async () => {
      await expect(
        result.current.signInWithPassword({
          email: "officer@university.edu",
          password: "hunter2",
        }),
      ).rejects.toThrow(/not configured/i);
    });
  });
});

describe("useIsApiAuthenticated", () => {
  it("flips to true on sign-in and false on sign-out without a foreground cycle", async () => {
    const { result } = renderHook(
      () => ({
        auth: useAuthSession(),
        isApiAuthenticated: useIsApiAuthenticated(),
      }),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current.auth.status).toBe("unauthenticated"),
    );
    expect(result.current.isApiAuthenticated).toBe(false);

    await act(async () => {
      emitAuthChange(SESSION);
    });

    await waitFor(() => expect(result.current.isApiAuthenticated).toBe(true));

    await act(async () => {
      await result.current.auth.signOut();
    });

    await waitFor(() => expect(result.current.isApiAuthenticated).toBe(false));
  });
});

describe("sessionStorageAdapter", () => {
  it("round-trips a session larger than the SecureStore 2048-byte limit", async () => {
    const value = JSON.stringify({ access_token: "a".repeat(4000) });

    await sessionStorageAdapter.setItem("sb-auth", value);

    // Proof it actually chunked rather than storing one oversized value.
    expect(mockState.secureStore.get("sb-auth")).toBe("7");
    for (const stored of mockState.secureStore.values()) {
      expect(stored.length).toBeLessThanOrEqual(600);
    }
    await expect(sessionStorageAdapter.getItem("sb-auth")).resolves.toBe(value);
  });

  it("drops leftover chunks when a shorter value replaces a longer one", async () => {
    await sessionStorageAdapter.setItem("sb-auth", "x".repeat(2400));
    await sessionStorageAdapter.setItem("sb-auth", "short");

    await expect(sessionStorageAdapter.getItem("sb-auth")).resolves.toBe(
      "short",
    );
    expect(mockState.secureStore.has("sb-auth.1")).toBe(false);
  });

  it("reads a torn write as absent rather than as truncated JSON", async () => {
    await sessionStorageAdapter.setItem("sb-auth", "y".repeat(2400));
    mockState.secureStore.delete("sb-auth.2");

    await expect(sessionStorageAdapter.getItem("sb-auth")).resolves.toBeNull();
  });

  it("removes every chunk", async () => {
    await sessionStorageAdapter.setItem("sb-auth", "z".repeat(2400));
    await sessionStorageAdapter.removeItem("sb-auth");

    expect(mockState.secureStore.size).toBe(0);
    await expect(sessionStorageAdapter.getItem("sb-auth")).resolves.toBeNull();
  });
});
