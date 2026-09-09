import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useChapterPresence = vi.hoisted(() =>
  vi.fn(() => ({
    statusOf: () => "offline" as const,
    isReady: false,
  })),
);

vi.mock("@/lib/realtime/use-chapter-presence", () => ({
  useChapterPresence,
}));

vi.mock("@repo/hooks", () => ({
  useActiveChapterId: () => "chapter-1",
}));

vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({ userId: "user-1" }),
}));

const network = vi.hoisted(() => ({
  isOffline: false,
  linkOnline: true,
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({
    state: network.isOffline ? "OFFLINE" : "ONLINE",
    isOnline: !network.isOffline,
    isDegraded: false,
    isOffline: network.isOffline,
    linkOnline: network.linkOnline,
    probeOnce: async () => {},
  }),
}));

import { ChapterPresenceProvider } from "./chapter-presence-provider";

describe("ChapterPresenceProvider network gate", () => {
  beforeEach(() => {
    network.isOffline = false;
    network.linkOnline = true;
    useChapterPresence.mockClear();
  });

  it("stays enabled when /health is down but the browser link is up", () => {
    network.isOffline = true;
    network.linkOnline = true;

    render(
      <ChapterPresenceProvider>
        <div />
      </ChapterPresenceProvider>,
    );

    expect(useChapterPresence).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
  });

  it("disables when the browser reports no link", () => {
    network.isOffline = true;
    network.linkOnline = false;

    render(
      <ChapterPresenceProvider>
        <div />
      </ChapterPresenceProvider>,
    );

    expect(useChapterPresence).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });
});
