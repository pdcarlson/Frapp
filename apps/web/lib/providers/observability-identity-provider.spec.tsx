import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindPostHogAdapterForTests,
  createMemoryPostHogAdapter,
} from "@repo/observability/identified-posthog";

const HEX = "a".repeat(64);
const OTHER = "b".repeat(64);
const UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
const EMAIL = "treasurer@chapter.example.edu";

const state = vi.hoisted(() => ({
  authUserId: "web-user-a" as string | null,
  chapterId: "chap-1" as string | null,
  get: vi.fn(),
  dsn: "https://examplepublickey@o0.ingest.sentry.io/0" as string | undefined,
  posthog: true,
}));

const setUser = vi.hoisted(() => vi.fn());

vi.mock("@repo/hooks", () => ({
  useFrappClient: () => ({ GET: state.get }),
  useActiveChapterId: () => state.chapterId,
}));

vi.mock("@/lib/auth/use-auth-user-id", () => ({
  useAuthUserId: () => state.authUserId,
}));

vi.mock("@/lib/sentry/options", () => ({
  webSentryDsn: () => state.dsn,
}));

vi.mock("@/lib/posthog/config", () => ({
  isPostHogConfigured: () => state.posthog,
}));

vi.mock("@sentry/nextjs", () => ({
  setUser: setUser,
}));

const { ObservabilityIdentityProvider } = await import(
  "./observability-identity-provider"
);

function identityTree(qc: QueryClient) {
  return (
    <QueryClientProvider client={qc}>
      <ObservabilityIdentityProvider>
        <div />
      </ObservabilityIdentityProvider>
    </QueryClientProvider>
  );
}

function renderProvider(client?: QueryClient) {
  const qc =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  return render(identityTree(qc));
}

describe("ObservabilityIdentityProvider", () => {
  beforeEach(() => {
    state.authUserId = "web-user-a";
    state.chapterId = "chap-1";
    state.dsn = "https://examplepublickey@o0.ingest.sentry.io/0";
    state.posthog = true;
    state.get.mockReset();
    setUser.mockReset();
    bindPostHogAdapterForTests(null);
  });

  afterEach(() => {
    bindPostHogAdapterForTests(null);
  });

  it("identifies, groups, and sets Sentry user from validated hex", async () => {
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
    expect(memory.calls).toEqual(
      expect.arrayContaining([
        { type: "identify", distinctId: HEX },
        { type: "group", groupType: "chapter", groupKey: OTHER },
      ]),
    );
    expect(state.get).toHaveBeenCalledWith("/v1/analytics/identity");
  });

  it("ignores a raw user id or email from a malformed identity payload", async () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    state.get.mockResolvedValue({
      data: {
        enabled: true,
        distinct_id: EMAIL,
        chapter_group_id: UUID,
      },
      error: undefined,
    });

    renderProvider();

    await waitFor(() => {
      expect(setUser).toHaveBeenCalledWith(null);
    });
    expect(JSON.stringify(memory.calls)).not.toContain(EMAIL);
    expect(JSON.stringify(memory.calls)).not.toContain(UUID);
    expect(memory.calls.some((c) => c.type === "identify")).toBe(false);
  });

  it("refetches chapter_group_id when the chapter changes", async () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    state.get.mockImplementation(async () => ({
      data: {
        enabled: true,
        distinct_id: HEX,
        chapter_group_id: state.chapterId === "chap-2" ? OTHER : HEX,
      },
      error: undefined,
    }));

    const first = renderProvider();
    await waitFor(() => {
      expect(memory.calls).toEqual(
        expect.arrayContaining([
          { type: "group", groupType: "chapter", groupKey: HEX },
        ]),
      );
    });
    first.unmount();

    state.chapterId = "chap-2";
    renderProvider();
    await waitFor(() => {
      expect(memory.calls).toEqual(
        expect.arrayContaining([
          { type: "group", groupType: "chapter", groupKey: OTHER },
        ]),
      );
    });
  });

  it("skips the identity request when neither Sentry nor PostHog is configured", () => {
    state.dsn = undefined;
    state.posthog = false;
    renderProvider();
    expect(state.get).not.toHaveBeenCalled();
  });

  it("does not fetch under the none subject before the auth uid is known", () => {
    state.authUserId = null;
    renderProvider();
    expect(state.get).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
  });

  it("does not keep the previous member's hex after a same-tab account swap", async () => {
    const otherHex = "c".repeat(64);
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    state.get.mockImplementation(async () => ({
      data: {
        enabled: true,
        distinct_id: state.authUserId === "web-user-b" ? otherHex : HEX,
        chapter_group_id: OTHER,
      },
      error: undefined,
    }));

    const view = render(identityTree(qc));
    await waitFor(() => {
      expect(setUser).toHaveBeenCalledWith({ id: HEX });
    });

    state.authUserId = "web-user-b";
    view.rerender(identityTree(qc));

    await waitFor(() => {
      expect(setUser).toHaveBeenCalledWith({ id: otherHex });
    });
    expect(state.get).toHaveBeenCalledTimes(2);
    expect(memory.calls).toEqual(
      expect.arrayContaining([
        { type: "identify", distinctId: HEX },
        { type: "reset" },
        { type: "identify", distinctId: otherHex },
      ]),
    );
    expect(memory.adapter.getDistinctId()).toBe(otherHex);
  });
});
