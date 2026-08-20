import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, beforeEach, vi } from "vitest";
// Static import, not `await import()`: this package compiles as CommonJS under
// NodeNext, where top-level await is an error. Vitest hoists `vi.mock` above
// imports regardless, so the stub below still lands before the module loads —
// the same shape every other spec in this package uses.
import { usePatchOrgConfig, usePendingConfigKeys } from "./use-org-config";

const { mockPatch } = vi.hoisted(() => ({ mockPatch: vi.fn() }));

// Stub the client provider; the hook only needs a PATCH-capable client and an
// active chapter id. Spread the real module rather than listing exports, per
// the convention in use-members.spec.tsx — a bare factory replaces the module
// wholesale, so the day this hook reaches for a third export the failure points
// here instead of at the call site.
vi.mock("./use-frapp-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-frapp-client")>()),
  useFrappClient: () => ({ PATCH: mockPatch }),
  useActiveChapterId: () => "chap-1",
}));

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

describe("usePendingConfigKeys (#881)", () => {
  beforeEach(() => {
    mockPatch.mockReset();
  });

  it("reports only the in-flight config leaves so sibling controls stay interactive", async () => {
    const qc = makeClient();
    let resolvePatch!: (value: { data: unknown; error: unknown }) => void;
    mockPatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );

    const { result } = renderHook(
      () => ({
        patch: usePatchOrgConfig(),
        pending: usePendingConfigKeys(),
      }),
      { wrapper: makeWrapper(qc) },
    );

    act(() => {
      void result.current.patch.mutateAsync({
        enabled_modules: { events: false },
      });
    });

    await waitFor(() => {
      expect(result.current.pending.has("enabled_modules")).toBe(true);
      expect(result.current.pending.has("enabled_modules.events")).toBe(true);
    });
    expect(result.current.pending.has("enabled_modules.tasks")).toBe(false);
    expect(result.current.pending.has("dues")).toBe(false);
    expect(result.current.pending.has("branding")).toBe(false);

    await act(async () => {
      resolvePatch({ data: {}, error: undefined });
    });

    await waitFor(() => {
      expect(result.current.pending.size).toBe(0);
    });
  });
});
