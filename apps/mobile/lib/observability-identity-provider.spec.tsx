/** @vitest-environment jsdom */
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindPostHogAdapterForTests,
  createMemoryPostHogAdapter,
} from "@repo/observability";

const HEX = "a".repeat(64);
const OTHER = "b".repeat(64);

const state = vi.hoisted(() => ({
  chapterId: "chap-1" as string | null,
  status: "authenticated" as "authenticated" | "unauthenticated" | "hydrating",
  get: vi.fn(),
  dsn: "https://examplepublickey@o0.ingest.sentry.io/0" as string | undefined,
  posthog: true,
}));

const setUser = vi.hoisted(() => vi.fn());

vi.mock("@repo/hooks", () => ({
  useFrappClient: () => ({ GET: state.get }),
  useActiveChapterId: () => state.chapterId,
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ status: state.status }),
}));

vi.mock("@/lib/sentry/options", () => ({
  mobileSentryDsn: () => state.dsn,
}));

vi.mock("@/lib/posthog/config", () => ({
  isPostHogConfigured: () => state.posthog,
}));

vi.mock("@sentry/react-native", () => ({
  setUser,
}));

const { ObservabilityIdentityProvider } = await import(
  "./observability-identity-provider"
);

function renderProvider() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ObservabilityIdentityProvider>
        <div />
      </ObservabilityIdentityProvider>
    </QueryClientProvider>,
  );
}

describe("ObservabilityIdentityProvider", () => {
  beforeEach(() => {
    state.chapterId = "chap-1";
    state.status = "authenticated";
    state.dsn = "https://examplepublickey@o0.ingest.sentry.io/0";
    state.posthog = true;
    state.get.mockReset();
    setUser.mockReset();
    bindPostHogAdapterForTests(null);
  });

  afterEach(() => {
    bindPostHogAdapterForTests(null);
  });

  it("wires the shared helper after the member is authenticated", async () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    state.get.mockResolvedValue({
      data: { enabled: true, distinct_id: HEX, chapter_group_id: OTHER },
      error: undefined,
    });
    renderProvider();
    await waitFor(() => {
      expect(setUser).toHaveBeenCalledWith({ id: HEX });
    });
    expect(state.get).toHaveBeenCalledWith("/v1/analytics/identity");
  });

  it("skips the identity request when neither Sentry nor PostHog is configured", () => {
    state.dsn = undefined;
    state.posthog = false;
    renderProvider();
    expect(state.get).not.toHaveBeenCalled();
  });

  it("skips the identity request until the member is authenticated", () => {
    state.status = "unauthenticated";
    renderProvider();
    expect(state.get).not.toHaveBeenCalled();
  });
});
