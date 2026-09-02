import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";

const {
  mockScrollToMessage,
  mockRefetch,
  mockUseChatChannel,
  mockComposerMount,
  mockUseMyPermissions,
} = vi.hoisted(() => ({
  mockScrollToMessage: vi.fn(),
  mockRefetch: vi.fn(),
  mockUseChatChannel: vi.fn(),
  mockComposerMount: vi.fn(),
  mockUseMyPermissions: vi.fn(() => ({
    data: { permissions: [] as string[] },
  })),
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
  useChannels: () => ({
    data: CHANNELS,
    isFetching: false,
    refetch: mockRefetch,
  }),
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
  useOrgConfig: () => ({
    data: { isModuleEnabled: () => true },
    isError: false,
    refetch: vi.fn(),
  }),
  useChapterRoster: () => ({ data: [] }),
  useMyPermissions: () => mockUseMyPermissions(),
  directChannelDisplayName: () => "",
  // The channel header now carries `ChatSearchPopover`, which reads these.
  // Idle by default: these cases are about the shell, and a search that never
  // runs keeps the popover out of their way.
  SEARCH_MIN_QUERY_LENGTH: 3,
  useSearch: () => ({
    data: undefined,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
  resolveAuthorLabel: () => "",
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
// Mounts (not renders) are the signal #1014's fix depends on: the real
// `<Composer>` bakes its placeholder into a Tiptap extension at editor
// creation, so it only shows the right channel's name if the component
// actually remounts on a channel switch (chat-shell.tsx keys `<Composer>` on
// the channel), not merely re-renders with a new `channelId`/`channelName`
// prop. `useEffect` with no deps fires once per mount, never on a prop-only
// re-render, so counting it is how this suite tells the two apart without a
// real ProseMirror view (jsdom can't render one; see composer.test.tsx).
// Keyed off `channelId` rather than `channelName` because this file's
// `directChannelDisplayName` stub always returns `""`.
vi.mock("./composer", () => ({
  Composer: ({ channelId }: { channelId: string }) => {
    // Deliberately mount-only: the assertion below needs "did this
    // component get a fresh instance", which an exhaustive `[channelId]`
    // dep array would defeat by firing on every prop update too.
    useEffect(() => {
      mockComposerMount(channelId);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div data-testid="composer">{channelId}</div>;
  },
}));
vi.mock("./thread-panel", () => ({
  ThreadPanel: () => <div data-testid="thread-panel" />,
}));
vi.mock("./pins-popover", () => ({
  PinsPopover: () => <div data-testid="pins-popover" />,
}));
vi.mock("./notification-level-popover", () => ({
  NotificationLevelPopover: () => (
    <div data-testid="notification-level-popover" />
  ),
}));
vi.mock("./reconnect-pill", () => ({
  ReconnectPill: () => null,
}));
vi.mock("./message-timeline", async () => {
  const React = await import("react");
  const MessageTimeline = React.forwardRef<
    { scrollToMessage: (id: string) => void },
    {
      onDelete?: (messageId: string) => void;
      canManageChannel?: boolean;
    }
  >(function MessageTimeline({ onDelete, canManageChannel }, ref) {
    React.useImperativeHandle(ref, () => ({
      scrollToMessage: mockScrollToMessage,
    }));
    return (
      <div data-testid="message-timeline">
        <span data-testid="can-manage-channel">{String(canManageChannel)}</span>
        <button onClick={() => onDelete?.("msg-1")}>trigger-delete</button>
      </div>
    );
  });
  return { MessageTimeline };
});

import { ChatShell } from "./chat-shell";

function chatChannelResult(
  overrides: Partial<{ isLoading: boolean; messages: typeof MESSAGES }> = {},
) {
  return {
    messages: overrides.messages ?? MESSAGES,
    isLoading: overrides.isLoading ?? false,
    loadError: null,
    send: vi.fn(),
    react: vi.fn(),
    unreact: vi.fn(),
    edit: vi.fn(),
    delete: vi.fn(),
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
  mockComposerMount.mockClear();
  mockUseMyPermissions.mockReset();
  mockUseMyPermissions.mockReturnValue({ data: { permissions: [] } });
});

describe("ChatShell deep-link targets", () => {
  it("shows an explicit empty state for a channel id that matches nothing, instead of silently falling back", () => {
    render(<ChatShell initialChannelId="does-not-exist" />);

    expect(screen.getByText("Channel not found")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Browse channels" }),
    ).toBeTruthy();
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
    render(
      <ChatShell initialChannelId="chan-general" initialMessageId="msg-2" />,
    );
    expect(mockScrollToMessage).toHaveBeenCalledWith("msg-2");
  });

  it("does not scroll — and does not spend the pending target — for a message outside the loaded window", () => {
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({ messages: MESSAGES }),
    );
    const { rerender } = render(
      <ChatShell
        initialChannelId="chan-general"
        initialMessageId="msg-not-loaded-yet"
      />,
    );
    expect(mockScrollToMessage).not.toHaveBeenCalled();

    // More history "arrives" — the target is now in range, and should still
    // fire because the pending target was never cleared on the earlier miss.
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          ...MESSAGES,
          {
            id: "msg-not-loaded-yet",
            content: "old",
            created_at: "2025-01-01T00:00:00Z",
          },
        ],
      }),
    );
    rerender(
      <ChatShell
        initialChannelId="chan-general"
        initialMessageId="msg-not-loaded-yet"
      />,
    );
    expect(mockScrollToMessage).toHaveBeenCalledWith("msg-not-loaded-yet");
  });

  it("jumps to a second message target in the same already-loaded channel", () => {
    const { rerender } = render(
      <ChatShell initialChannelId="chan-general" initialMessageId="msg-1" />,
    );
    expect(mockScrollToMessage).toHaveBeenCalledWith("msg-1");
    mockScrollToMessage.mockClear();

    // Same channel, already active, messages already loaded (the mocked
    // `useChatChannel` return value is unchanged) — only the message target
    // itself changes, as it would for a second command-palette/notification
    // click into a channel the member never left.
    rerender(
      <ChatShell initialChannelId="chan-general" initialMessageId="msg-2" />,
    );
    expect(mockScrollToMessage).toHaveBeenCalledWith("msg-2");
  });
});

describe("ChatShell composer remount per channel (#1014)", () => {
  it("remounts the composer — not just re-renders it — on every channel switch", async () => {
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);
    await waitFor(() => {
      expect(mockComposerMount).toHaveBeenCalledWith("chan-general");
    });
    expect(mockComposerMount).toHaveBeenCalledTimes(1);

    rerender(<ChatShell initialChannelId="chan-random" />);
    // A second mount call — not a re-render of the same instance — is what
    // rebuilds the Tiptap `Placeholder` extension from the new channel. If
    // `<Composer key={activeChannel.id}>` regressed back to no `key`, this
    // component would merely re-render and the mount effect would not fire
    // again, leaving this at 1. Waited for rather than asserted immediately:
    // the switch chains through ChatShell's own `initialChannelId` →
    // `selectedChannelId` sync effect before the new Composer instance's
    // mount effect fires, so it can land a tick after the DOM text updates.
    await waitFor(() => {
      expect(mockComposerMount).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByTestId("composer")).toHaveTextContent("chan-random");
    expect(mockComposerMount).toHaveBeenLastCalledWith("chan-random");
  });
});

/**
 * `ChatShell` computes `canManageChannel` and owns the delete-confirmation
 * flow itself (`MessageTimeline`/`ThreadPanel` only render the button and
 * call the handler back) — this is the one place that logic can be tested
 * without a real Virtuoso/DOM-heavy `MessageTimeline`.
 */
describe("ChatShell delete-message wiring", () => {
  it("derives canManageChannel from the channels:manage permission", async () => {
    mockUseMyPermissions.mockReturnValue({
      data: { permissions: ["channels:manage"] },
    });

    render(<ChatShell initialChannelId="chan-general" />);

    await waitFor(() => {
      expect(screen.getByTestId("can-manage-channel")).toHaveTextContent(
        "true",
      );
    });
  });

  it("defaults canManageChannel to false without the permission", async () => {
    render(<ChatShell initialChannelId="chan-general" />);

    await waitFor(() => {
      expect(screen.getByTestId("can-manage-channel")).toHaveTextContent(
        "false",
      );
    });
  });

  it("does not delete when the confirmation is cancelled", async () => {
    const channel = chatChannelResult();
    mockUseChatChannel.mockReturnValue(channel);
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByText("trigger-delete"));
    await waitFor(() => {
      expect(screen.getByText("Delete this message?")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.queryByText("Delete this message?"),
      ).not.toBeInTheDocument();
    });
    expect(channel.delete).not.toHaveBeenCalled();
  });

  it("deletes the confirmed message id once the dialog is confirmed", async () => {
    const channel = chatChannelResult();
    mockUseChatChannel.mockReturnValue(channel);
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByText("trigger-delete"));
    await waitFor(() => {
      expect(screen.getByText("Delete this message?")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete message" }));

    await waitFor(() => {
      expect(channel.delete).toHaveBeenCalledWith("msg-1");
    });
  });

  it("swallows a rejected delete rather than throwing — the delete action already toasted", async () => {
    const channel = chatChannelResult();
    channel.delete = vi.fn().mockRejectedValue(new Error("network error"));
    mockUseChatChannel.mockReturnValue(channel);
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByText("trigger-delete"));
    await waitFor(() => {
      expect(screen.getByText("Delete this message?")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete message" }));

    // No unhandled rejection reaches the test runner, and the dialog closes
    // normally — the failure was already surfaced by `channel.delete` itself
    // (it toasts before rejecting; see `chat-client.ts`'s `deleteMessage`).
    await waitFor(() => {
      expect(channel.delete).toHaveBeenCalledWith("msg-1");
    });
    await waitFor(() => {
      expect(
        screen.queryByText("Delete this message?"),
      ).not.toBeInTheDocument();
    });
  });
});
