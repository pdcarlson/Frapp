/** @vitest-environment jsdom */
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthChangeHandler = (
  event: string,
  session: { access_token: string; user: { email: string } } | null,
) => void;

const mockState = vi.hoisted(() => ({
  /** Backing store for the mocked SecureStore — key -> value. */
  secureStore: new Map<string, string>(),
  /** Session returned by getSession() on mount. */
  initialSession: null as {
    access_token: string;
    user: { email: string };
  } | null,
  claims: null as Record<string, unknown> | null,
  claimsError: null as { message: string } | null,
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
      getClaims: vi.fn(async () => ({
        data: mockState.claims ? { claims: mockState.claims } : null,
        error: mockState.claimsError,
      })),
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
import { sessionStorageAdapter } from "./supabase";

function wrapper({ children }: { children: React.ReactNode }) {
  return <AuthSessionProvider>{children}</AuthSessionProvider>;
}

function emitAuthChange(
  session: { access_token: string; user: { email: string } } | null,
) {
  for (const handler of [...mockState.authChangeHandlers]) {
    handler(session ? "SIGNED_IN" : "SIGNED_OUT", session);
  }
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
  mockState.authChangeHandlers = [];
  mockState.signInWithPasswordResult = { error: null };
  mockState.signInWithOtpResult = { error: null };
  mockState.signInWithPasswordCalls = [];
  mockState.signInWithOtpCalls = [];
  mockState.signOutCalls = 0;
  mockState.configured = true;
  mockState.deepLinkUrl = null;
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

    await act(async () => {
      await result.current.signOut();
    });

    await waitFor(() =>
      expect(mockState.secureStore.has(AUTH_TOKEN_STORAGE_KEY)).toBe(false),
    );
    expect(mockState.signOutCalls).toBe(1);
    expect(result.current.status).toBe("unauthenticated");
    expect(result.current.chapterId).toBeNull();
  });

  it("signs out locally, without throwing, when the remote revoke fails", async () => {
    mockState.initialSession = SESSION;
    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() =>
      expect(mockState.secureStore.get(AUTH_TOKEN_STORAGE_KEY)).toBe(
        "access-token-1",
      ),
    );

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

    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.chapterId).toBeNull();
  });

  it("resolves null rather than guessing when claim verification errors", async () => {
    mockState.initialSession = SESSION;
    mockState.claims = { active_chapter_id: "chapter-uuid-1" };
    mockState.claimsError = { message: "jwks unreachable" };

    const { result } = renderHook(() => useAuthSession(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("authenticated"));
    expect(result.current.chapterId).toBeNull();
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
