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
  authChangeHandlers: [] as AuthChangeHandler[],
  signInWithPasswordResult: { error: null as { message: string } | null },
  signInWithOtpResult: { error: null as { message: string } | null },
  signInWithPasswordCalls: [] as Array<{ email: string; password: string }>,
  signInWithOtpCalls: [] as Array<{ email: string }>,
  resendResult: { error: null as { message: string; code?: string } | null },
  resendCalls: [] as Array<Record<string, unknown>>,
  signInWithOAuthCalls: [] as Array<{
    provider: string;
    options?: {
      redirectTo?: string;
      skipBrowserRedirect?: boolean;
      queryParams?: Record<string, string> | undefined;
    };
  }>,
  signInWithOAuthResult: {
    data: { url: "https://accounts.google.com/o/oauth" as string | null },
    error: null as { message: string; code?: string } | null,
  },
  authSessionResult: { type: "success", url: "frapp:///?code=oauth-code" } as {
    type: string;
    url?: string;
  },
  nativeAppleResult: "unavailable" as "completed" | "cancelled" | "unavailable",
  nativeGoogleResult: "unavailable" as
    "completed" | "cancelled" | "unavailable",
  signOutCalls: 0,
  configured: true,
  deepLinkUrl: null as string | null,
}));

const resetObservabilityOnLogout = vi.hoisted(() => vi.fn());

vi.mock("./observability/reset", () => ({
  resetObservabilityOnLogout,
}));

const reportAuthFailure = vi.hoisted(() => vi.fn());

vi.mock("./sentry/auth-failures", () => ({ reportAuthFailure }));

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

const mockAppleAuth = vi.hoisted(() => ({
  signInWithNativeApple: vi.fn(async () => mockState.nativeAppleResult),
}));

vi.mock("./apple-auth", () => ({
  signInWithNativeApple: mockAppleAuth.signInWithNativeApple,
}));

const mockGoogleAuth = vi.hoisted(() => ({
  signInWithNativeGoogle: vi.fn(async () => mockState.nativeGoogleResult),
}));

vi.mock("./google-auth", () => ({
  signInWithNativeGoogle: mockGoogleAuth.signInWithNativeGoogle,
}));

