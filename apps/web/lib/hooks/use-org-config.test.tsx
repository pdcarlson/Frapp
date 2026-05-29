import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockPatch } = vi.hoisted(() => ({ mockPatch: vi.fn() }));

// Stub the workspace data layer; the hook only needs a PATCH-capable client
// and an active chapter id.
vi.mock("@repo/hooks", () => ({
  useFrappClient: () => ({ PATCH: mockPatch }),
  useActiveChapterId: () => "chap-1",
}));

const { usePatchOrgConfig } = await import("./use-org-config");

const QUERY_KEY = ["chapter-config", "chap-1"] as const;

function makeWrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe("usePatchOrgConfig optimistic cache", () => {
  beforeEach(() => {
    mockPatch.mockReset();
  });

  it("optimistically merges the diff into the cache on mutate", async () => {
    const qc = makeClient();
    qc.setQueryData(QUERY_KEY, { enabled_modules: { events: true, tasks: true } });
    mockPatch.mockResolvedValueOnce({ data: {}, error: undefined });

    const { result } = renderHook(() => usePatchOrgConfig(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current.mutateAsync({ enabled_modules: { events: false } });
    });

    const cached = qc.getQueryData<{
      enabled_modules: Record<string, boolean>;
    }>(QUERY_KEY);
    // events flipped, tasks preserved (one-level merge of the json column).
    expect(cached?.enabled_modules.events).toBe(false);
    expect(cached?.enabled_modules.tasks).toBe(true);
  });

  it("rolls the cache back to the previous value when the PATCH fails", async () => {
    const qc = makeClient();
    qc.setQueryData(QUERY_KEY, { vocabulary: { recruitment: "Rush" } });
    mockPatch.mockResolvedValueOnce({ data: undefined, error: { message: "boom" } });

    const { result } = renderHook(() => usePatchOrgConfig(), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await result.current
        .mutateAsync({ vocabulary: { recruitment: "Intake" } })
        .catch(() => undefined);
    });

    const cached = qc.getQueryData<{ vocabulary: Record<string, string> }>(
      QUERY_KEY,
    );
    expect(cached?.vocabulary.recruitment).toBe("Rush");
  });
});
