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

const session = vi.hoisted(() => ({
  auth: "authenticated" as "authenticated" | "unauthenticated" | "hydrating",
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
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ObservabilityIdentityProvider>
        <span>child</span>
      </ObservabilityIdentityProvider>
    </QueryClientProvider>,
  );
}

describe("mobile ObservabilityIdentityProvider", () => {
  beforeEach(() => {
    session.chapter = "mobile-chap";
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

  it("does not call GET /v1/analytics/identity when both vendors are dark", () => {
    session.sentryDsn = undefined;
    session.posthogReady = false;
    mountIdentityTree();
    expect(session.getIdentity).not.toHaveBeenCalled();
  });
});
