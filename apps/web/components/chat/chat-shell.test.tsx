import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockScrollToMessage, mockRefetch, mockUseChatChannel } = vi.hoisted(() => ({
  mockScrollToMessage: vi.fn(),
  mockRefetch: vi.fn(),
  mockUseChatChannel: vi.fn(),
}));

const CHANNELS = [
  { id: "chan-general", name: "general", type: "PUBLIC", member_ids: [] },
  { id: "chan-random", name: "random", type: "PUBLIC", member_ids: [] },
];

const MESSAGES = [
  { id: "msg-1", content: "hello", created_at: "2026-01-01T00:00:00Z" },
  { id: "msg-2", content: "world", created_at: "2026-01-01T00:01:00Z" },
];

// ChatShell pulls a wide surface from @repo/hooks; stub every hook it reads
// so the component renders from a controlled `channels`/message state
// instead of hitting the network.
vi.mock("@repo/hooks", () => ({
  useChannels: () => ({ data: CHANNELS, isFetching: false, refetch: mockRefetch }),
  useCategories: () => ({ data: [], isPending: false }),
  useMemberDisplayNames: () => ({ byId: new Map(), nameFor: () => null }),
  useChannelNotificationPreferences: () => ({ data: [] }),
  useSetChannelNotificationLevel: () => ({
    isError: false,
    isPending: false,
    variables: undefined,
    reset: vi.fn(),
    mutate: vi.fn(),
  }),
  useMarkChannelRead: () => ({ mutate: vi.fn() }),
  useChannelUnreadCounts: () => ({ data: [], isError: false }),
  useOrgConfig: () => ({ data: { isModuleEnabled: () => true }, isError: false, refetch: vi.fn() }),
  useChapterRoster: () => ({ data: [] }),
  directChannelDisplayName: () => "",
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chapter-1" }),
}));

vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({ userId: "viewer-1" }),
}));

vi.mock("@/lib/chat/use-chat-channel", () => ({
  useChatChannel: (channelId: string | null) => mockUseChatChannel(channelId),
}));

// Heavy children (real timeline/composer need Virtuoso/tiptap DOM APIs jsdom
// doesn't provide) are stubbed — this test is about ChatShell's own
// deep-link wiring, not their internals.
vi.mock("./channel-list", () => ({
  ChannelList: () => <div data-testid="channel-list" />,
}));
vi.mock("./composer", () => ({
  Composer: () => <div data-testid="composer" />,
}));
vi.mock("./thread-panel", () => ({
  ThreadPanel: () => <div data-testid="thread-panel" />,
}));
vi.mock("./pins-popover", () => ({
  PinsPopover: () => <div data-testid="pins-popover" />,
}));
vi.mock("./notification-level-popover", () => ({
  NotificationLevelPopover: () => <div data-testid="notification-level-popover" />,
}));
vi.mock("./reconnect-pill", () => ({
  ReconnectPill: () => null,
}));
vi.mock("./message-timeline", async () => {
  const React = await import("react");
  const MessageTimeline = React.forwardRef<{ scrollToMessage: (id: string) => void }>(
    function MessageTimeline(_props, ref) {
      React.useImperativeHandle(ref, () => ({ scrollToMessage: mockScrollToMessage }));
      return <div data-testid="message-timeline" />;
    },
  );
  return { MessageTimeline };
});

import { ChatShell } from "./chat-shell";

function chatChannelResult(overrides: Partial<{ isLoading: boolean; messages: typeof MESSAGES }> = {}) {
  return {
    messages: overrides.messages ?? MESSAGES,
    isLoading: overrides.isLoading ?? false,
    loadError: null,
    send: vi.fn(),
    react: vi.fn(),
    unreact: vi.fn(),
    draft: "",
    setDraft: vi.fn(),
    typingUsers: [],
    emitTyping: vi.fn(),
    connection: "live",
    retry: vi.fn(),
    discard: vi.fn(),
    dispatchSlash: vi.fn(),
    act: vi.fn(),
  };
}

beforeEach(() => {
  mockScrollToMessage.mockClear();
  mockRefetch.mockClear();
  mockUseChatChannel.mockReset();
  mockUseChatChannel.mockReturnValue(chatChannelResult());
});

describe("ChatShell deep-link targets", () => {
  it("shows an explicit empty state for a channel id that matches nothing, instead of silently falling back", () => {
    render(<ChatShell initialChannelId="does-not-exist" />);

    expect(screen.getByText("Channel not found")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Browse channels" })).toBeTruthy();
    // The fallback grid (channel rail, composer) must not render underneath.
    expect(screen.queryByTestId("channel-list")).toBeNull();
  });

  it("refetches the channel list once for a supplied target, so a just-created channel isn't a false miss", () => {
    render(<ChatShell initialChannelId="chan-general" />);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("dismissing the not-found state falls through to the normal channel view", async () => {
    render(<ChatShell initialChannelId="does-not-exist" />);
    fireEvent.click(screen.getByRole("button", { name: "Browse channels" }));

    await waitFor(() => {
      expect(screen.queryByText("Channel not found")).toBeNull();
    });
    expect(screen.getByTestId("channel-list")).toBeTruthy();
  });

  it("resolves a channel *name* (onboarding's `general` redirect), not only an id", () => {
    render(<ChatShell initialChannelId="general" />);

    expect(screen.queryByText("Channel not found")).toBeNull();
    expect(screen.getByTestId("channel-list")).toBeTruthy();
  });

  it("does not show the not-found state when no channel was requested at all", () => {
    render(<ChatShell />);

    expect(screen.queryByText("Channel not found")).toBeNull();
    expect(screen.getByTestId("channel-list")).toBeTruthy();
  });

  it("scrolls to a supplied message once it is present in the loaded window", () => {
    render(<ChatShell initialChannelId="chan-general" initialMessageId="msg-2" />);
    expect(mockScrollToMessage).toHaveBeenCalledWith("msg-2");
  });

  it("does not scroll — and does not spend the pending target — for a message outside the loaded window", () => {
    mockUseChatChannel.mockReturnValue(chatChannelResult({ messages: MESSAGES }));
    const { rerender } = render(
      <ChatShell initialChannelId="chan-general" initialMessageId="msg-not-loaded-yet" />,
    );
    expect(mockScrollToMessage).not.toHaveBeenCalled();

    // More history "arrives" — the target is now in range, and should still
    // fire because the ref was never cleared on the earlier miss.
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({ messages: [...MESSAGES, { id: "msg-not-loaded-yet", content: "old", created_at: "2025-01-01T00:00:00Z" }] }),
    );
    rerender(<ChatShell initialChannelId="chan-general" initialMessageId="msg-not-loaded-yet" />);
    expect(mockScrollToMessage).toHaveBeenCalledWith("msg-not-loaded-yet");
  });
});
