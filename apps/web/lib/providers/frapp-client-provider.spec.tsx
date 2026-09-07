import { render, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@repo/api-sdk", () => ({
  createFrappClient: (config: { getChapterId: () => string | null }) => ({
    __chapterId: config.getChapterId,
  }),
}));

// Capture what the provider hands down, so a test can assert the client in
// context is already re-scoped at the moment the cache is dropped.
const seen: Array<string | null> = [];
vi.mock("@repo/hooks", () => ({
  FrappClientProvider: ({
    children,
    chapterId,
  }: {
    children: React.ReactNode;
    chapterId: string | null;
  }) => {
    seen.push(chapterId);
    return <>{children}</>;
  },
}));

// The claim → store sync has its own suite (`lib/auth/use-claim-chapter-sync.spec.tsx`);
// here it must not observe auth events the mocked client never emits.
vi.mock("@/lib/auth/use-claim-chapter-sync", () => ({
  useClaimChapterSync: () => undefined,
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

let activeChapterId: string | null = null;
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string | null }) => unknown) =>
    selector({ activeChapterId }),
}));

const { FrappProvider } = await import("./frapp-client-provider");

function setup(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <FrappProvider>
        <div />
      </FrappProvider>
    </QueryClientProvider>,
  );
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/**
 * The chapter-scoped cache drop. Half the query keys in `@repo/hooks` omit the
 * chapter id, so a switch that leaves them cached renders the previous
 * chapter's rows — see spec/behavior/multi-tenancy.md.
 */
describe("FrappProvider chapter-change cache drop", () => {
  beforeEach(() => {
    seen.length = 0;
    activeChapterId = null;
  });

  it("drops cached data when the active chapter changes", async () => {
    activeChapterId = "chap-1";
    const qc = makeClient();
    const { rerender } = setup(qc);

    // One key that carries the chapter id, one that does not. The second is the
    // reason this cannot be an invalidate-by-chapter-key.
    qc.setQueryData(["members", "chap-1"], [{ id: "m-1" }]);
    qc.setQueryData(["channels"], [{ id: "ch-1", name: "alpha-only" }]);

    activeChapterId = "chap-2";
    await act(async () => {
      rerender(
        <QueryClientProvider client={qc}>
          <FrappProvider>
            <div />
          </FrappProvider>
        </QueryClientProvider>,
      );
    });

    expect(qc.getQueryData(["members", "chap-1"])).toBeUndefined();
    expect(qc.getQueryData(["channels"])).toBeUndefined();
  });

  it("has already published the new chapter id before it drops the cache", async () => {
    activeChapterId = "chap-1";
    const qc = makeClient();
    const { rerender } = setup(qc);

    let chapterIdAtClearTime: string | null | undefined;
    const realClear = qc.clear.bind(qc);
    qc.clear = () => {
      chapterIdAtClearTime = seen[seen.length - 1];
      realClear();
    };

    activeChapterId = "chap-2";
    await act(async () => {
      rerender(
        <QueryClientProvider client={qc}>
          <FrappProvider>
            <div />
          </FrappProvider>
        </QueryClientProvider>,
      );
    });

    // If the clear ran before commit, refetches it triggers would go out under
    // the outgoing chapter and repopulate the cache that was just emptied.
    expect(chapterIdAtClearTime).toBe("chap-2");
  });

  it("does not drop the cache on first paint or store rehydration", async () => {
    const qc = makeClient();
    activeChapterId = null;
    const { rerender } = setup(qc);
    qc.setQueryData(["user", "me"], { id: "u-1" });

    // null → a chapter is hydration or a first selection: nothing chapter-scoped
    // can be cached yet, so clearing would only cancel bootstrap queries.
    activeChapterId = "chap-1";
    await act(async () => {
      rerender(
        <QueryClientProvider client={qc}>
          <FrappProvider>
            <div />
          </FrappProvider>
        </QueryClientProvider>,
      );
    });

    expect(qc.getQueryData(["user", "me"])).toEqual({ id: "u-1" });
  });

  it("does not drop the cache on a re-render that keeps the same chapter", async () => {
    activeChapterId = "chap-1";
    const qc = makeClient();
    const { rerender } = setup(qc);
    qc.setQueryData(["channels"], [{ id: "ch-1" }]);

    await act(async () => {
      rerender(
        <QueryClientProvider client={qc}>
          <FrappProvider>
            <div />
          </FrappProvider>
        </QueryClientProvider>,
      );
    });

    expect(qc.getQueryData(["channels"])).toEqual([{ id: "ch-1" }]);
  });
});
