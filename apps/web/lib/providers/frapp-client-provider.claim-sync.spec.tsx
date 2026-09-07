/** @vitest-environment jsdom */
import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChapterStore } from "@/lib/stores/chapter-store";

type AuthCallback = (event: string, session: { access_token: string } | null) => void;

const { listeners } = vi.hoisted(() => ({
  listeners: [] as AuthCallback[],
}));

vi.mock("@repo/api-sdk", () => ({
  createFrappClient: (config: { getChapterId: () => string | null }) => ({
    __chapterId: config.getChapterId,
  }),
}));

vi.mock("@repo/hooks", () => ({
  FrappClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: (cb: AuthCallback) => {
        listeners.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
  }),
}));

const { FrappProvider } = await import("./frapp-client-provider");

const b64url = (obj: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(obj)).toString("base64url");
const tokenFor = (chapter?: string) =>
  `${b64url({ alg: "ES256" })}.${b64url(chapter ? { active_chapter_id: chapter } : { sub: "u" })}.sig`;

const emit = (event: string, chapter?: string | null) =>
  listeners.forEach((cb) =>
    cb(event, chapter === null ? null : { access_token: tokenFor(chapter) }),
  );

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/**
 * Account-boundary composition: a claim-less SIGNED_IN must clear the
 * previous account's persisted chapter and drop the query cache that still
 * holds that account's rows. The hook suite covers the store write; this
 * wires the real hook to FrappProvider so the cache drop (keyed on the store
 * change) is observed, not assumed.
 */
describe("FrappProvider + useClaimChapterSync account boundary", () => {
  beforeEach(() => {
    listeners.length = 0;
    localStorage.clear();
    useChapterStore.setState({ activeChapterId: null, hasHydrated: true });
  });

  it("clears persist and drops the cache when a claim-less SIGNED_IN follows another account's chapter", async () => {
    useChapterStore.setState({
      activeChapterId: "previous-accounts-chapter",
      hasHydrated: true,
    });
    const qc = makeClient();
    qc.setQueryData(["channels"], [{ id: "ch-1", name: "alpha-only" }]);
    qc.setQueryData(["user", "me"], { id: "user-a" });

    render(
      <QueryClientProvider client={qc}>
        <FrappProvider>
          <div />
        </FrappProvider>
      </QueryClientProvider>,
    );

    await act(async () => {});
    expect(qc.getQueryData(["channels"])).toEqual([{ id: "ch-1", name: "alpha-only" }]);

    await act(async () => {
      emit("SIGNED_IN");
    });

    await waitFor(() => {
      expect(useChapterStore.getState().activeChapterId).toBeNull();
      expect(qc.getQueryData(["channels"])).toBeUndefined();
      expect(qc.getQueryData(["user", "me"])).toBeUndefined();
    });
    expect(localStorage.getItem("frapp-active-chapter")).not.toContain(
      "previous-accounts-chapter",
    );
  });

  it("leaves persist and cache alone on a claim-less INITIAL_SESSION (steady-state; the picker's case)", async () => {
    useChapterStore.setState({ activeChapterId: "chap-1", hasHydrated: true });
    const qc = makeClient();
    qc.setQueryData(["channels"], [{ id: "ch-1" }]);

    render(
      <QueryClientProvider client={qc}>
        <FrappProvider>
          <div />
        </FrappProvider>
      </QueryClientProvider>,
    );

    await act(async () => {});
    await act(async () => {
      emit("INITIAL_SESSION");
    });

    expect(useChapterStore.getState().activeChapterId).toBe("chap-1");
    expect(qc.getQueryData(["channels"])).toEqual([{ id: "ch-1" }]);
  });
});