vi.mock("expo-web-browser", () => ({
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: vi.fn(async () => mockState.authSessionResult),
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
      // The chapter claim is decoded from the token (#5768); a call here is
      // the launch round trip coming back.
      getClaims: vi.fn(async () => {
        throw new Error("getClaims is not used: the claim is decoded locally");
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
      resend: vi.fn(async (input: Record<string, unknown>) => {
        mockState.resendCalls.push(input);
        return mockState.resendResult;
      }),
      signInWithOAuth: vi.fn(
        async (input: {
          provider: string;
          options?: {
            redirectTo?: string;
            skipBrowserRedirect?: boolean;
            queryParams?: Record<string, string> | undefined;
          };
        }) => {
          mockState.signInWithOAuthCalls.push(input);
          return mockState.signInWithOAuthResult;
        },
      ),
      signOut: vi.fn(async () => {
        mockState.signOutCalls += 1;
        return { error: null };
      }),
      setSession: vi.fn(async () => ({ data: {}, error: null })),
      exchangeCodeForSession: vi.fn(async () => ({ data: {}, error: null })),
      verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
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
import { DEAD_LINK_COPY, FINISH_FAILED_COPY } from "./auth-providers";
import { AUTH_TOKEN_STORAGE_KEY, readAuthToken } from "./auth-token";
import { useIsApiAuthenticated } from "./use-is-api-authenticated";
import { sessionStorageAdapter, getSupabaseClient } from "./supabase";
import { queryClient } from "./query-client";

/**
 * A cache entry whose key carries no account scope — `["settings"]` and
 * `["user","me"]` are the real ones. These are the entries that would otherwise
 * survive into the next member's session on a shared device.
 */
const ACCOUNT_AGNOSTIC_KEY = ["settings"];
const USER_ME_KEY = ["user", "me"];
const CHAPTER_KEY = ["members", "chapter-uuid-1"];

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

/** An unsigned JWT carrying `claims`: the app only ever decodes the payload. */
function jwt(claims: Record<string, unknown>): string {
  return `e30.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.sig`;
}

/** User 1 in chapter 1, then the same member's refreshed token. */
const TOKEN_1 = jwt({ sub: "user-1", active_chapter_id: "chapter-uuid-1", n: 1 });
const TOKEN_2 = jwt({ sub: "user-1", active_chapter_id: "chapter-uuid-1", n: 2 });
/** Another account in the same chapter: a magic-link swap. */
const TOKEN_2_OTHER_USER = jwt({
  sub: "user-2",
  active_chapter_id: "chapter-uuid-1",
});

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
  mockState.authChangeHandlers = [];
  mockState.signInWithPasswordResult = { error: null };
  mockState.signInWithOtpResult = { error: null };
  mockState.signInWithPasswordCalls = [];
  mockState.signInWithOtpCalls = [];
  mockState.resendResult = { error: null };
  mockState.resendCalls = [];
  mockState.signInWithOAuthCalls = [];
  mockState.signInWithOAuthResult = {
    data: { url: "https://accounts.google.com/o/oauth" },
    error: null,
  };
  mockState.authSessionResult = {
    type: "success",
    url: "frapp:///?code=oauth-code",
  };
  mockState.nativeAppleResult = "unavailable";
  mockState.nativeGoogleResult = "unavailable";
  mockState.signOutCalls = 0;
  mockState.configured = true;
  mockState.deepLinkUrl = null;
  queryClient.clear();
  resetObservabilityOnLogout.mockReset();
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
    // Owned here rather than in each screen: every sign-out goes through this
    // `signOut`, and the picker's own clear landed only after the leak was
    // noticed a second time.
    expect(queryClient.getQueryData(ACCOUNT_AGNOSTIC_KEY)).toBeUndefined();
    expect(resetObservabilityOnLogout).toHaveBeenCalledTimes(1);
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
    expect(resetObservabilityOnLogout).toHaveBeenCalledTimes(1);
  });
});

describe("AuthSessionProvider — chapter context", () => {
  it("resolves chapterId from the active_chapter_id claim", async () => {
    mockState.initialSession = {
      ...SESSION,
      access_token: jwt({ active_chapter_id: "chapter-uuid-1", sub: "user-1" }),
    };

    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() =>
      expect(result.current.chapterId).toBe("chapter-uuid-1"),
    );
  });

  it("reads the claim from the token without a round trip to Supabase Auth (#5768)", async () => {
    // `getClaims` falls back to `getUser()` on Hermes: a network call every
    // launch used to wait on before the first screen could mount.
    mockState.initialSession = {
      ...SESSION,
      access_token: jwt({ active_chapter_id: "chapter-uuid-1", sub: "user-1" }),
    };

    const { result } = renderHook(() => useAuthSession(), { wrapper });

    // The chapter arrives on the same render as the session: the gate never
    // sees an authenticated member whose chapter is still being read.
    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.isChapterResolving).toBe(false);
    expect(result.current.chapterId).toBe("chapter-uuid-1");
    expect(getSupabaseClient()?.auth.getClaims).not.toHaveBeenCalled();
  });

  it("resolves null when the claim is absent (multi-chapter, no selection)", async () => {
    mockState.initialSession = {
      ...SESSION,
      access_token: jwt({ sub: "user-1" }),
    };

    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.isChapterResolving).toBe(false);
    expect(result.current.chapterId).toBeNull();
  });

  it("resolves null for a token it can't read, rather than inventing a chapter", async () => {
    mockState.initialSession = { ...SESSION, access_token: "not-a-jwt" };

    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.isChapterResolving).toBe(false);
    expect(result.current.chapterId).toBeNull();
  });

  it("follows a chapter switch's refreshed token without blocking the gate", async () => {
    mockState.initialSession = {
      ...SESSION,
      access_token: jwt({ active_chapter_id: "chapter-uuid-1", sub: "user-1" }),
      user: { ...SESSION.user, id: "user-1" },
    };

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() =>
      expect(result.current.chapterId).toBe("chapter-uuid-1"),
    );

    // `lib/select-chapter.ts` activates server-side and refreshes the session;
    // the new token's claim is the new chapter.
    await act(async () => {
      emitAuthChange({
        access_token: jwt({
          active_chapter_id: "chapter-uuid-2",
          sub: "user-1",
        }),
        user: { email: "officer@university.edu", id: "user-1" },
      });
    });

    expect(result.current.chapterId).toBe("chapter-uuid-2");
    expect(result.current.isChapterResolving).toBe(false);
  });

  it("drops the chapter when a different account signs in", async () => {
    mockState.initialSession = {
      ...SESSION,
      access_token: TOKEN_1,
      user: { ...SESSION.user, id: "user-1" },
    };

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() =>
      expect(result.current.chapterId).toBe("chapter-uuid-1"),
    );
    expect(result.current.userId).toBe("user-1");

    // A magic link can swap accounts with no sign-out in between. The next
    // member's token names no chapter, so they must not inherit this one.
    await act(async () => {
      emitAuthChange({
        access_token: jwt({ sub: "user-2" }),
        user: { email: "other@university.edu", id: "user-2" },
      });
    });

    await waitFor(() => expect(result.current.chapterId).toBeNull());
    expect(result.current.userId).toBe("user-2");
  });

  it("exposes the new Bearer to child effects on the same turn as a swap", async () => {
    mockState.initialSession = {
      ...SESSION,
      access_token: TOKEN_1,
      user: { ...SESSION.user, id: "user-1" },
    };
    const seen: Array<{ userId: string | null; token: string | null }> = [];

    function Probe() {
      const { userId } = useAuthSession();
      React.useEffect(() => {
        void readAuthToken().then((token) => {
          seen.push({ userId, token });
        });
      }, [userId]);
      return null;
    }

    const { result } = renderHook(() => useAuthSession(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <AuthSessionProvider>
          <Probe />
          {children}
        </AuthSessionProvider>
      ),
    });
    await waitFor(() => expect(result.current.userId).toBe("user-1"));
    await waitFor(() =>
      expect(seen).toContainEqual({
        userId: "user-1",
        token: TOKEN_1,
      }),
    );

    await act(async () => {
      emitAuthChange({
        access_token: TOKEN_2_OTHER_USER,
        user: { email: "other@university.edu", id: "user-2" },
      });
    });

    // Child effects run before the parent token-mirror effect. If the
    // Bearer were only written in that parent effect, this sample would
    // still be User A's token.
    expect(seen).toContainEqual({ userId: "user-2", token: TOKEN_2_OTHER_USER });
  });

  it("drops unscoped product cache after writing the new Bearer on a same-chapter swap", async () => {
    mockState.initialSession = {
      ...SESSION,
      access_token: TOKEN_1,
      user: { ...SESSION.user, id: "user-1" },
    };

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() =>
      expect(result.current.chapterId).toBe("chapter-uuid-1"),
    );

    queryClient.setQueryData(ACCOUNT_AGNOSTIC_KEY, ["outgoing-settings"]);
    queryClient.setQueryData(USER_ME_KEY, { id: "user-a-row" });
    queryClient.setQueryData(CHAPTER_KEY, [{ id: "member-a" }]);

    const realClear = queryClient.clear.bind(queryClient);
    let tokenWhenCleared: Promise<string | null> | undefined;
    queryClient.clear = () => {
      tokenWhenCleared = readAuthToken();
      realClear();
    };

    try {
      await act(async () => {
        emitAuthChange({
          access_token: TOKEN_2_OTHER_USER,
          user: { email: "other@university.edu", id: "user-2" },
        });
      });

      expect(tokenWhenCleared).toBeDefined();
      await expect(tokenWhenCleared).resolves.toBe(TOKEN_2_OTHER_USER);
      expect(queryClient.getQueryData(ACCOUNT_AGNOSTIC_KEY)).toBeUndefined();
      expect(queryClient.getQueryData(USER_ME_KEY)).toBeUndefined();
      expect(queryClient.getQueryData(CHAPTER_KEY)).toBeUndefined();
      expect(result.current.userId).toBe("user-2");
    } finally {
      queryClient.clear = realClear;
    }

    await waitFor(() =>
      expect(result.current.chapterId).toBe("chapter-uuid-1"),
    );
  });

  it("keeps the product cache when the same account refreshes its token", async () => {
    mockState.initialSession = {
      ...SESSION,
      access_token: TOKEN_1,
      user: { ...SESSION.user, id: "user-1" },
    };

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() =>
      expect(result.current.chapterId).toBe("chapter-uuid-1"),
    );

    queryClient.setQueryData(ACCOUNT_AGNOSTIC_KEY, ["keep-me"]);
    queryClient.setQueryData(USER_ME_KEY, { id: "user-a-row" });

    await act(async () => {
      emitAuthChange({
        access_token: TOKEN_2,
        user: { email: "officer@university.edu", id: "user-1" },
      });
    });

    expect(queryClient.getQueryData(ACCOUNT_AGNOSTIC_KEY)).toEqual(["keep-me"]);
    expect(queryClient.getQueryData(USER_ME_KEY)).toEqual({ id: "user-a-row" });
    expect(result.current.userId).toBe("user-1");
    expect(result.current.chapterId).toBe("chapter-uuid-1");
  });

  it("retries what the API refused for the lapsed token once a refreshed one arrives", async () => {
    // FRAPP-API-E, 2026-11-12: back from the background, every query went
    // out with a lapsed token and each screen stayed on its error state.
    mockState.initialSession = {
      ...SESSION,
      access_token: TOKEN_1,
      user: { ...SESSION.user, id: "user-1" },
    };

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() =>
      expect(result.current.chapterId).toBe("chapter-uuid-1"),
    );

    let calls = 0;
    const refused = Object.assign(new Error("Unauthorized"), { status: 401 });
    const notFound = Object.assign(new Error("Not found"), { status: 404 });
    const refusedFn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw refused;
      return ["channels"];
    });
    const missingFn = vi.fn(async () => {
      throw notFound;
    });
    await queryClient
      .fetchQuery({
        queryKey: ["channels", "refused"],
        queryFn: refusedFn,
        retry: false,
      })
      .catch(() => undefined);
    await queryClient
      .fetchQuery({
        queryKey: ["channels", "missing"],
        queryFn: missingFn,
        retry: false,
      })
      .catch(() => undefined);
    expect(queryClient.getQueryState(["channels", "refused"])?.status).toBe(
      "error",
    );

    await act(async () => {
      emitAuthChange({
        access_token: TOKEN_2,
        user: { email: "officer@university.edu", id: "user-1" },
      });
    });

    await waitFor(() =>
      expect(queryClient.getQueryData(["channels", "refused"])).toEqual([
        "channels",
      ]),
    );
    // A failure that wasn't about the token is left alone.
    expect(missingFn).toHaveBeenCalledTimes(1);
  });

  it("retries a 401 that lands after the refreshed token arrived, once", async () => {
    // The request went out with the lapsed token and its 401 came back after
    // the refresh had landed, so the sweep on the token change missed it.
    mockState.initialSession = {
      ...SESSION,
      access_token: TOKEN_1,
      user: { ...SESSION.user, id: "user-1" },
    };

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() =>
      expect(result.current.chapterId).toBe("chapter-uuid-1"),
    );

    let release: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const refused = Object.assign(new Error("Unauthorized"), { status: 401 });
    const lateFn = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        await inFlight;
        throw refused;
      }
      return ["tasks"];
    });
    const pending = queryClient
      .fetchQuery({
        queryKey: ["tasks", "late"],
        queryFn: lateFn,
        retry: false,
      })
      .catch(() => undefined);

    await act(async () => {
      emitAuthChange({
        access_token: TOKEN_2,
        user: { email: "officer@university.edu", id: "user-1" },
      });
    });
    release();
    await pending;

    await waitFor(() =>
      expect(queryClient.getQueryData(["tasks", "late"])).toEqual(["tasks"]),
    );
    expect(lateFn).toHaveBeenCalledTimes(2);
  });

  it("leaves a 401 alone when the same token is emitted again", async () => {
    mockState.initialSession = {
      ...SESSION,
      access_token: TOKEN_1,
      user: { ...SESSION.user, id: "user-1" },
    };

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() =>
      expect(result.current.chapterId).toBe("chapter-uuid-1"),
    );

    const refused = Object.assign(new Error("Unauthorized"), { status: 401 });
    const refusedFn = vi.fn(async () => {
      throw refused;
    });
    await queryClient
      .fetchQuery({
        queryKey: ["events", "refused"],
        queryFn: refusedFn,
        retry: false,
      })
      .catch(() => undefined);

    await act(async () => {
      emitAuthChange({
        ...SESSION,
        access_token: TOKEN_1,
        user: { ...SESSION.user, id: "user-1" },
      });
    });

    // The API already refused this token; sending it again would only 401.
    expect(refusedFn).toHaveBeenCalledTimes(1);
  });

  it("leaves a 401 to the chapter switch when the new token names another chapter", async () => {
    mockState.initialSession = {
      ...SESSION,
      access_token: TOKEN_1,
      user: { ...SESSION.user, id: "user-1" },
    };

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() =>
      expect(result.current.chapterId).toBe("chapter-uuid-1"),
    );

    const refused = Object.assign(new Error("Unauthorized"), { status: 401 });
    const refusedFn = vi.fn(async () => {
      throw refused;
    });
    await queryClient
      .fetchQuery({
        queryKey: ["dues", "refused"],
        queryFn: refusedFn,
        retry: false,
      })
      .catch(() => undefined);

    await act(async () => {
      emitAuthChange({
        access_token: jwt({
          sub: "user-1",
          active_chapter_id: "chapter-uuid-2",
        }),
        user: { email: "officer@university.edu", id: "user-1" },
      });
    });

    // Sent now, it would carry the old chapter's header with the new claim.
    expect(refusedFn).toHaveBeenCalledTimes(1);
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

  it("reports a refused sign-in by its error, never the credentials (#3832)", async () => {
    mockState.signInWithPasswordResult = {
      error: { message: "Invalid login credentials" },
    };
    reportAuthFailure.mockClear();
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await result.current
        .signInWithPassword({
          email: "officer@university.edu",
          password: "wrong",
        })
        .catch(() => undefined);
    });

    expect(reportAuthFailure).toHaveBeenCalledTimes(1);
    const [input] = reportAuthFailure.mock.calls[0]!;
    expect(input).toEqual({
      flow: "password_sign_in",
      screen: "/sign-in",
      error: { message: "Invalid login credentials" },
    });
    expect(JSON.stringify(input)).not.toContain("officer@university.edu");
    expect(JSON.stringify(input)).not.toContain("wrong");
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
        options: { emailRedirectTo: "frapp:///?" },
      },
    ]);
    expect(result.current.status).toBe("unauthenticated");
    expect(mockState.secureStore.has(AUTH_TOKEN_STORAGE_KEY)).toBe(false);
  });
});

