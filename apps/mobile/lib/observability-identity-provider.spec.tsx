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
  chapter: "chap-mobile" as string | null,
  identityGet: vi.fn(),
  sentryDsn: "https://examplepublickey@o0.ingest.sentry.io/0" as
    | string
    | undefined,
  posthogReady: true,
}));

const sentrySetUser = vi.hoisted(() => vi.fn());

vi.mock("@repo/hooks", () => ({
  useFrappClient: () => ({ GET: session.identityGet }),
  useActiveChapterId: () => session.chapter,
}));

vi.mock("@/lib/auth-session", () => ({
  useAuthSession: () => ({ status: session.auth }),
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

function mountIdentityTree() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ObservabilityIdentityProvider>
        <span data-testid="identity-child" />
      </ObservabilityIdentityProvider>
    </QueryClientProvider>,
  );
}

function resetSession() {
  session.auth = "authenticated";
  session.chapter = "chap-mobile";
  session.sentryDsn = "https://examplepublickey@o0.ingest.sentry.io/0";
  session.posthogReady = true;
  session.identityGet.mockReset();
  sentrySetUser.mockReset();
  bindPostHogAdapterForTests(null);
}

describe("mobile identity provider auth gate", () => {
  beforeEach(resetSession);

  afterEach(() => {
    bindPostHogAdapterForTests(null);
  });

  it("does not call GET /v1/analytics/identity on the auth stack", () => {
    session.auth = "unauthenticated";
    mountIdentityTree();
    expect(session.identityGet).not.toHaveBeenCalled();
  });

  it("does not call GET /v1/analytics/identity while the session is hydrating", () => {
    session.auth = "hydrating";
    mountIdentityTree();
    expect(session.identityGet).not.toHaveBeenCalled();
  });

  it("does not call GET /v1/analytics/identity when both vendors are off", () => {
    session.sentryDsn = undefined;
    session.posthogReady = false;
    mountIdentityTree();
    expect(session.identityGet).not.toHaveBeenCalled();
  });
});

describe("mobile identity provider HMAC apply", () => {
  beforeEach(resetSession);

  afterEach(() => {
    bindPostHogAdapterForTests(null);
  });

  it("sets Sentry user.id and PostHog identify/group from validated hex", async () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    session.identityGet.mockResolvedValue({
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
    expect(memory.calls).toEqual(
      expect.arrayContaining([
        { type: "identify", distinctId: DISTINCT },
        { type: "group", groupType: "chapter", groupKey: CHAPTER_GROUP },
      ]),
    );
    expect(session.identityGet).toHaveBeenCalledWith("/v1/analytics/identity");
  });

  it("fetches when only the Expo Sentry DSN is configured", async () => {
    session.posthogReady = false;
    session.identityGet.mockResolvedValue({
      data: {
        enabled: true,
        distinct_id: DISTINCT,
        chapter_group_id: null,
      },
      error: undefined,
    });
    mountIdentityTree();
    await waitFor(() => {
      expect(session.identityGet).toHaveBeenCalledWith(
        "/v1/analytics/identity",
      );
    });
  });

  it("drops a raw email or UUID instead of identifying with it", async () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    session.identityGet.mockResolvedValue({
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

  it("refetches chapter_group_id after the active chapter changes", async () => {
    const memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
    session.identityGet.mockImplementation(async () => ({
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
});
