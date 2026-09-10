/** @vitest-environment jsdom */
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindPostHogAdapterForTests,
  createMemoryPostHogAdapter,
} from "@repo/observability/identified-posthog";

const DISTINCT = "c".repeat(64);
const CHAPTER_GROUP = "d".repeat(64);
const RAW_EMAIL = "treasurer@chapter.example.edu";
const RAW_UUID = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";

const session = vi.hoisted(() => ({
  auth: "authenticated" as "authenticated" | "unauthenticated" | "hydrating",
  userId: "mobile-user-a" as string | null,
  chapter: "mobile-chap" as string | null,
  getIdentity: vi.fn(),
  sentryDsn: "https://examplepublickey@o0.ingest.sentry.io/0" as
    | string
    | undefined,
  posthogReady: true,
}));

const sentrySetUser = vi.hoisted(() => vi.fn());

vi.mock("@repo/hooks", () => ({
  useFrappClient: () => ({ GET: session.getIdentity }),
  useActiveChapterId: () => session.chapter,
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ status: session.auth, userId: session.userId }),
}));

vi.mock("@/lib/sentry/options", () => ({
  mobileSentryDsn: () => session.sentryDsn,
}));

vi.mock("@/lib/posthog/config", () => ({
  isPostHogConfigured: () => session.posthogReady,
}));

vi.mock("@sentry/react-native", () => ({
  setUser: sentrySetUser,
}));

const { ObservabilityIdentityProvider } = await import(
  "./observability-identity-provider"
);

function mountIdentityTree(client?: QueryClient) {
  const queryClient =
    client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  return render(
    <QueryClientProvider client={queryClient}>
      <ObservabilityIdentityProvider>
        <span>child</span>
      </ObservabilityIdentityProvider>
    </QueryClientProvider>,
  );
}

describe("mobile ObservabilityIdentityProvider", () => {
  beforeEach(() => {
    session.chapter = "mobile-chap";
    session.userId = "mobile-user-a";
    session.auth = "authenticated";
    session.sentryDsn = "https://examplepublickey@o0.ingest.sentry.io/0";
    session.posthogReady = true;
    session.getIdentity.mockReset();
    sentrySetUser.mockReset();
    bindPostHogAdapterForTests(null);
  });

  afterEach(() => {
    bindPostHogAdapterForTests(null);
  });

  it("fetches identity only after auth, then applies the shared helper", async () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    session.getIdentity.mockResolvedValue({
      data: {
        enabled: true,
        distinct_id: DISTINCT,
        chapter_group_id: CHAPTER_GROUP,
      },
      error: undefined,
    });

    mountIdentityTree();

    await waitFor(() => {
      expect(sentrySetUser).toHaveBeenCalledWith({ id: DISTINCT });
    });
    expect(session.getIdentity).toHaveBeenCalledWith("/v1/analytics/identity");
    expect(memory.calls).toEqual(
      expect.arrayContaining([
        { type: "identify", distinctId: DISTINCT },
        { type: "group", groupType: "chapter", groupKey: CHAPTER_GROUP },
      ]),
    );
  });

  it("does not call GET /v1/analytics/identity on the auth screens", () => {
    session.auth = "unauthenticated";
    mountIdentityTree();
    expect(session.getIdentity).not.toHaveBeenCalled();
    expect(sentrySetUser).not.toHaveBeenCalled();
  });

  it("does not call GET /v1/analytics/identity while hydrating", () => {
    session.auth = "hydrating";
    mountIdentityTree();
    expect(session.getIdentity).not.toHaveBeenCalled();
  });

  it("does not call GET /v1/analytics/identity when both vendors are dark", () => {
    session.sentryDsn = undefined;
    session.posthogReady = false;
    mountIdentityTree();
    expect(session.getIdentity).not.toHaveBeenCalled();
  });

  it("still fetches when only the Expo Sentry DSN is set", async () => {
    session.posthogReady = false;
    session.getIdentity.mockResolvedValue({
      data: {
        enabled: true,
        distinct_id: DISTINCT,
        chapter_group_id: null,
      },
      error: undefined,
    });
    mountIdentityTree();
    await waitFor(() => {
      expect(session.getIdentity).toHaveBeenCalledWith("/v1/analytics/identity");
    });
  });

  it("clears Sentry user and skips identify for a raw email or UUID", async () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    session.getIdentity.mockResolvedValue({
      data: {
        enabled: true,
        distinct_id: RAW_EMAIL,
        chapter_group_id: RAW_UUID,
      },
      error: undefined,
    });
    mountIdentityTree();
    await waitFor(() => {
      expect(sentrySetUser).toHaveBeenCalledWith(null);
    });
    expect(JSON.stringify(memory.calls)).not.toContain(RAW_EMAIL);
    expect(JSON.stringify(memory.calls)).not.toContain(RAW_UUID);
    expect(memory.calls.some((call) => call.type === "identify")).toBe(false);
  });

  it("loads a new chapter_group_id after the active chapter changes", async () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    session.getIdentity.mockImplementation(async () => ({
      data: {
        enabled: true,
        distinct_id: DISTINCT,
        chapter_group_id:
          session.chapter === "chap-two" ? CHAPTER_GROUP : DISTINCT,
      },
      error: undefined,
    }));

    const first = mountIdentityTree();
    await waitFor(() => {
      expect(memory.calls).toEqual(
        expect.arrayContaining([
          { type: "group", groupType: "chapter", groupKey: DISTINCT },
        ]),
      );
    });
    first.unmount();

    session.chapter = "chap-two";
    mountIdentityTree();
    await waitFor(() => {
      expect(memory.calls).toEqual(
        expect.arrayContaining([
          { type: "group", groupType: "chapter", groupKey: CHAPTER_GROUP },
        ]),
      );
    });
  });

  it("does not keep the previous member's hex after a same-chapter account swap", async () => {
    const otherHex = "e".repeat(64);
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    session.getIdentity.mockImplementation(async () => ({
      data: {
        enabled: true,
        distinct_id: session.userId === "mobile-user-b" ? otherHex : DISTINCT,
        chapter_group_id: CHAPTER_GROUP,
      },
      error: undefined,
    }));

    const first = mountIdentityTree(queryClient);
    await waitFor(() => {
      expect(sentrySetUser).toHaveBeenCalledWith({ id: DISTINCT });
    });
    first.unmount();

    session.userId = "mobile-user-b";
    sentrySetUser.mockClear();
    mountIdentityTree(queryClient);

    await waitFor(() => {
      expect(sentrySetUser).toHaveBeenCalledWith({ id: otherHex });
    });
    expect(session.getIdentity).toHaveBeenCalledTimes(2);
    expect(memory.calls).toEqual(
      expect.arrayContaining([
        { type: "identify", distinctId: DISTINCT },
        { type: "reset" },
        { type: "identify", distinctId: otherHex },
      ]),
    );
  });
});