describe("AuthSessionProvider — confirmation resend (#3833)", () => {
  it("resends the sign-up confirmation back into the app", async () => {
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await result.current.resendConfirmation({
        email: "officer@university.edu",
      });
    });

    // The magic link's redirect, so the link opens this app, not a browser.
    expect(mockState.resendCalls).toEqual([
      {
        type: "signup",
        email: "officer@university.edu",
        options: { emailRedirectTo: "frapp:///?" },
      },
    ]);
  });

  it("reports and rethrows a refused resend", async () => {
    mockState.resendResult = {
      error: {
        message:
          "For security purposes, you can only request this after 30 seconds.",
        code: "over_email_send_rate_limit",
      },
    };
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await expect(
      result.current.resendConfirmation({ email: "officer@university.edu" }),
    ).rejects.toMatchObject({ code: "over_email_send_rate_limit" });
    expect(reportAuthFailure).toHaveBeenCalledWith(
      expect.objectContaining({ flow: "confirmation_resend" }),
    );
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
    // GoTrue's redirect for a dead email link, as it sends it.
    mockState.deepLinkUrl =
      "frapp://#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

    const { result } = renderHook(() => useAuthSession(), { wrapper });

    // In Frapp's words, read from the code; never GoTrue's sentence (#3833).
    await waitFor(() =>
      expect(result.current.callbackError).toBe(DEAD_LINK_COPY),
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
      expect(result.current.callbackError).toBe(FINISH_FAILED_COPY),
    );

    await act(async () => {
      await result.current.sendMagicLink({ email: "officer@university.edu" });
    });

    expect(result.current.callbackError).toBeNull();
  });

  it("never shows the provider's own sentence", async () => {
    mockState.deepLinkUrl =
      "frapp://#error_description=Rate+limit+hit%3A+wait+1%2B+minutes";

    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() =>
      expect(result.current.callbackError).toBe(FINISH_FAILED_COPY),
    );
  });

  it("clears a stale callback error once a session arrives", async () => {
    mockState.deepLinkUrl = "frapp://#error=access_denied";

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() =>
      expect(result.current.callbackError).toBe(FINISH_FAILED_COPY),
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
    expect(client!.auth.verifyOtp).not.toHaveBeenCalled();
    expect(result.current.callbackError).toBeNull();
  });

  it("verifies a token_hash on the app scheme without going through supabase.co", async () => {
    mockState.deepLinkUrl = "frapp:///?token_hash=pkce_hash&type=magiclink";

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    const { getSupabaseClient } = await import("./supabase");
    const client = vi.mocked(getSupabaseClient)();
    await waitFor(() =>
      expect(client!.auth.verifyOtp).toHaveBeenCalledWith({
        token_hash: "pkce_hash",
        type: "magiclink",
      }),
    );
    expect(client!.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(result.current.callbackError).toBeNull();
  });

  it("reports a dead link by its code, never its URL (#3832)", async () => {
    reportAuthFailure.mockClear();
    mockState.deepLinkUrl =
      "frapp://#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.callbackError).not.toBeNull());

    expect(reportAuthFailure).toHaveBeenCalledWith({
      flow: "auth_callback",
      screen: "/sign-in",
      error: undefined,
      code: "otp_expired",
    });
    expect(JSON.stringify(reportAuthFailure.mock.calls)).not.toContain(
      "frapp:",
    );
  });

  it("reports a provider's bare `error` identifier when the link has no error_code", async () => {
    reportAuthFailure.mockClear();
    mockState.deepLinkUrl =
      "frapp://#error=access_denied&error_description=User+denied+access";

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.callbackError).not.toBeNull());

    expect(reportAuthFailure).toHaveBeenCalledWith({
      flow: "auth_callback",
      screen: "/sign-in",
      error: undefined,
      code: "access_denied",
    });
    expect(JSON.stringify(reportAuthFailure.mock.calls)).not.toContain(
      "denied access",
    );
  });

  it("reports a code exchange Auth refused, with nothing from the link", async () => {
    reportAuthFailure.mockClear();
    mockState.deepLinkUrl = "frapp:///?code=single-use-secret";
    const { getSupabaseClient } = await import("./supabase");
    const client = vi.mocked(getSupabaseClient)();
    const refusal = {
      name: "AuthApiError",
      status: 400,
      code: "bad_code_verifier",
      message: "invalid",
    };
    vi.mocked(client!.auth.exchangeCodeForSession).mockResolvedValueOnce({
      data: { session: null, user: null },
      error: refusal,
    } as never);

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.callbackError).not.toBeNull());

    expect(reportAuthFailure).toHaveBeenCalledWith({
      flow: "auth_callback",
      screen: "/sign-in",
      error: refusal,
      code: undefined,
    });
    expect(JSON.stringify(reportAuthFailure.mock.calls)).not.toContain(
      "single-use-secret",
    );
  });

  it("maps an OAuth identity collision on the callback URL", async () => {
    mockState.deepLinkUrl =
      "frapp://#error=server_error&error_code=identity_already_exists&error_description=Identity+already+exists";

    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() =>
      expect(result.current.callbackError).toMatch(/already exists/i),
    );
    const { getSupabaseClient } = await import("./supabase");
    const client = vi.mocked(getSupabaseClient)();
    expect(client!.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});

describe("AuthSessionProvider — OAuth", () => {
  it("kicks off Google toward the magic-link redirect URL", async () => {
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await result.current.signInWithOAuthProvider("google");
    });

    expect(mockState.signInWithOAuthCalls).toEqual([
      {
        provider: "google",
        options: {
          redirectTo: "frapp:///?",
          skipBrowserRedirect: true,
          queryParams: { prompt: "select_account" },
        },
      },
    ]);
    const { getSupabaseClient } = await import("./supabase");
    const client = vi.mocked(getSupabaseClient)();
    await waitFor(() =>
      expect(client!.auth.exchangeCodeForSession).toHaveBeenCalledWith(
        "oauth-code",
      ),
    );
    const WebBrowser = await import("expo-web-browser");
    expect(WebBrowser.openAuthSessionAsync).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth",
      "frapp:///?",
    );
  });

  it("uses native Apple and skips the browser session", async () => {
    mockState.nativeAppleResult = "completed";
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await result.current.signInWithOAuthProvider("apple");
    });

    expect(mockAppleAuth.signInWithNativeApple).toHaveBeenCalled();
    expect(mockState.signInWithOAuthCalls).toEqual([]);
    const WebBrowser = await import("expo-web-browser");
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it("uses native Google and skips the browser session", async () => {
    mockState.nativeGoogleResult = "completed";
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await result.current.signInWithOAuthProvider("google");
    });

    expect(mockGoogleAuth.signInWithNativeGoogle).toHaveBeenCalled();
    expect(mockAppleAuth.signInWithNativeApple).not.toHaveBeenCalled();
    expect(mockState.signInWithOAuthCalls).toEqual([]);
    const WebBrowser = await import("expo-web-browser");
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it("treats a cancelled native Google sheet as done, with no browser fallback", async () => {
    mockState.nativeGoogleResult = "cancelled";
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await expect(
        result.current.signInWithOAuthProvider("google"),
      ).resolves.toBeUndefined();
    });

    expect(result.current.callbackError).toBeNull();
    expect(mockState.signInWithOAuthCalls).toEqual([]);
  });

  it("treats a cancelled native Apple prompt as success with no error", async () => {
    mockState.nativeAppleResult = "cancelled";
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await expect(
        result.current.signInWithOAuthProvider("apple"),
      ).resolves.toBeUndefined();
    });

    expect(result.current.callbackError).toBeNull();
    expect(mockState.signInWithOAuthCalls).toEqual([]);
  });

  it("maps a colliding Google identity to password/magic-link copy", async () => {
    mockState.signInWithOAuthResult = {
      data: { url: null },
      error: {
        message: "A user with this email address has already been registered",
        code: "identity_already_exists",
      },
    };
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await expect(
        result.current.signInWithOAuthProvider("google"),
      ).rejects.toThrow(/already exists/i);
    });
    const WebBrowser = await import("expo-web-browser");
    expect(WebBrowser.openAuthSessionAsync).not.toHaveBeenCalled();
  });

  it("reports a provider refusal once, as oauth_start with its code (#3832)", async () => {
    reportAuthFailure.mockClear();
    const refusal = {
      message: "A user with this email address has already been registered",
      code: "identity_already_exists",
    };
    mockState.signInWithOAuthResult = { data: { url: null }, error: refusal };
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await result.current
        .signInWithOAuthProvider("google")
        .catch(() => undefined);
    });
    expect(reportAuthFailure).toHaveBeenCalledTimes(1);
    expect(reportAuthFailure).toHaveBeenCalledWith({
      flow: "oauth_start",
      screen: "/sign-in",
      error: refusal,
    });
  });

  it("reports a browser return that didn't become a session once, as auth_callback, not again as oauth_start", async () => {
    reportAuthFailure.mockClear();
    mockState.authSessionResult = {
      type: "success",
      url: "frapp:///#error=access_denied&error_code=otp_expired&error_description=Expired",
    };
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await result.current
        .signInWithOAuthProvider("google")
        .catch(() => undefined);
    });
    expect(reportAuthFailure).toHaveBeenCalledTimes(1);
    expect(reportAuthFailure.mock.calls[0]![0]).toMatchObject({
      flow: "auth_callback",
      code: "otp_expired",
    });
  });

  it("reports the browser session giving out as oauth_start, and a cancel not at all", async () => {
    reportAuthFailure.mockClear();
    mockState.authSessionResult = { type: "cancel" };
    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));
    await act(async () => {
      await result.current.signInWithOAuthProvider("google");
    });
    expect(reportAuthFailure).not.toHaveBeenCalled();

    mockState.authSessionResult = { type: "locked" };
    await act(async () => {
      await result.current
        .signInWithOAuthProvider("google")
        .catch(() => undefined);
    });
    expect(reportAuthFailure).toHaveBeenCalledTimes(1);
    expect(reportAuthFailure.mock.calls[0]![0]).toMatchObject({
      flow: "oauth_start",
    });
  });

  it("does not exchange a single-use code twice when the deep link repeats", async () => {
    const oauthUrl = "frapp:///?code=oauth-once";
    mockState.authSessionResult = { type: "success", url: oauthUrl };

    const { result, rerender } = renderHook(() => useAuthSession(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    await act(async () => {
      await result.current.signInWithOAuthProvider("google");
    });

    const { getSupabaseClient } = await import("./supabase");
    const client = vi.mocked(getSupabaseClient)();
    expect(client!.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);

    mockState.deepLinkUrl = oauthUrl;
    rerender();

    await act(async () => {
      await Promise.resolve();
    });
    expect(client!.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it("does not exchange twice or throw when the deep link arrives first", async () => {
    const oauthUrl = "frapp:///?code=oauth-once";
    mockState.deepLinkUrl = oauthUrl;
    mockState.authSessionResult = { type: "success", url: oauthUrl };

    const { result } = renderHook(() => useAuthSession(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("unauthenticated"));

    const { getSupabaseClient } = await import("./supabase");
    const client = vi.mocked(getSupabaseClient)();
    await waitFor(() =>
      expect(client!.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1),
    );

    vi.mocked(client!.auth.exchangeCodeForSession).mockResolvedValueOnce({
      data: { session: null, user: null },
      error: {
        message:
          "invalid request: both auth code and code verifier should be non-empty",
      },
    } as never);

    await act(async () => {
      await expect(
        result.current.signInWithOAuthProvider("google"),
      ).resolves.toBeUndefined();
    });
    expect(client!.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
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
