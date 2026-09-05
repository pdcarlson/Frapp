import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";

const {
  mockScrollToMessage,
  mockRefetch,
  mockUseChatChannel,
  mockComposerMount,
  mockUseMyPermissions,
  searchHit,
} = vi.hoisted(() => ({
  mockScrollToMessage: vi.fn(),
  mockRefetch: vi.fn(),
  mockUseChatChannel: vi.fn(),
  mockComposerMount: vi.fn(),
  mockUseMyPermissions: vi.fn(() => ({
    data: { permissions: [] as string[] },
  })),
  searchHit: vi.fn(() => ({
    message: { id: "msg-2" },
    channelId: "chan-general",
  })),
}));

const CHANNELS = [
  { id: "chan-general", name: "general", type: "PUBLIC", member_ids: [] },
  { id: "chan-random", name: "random", type: "PUBLIC", member_ids: [] },
  // Read-only, so the reply-with-quote suite (#489) can check that the shell
  // withholds Reply where `ChatService` would refuse the send.
  {
    id: "chan-announcements",
    name: "announcements",
    type: "PUBLIC",
    member_ids: [],
    is_read_only: true,
  },
  // Not read-only, but the caller may not post — the alumni case. The two
  // fields disagree here, which is exactly what makes this fixture worth
  // having: a gate on either one alone passes one of the two channels above
  // and fails this.
  {
    id: "chan-alumni-readable",
    name: "alumni-readable",
    type: "PUBLIC",
    member_ids: [],
    is_read_only: false,
    can_post: false,
  },
];

/**
 * Array order disagrees with **both** ways a caller might be tempted to re-sort:
 * it is not alphabetical, and `display_order` descends rather than ascends.
 *
 * The second half matters more than it looks. `chat-admin-page.tsx` re-sorts by
 * `display_order` client-side, and `channel-list.tsx` names that as the pattern
 * the rail deliberately does not copy — so a fixture whose array order happened
 * to match `display_order` ascending could not tell a faithful pass-through from
 * exactly the divergence being warned about.
 */
const CATEGORIES = [
  { id: "cat-exec", name: "Executive", display_order: 2 },
  { id: "cat-comm", name: "Committees", display_order: 1 },
];

const MESSAGES = [
  { id: "msg-1", content: "hello", created_at: "2026-01-01T00:00:00Z" },
  { id: "msg-2", content: "world", created_at: "2026-01-01T00:01:00Z" },
];

const mockBookmarks = vi.fn(() => ({
  data: [] as Array<{
    id: string;
    message_id: string;
    created_at: string;
    message: Record<string, unknown>;
  }>,
  isLoading: false,
  isError: false,
}));
const mockBookmarkMutate = vi.fn();
const mockUnbookmarkMutate = vi.fn();
const mockBookmarkReset = vi.fn();
const mockUnbookmarkReset = vi.fn();
// Drives the shell's `bookmarkWriteFailed` alert. The first version of this
// mock had no `isError` at all, so the alert branch was unreachable from any
// test and deleting it entirely would have passed CI.
const mockBookmarkIsError = vi.fn(() => false);

// ChatShell pulls a wide surface from @repo/hooks; stub every hook it reads
// so the component renders from a controlled `channels`/message state
// instead of hitting the network.
vi.mock("@repo/hooks", () => ({
  useChannels: () => ({
    data: CHANNELS,
    isFetching: false,
    refetch: mockRefetch,
  }),
  // Non-empty, and deliberately NOT in alphabetical order: the rail is
  // contractually required to render categories in the order the API returned
  // them, so a payload that is already sorted could not tell a faithful
  // pass-through from a re-sort.
  useCategories: () => ({ data: CATEGORIES, isPending: false }),
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
  // Bookmarks (#462). The shell renders the panel unconditionally, so these
  // have to exist here even though this file's assertions are about deep links,
  // the composer remount and delete wiring. `mockBookmarks` lets the bookmark
  // cases below drive the list without touching the other suites' setup.
  useBookmarks: () => mockBookmarks(),
  useBookmarkedMessageIds: () =>
    new Set(
      mockBookmarks().data.map((b: { message_id: string }) => b.message_id),
    ),
  useBookmarkMessage: () => ({
    mutate: mockBookmarkMutate,
    reset: mockBookmarkReset,
    isError: mockBookmarkIsError(),
  }),
  useUnbookmarkMessage: () => ({
    mutate: mockUnbookmarkMutate,
    reset: mockUnbookmarkReset,
    isError: false,
  }),
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
  ChannelList: ({
    onPick,
    categories,
  }: {
    onPick?: (ch: { id: string }) => void;
    categories?: { id: string; name: string }[];
  }) => (
    <div data-testid="channel-list">
      {/* Enough of the rail to drive a channel switch, which is a distinct
          path from a deep link or a search jump and clears different state. */}
      <button
        data-testid="pick-random"
        onClick={() => onPick?.({ id: "chan-random" })}
      >
        random
      </button>
      {/* The rail has no `isActive` guard, so clicking the channel already open
          runs the same handler — the miss-click path (#489). */}
      <button
        data-testid="pick-general"
        onClick={() => onPick?.({ id: "chan-general" })}
      >
        general
      </button>
      {/* Echoed so the shell→rail category wiring is observable. Without this
          the prop could be dropped entirely and every test here still passed —
          the rail's own suite builds its inputs by hand, so nothing else
          exercises the shell actually handing them over. */}
      <span data-testid="channel-list-categories">
        {(categories ?? []).map((c) => c.name).join(",")}
      </span>
    </div>
  ),
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
  Composer: ({
    channelId,
    onSend,
    replyTo,
    onCancelReply,
  }: {
    channelId: string;
    onSend?: (body: string, attachments: unknown[]) => void;
    replyTo?: {
      id: string;
      author: string | null;
      preview: string | null;
    } | null;
    onCancelReply?: () => void;
  }) => {
    // Deliberately mount-only: the assertion below needs "did this
    // component get a fresh instance", which an exhaustive `[channelId]`
    // dep array would defeat by firing on every prop update too.
    useEffect(() => {
      mockComposerMount(channelId);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="composer">
        {channelId}
        {/* The staged-reply seam (#489). The real Composer cannot be driven
            here (jsdom renders no ProseMirror view), so these expose the two
            things the SHELL owns: what it says is staged, and what it sends. */}
        <span data-testid="composer-reply-to">{replyTo?.id ?? "none"}</span>
        {/* Keyed on `author`, because that is what `QuotedMessage` branches on
            (`const unavailable = author === null`). Keying it on `preview` — as
            an earlier version did — modelled the assumption under test: setting
            `author` to a stale name beside a null preview passed 44/44 while
            the real strip would have shown a fabricated author. */}
        <span data-testid="composer-reply-author">
          {replyTo ? (replyTo.author ?? "unavailable") : ""}
        </span>
        <span data-testid="composer-reply-preview">
          {replyTo?.preview ?? ""}
        </span>
        <button data-testid="composer-send" onClick={() => onSend?.("hi", [])}>
          send
        </button>
        <button data-testid="composer-cancel-reply" onClick={onCancelReply}>
          cancel reply
        </button>
      </div>
    );
  },
}));
vi.mock("./thread-panel", () => ({
  ThreadPanel: () => <div data-testid="thread-panel" />,
}));
vi.mock("./pins-popover", () => ({
  PinsPopover: () => <div data-testid="pins-popover" />,
}));
// Stubbed down to a single button that fires `onJump` with whatever hit the
// test set, so these cases exercise the *shell's* jump wiring rather than the
// popover's own search behaviour (which chat-search-popover.test.tsx owns).
vi.mock("./chat-search-popover", () => ({
  ChatSearchPopover: ({
    onJump,
  }: {
    onJump: (hit: { message: { id: string }; channelId: string }) => void;
  }) => (
    <button data-testid="search-jump" onClick={() => onJump(searchHit())}>
      search
    </button>
  ),
}));
// Exposes `onJump` as a button so the cross-channel jump (#462) can be driven
// without opening a real Radix popover. The panel's own rendering is covered in
// `bookmarks-popover.test.tsx`; what belongs here is the shell wiring.
vi.mock("./bookmarks-popover", () => ({
  BookmarksPopover: ({
    onJump,
  }: {
    onJump?: (channelId: string, messageId: string) => void;
  }) => (
    <button
      type="button"
      data-testid="bookmarks-popover"
      onClick={() => onJump?.("chan-random", "msg-2")}
    >
      bookmarks
    </button>
  ),
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
    { scrollToMessage: (id: string) => boolean },
    {
      messages?: Array<{ id: string; reply_to_id?: string | null }>;
      onDelete?: (messageId: string) => void;
      onReply?: (message: { id: string; reply_to_id?: string | null }) => void;
      canManageChannel?: boolean;
    }
  >(function MessageTimeline(
    { messages, onDelete, onReply, canManageChannel },
    ref,
  ) {
    // Models the REAL contract: the timeline can only scroll to a message it
    // has, and reports which happened. A mock that always returned `undefined`
    // asserted a timeline that silently succeeds at everything — the fixture
    // modelling the assumption rather than the server, which is how the
    // unreachable-target case stayed invisible in the first place.
    React.useImperativeHandle(ref, () => ({
      scrollToMessage: (id: string) => {
        const found = (messages ?? []).some((m) => m.id === id);
        if (found) mockScrollToMessage(id);
        return found;
      },
    }));
    return (
      <div data-testid="message-timeline">
        <span data-testid="can-manage-channel">{String(canManageChannel)}</span>
        {/* Whether the shell offered a Reply handler at all — the read-only
            rule (#489 AC 4) is expressed by withholding the prop, so it is
            invisible without this echo. */}
        <span data-testid="reply-offered">{String(!!onReply)}</span>
        <button onClick={() => onDelete?.("msg-1")}>trigger-delete</button>
        {/* One Reply control per message, so a test can stage a reply against
            a top-level message and against a reply — the two cases AC 3's
            root-normalization rule distinguishes. */}
        {(messages ?? []).map((m) => (
          <button
            key={m.id}
            data-testid={`trigger-reply-${m.id}`}
            onClick={() => onReply?.(m)}
          >
            reply to {m.id}
          </button>
        ))}
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
  mockBookmarkIsError.mockReturnValue(false);
  mockBookmarkReset.mockClear();
  mockUnbookmarkReset.mockClear();
});

describe("ChatShell channel categories", () => {
  it("hands the fetched categories to the rail, in the order the API returned them", () => {
    // Regression guard: before this assertion existed, deleting
    // `categories={categories}` from the shell left all 254 tests under
    // components/chat/ passing, because the rail's own suite builds its inputs
    // by hand and every shell test mocked the hook to an empty list.
    render(<ChatShell initialChannelId="chan-general" />);

    expect(screen.getByTestId("channel-list-categories").textContent).toBe(
      "Executive,Committees",
    );
  });
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

  it("scrolls straight to a search hit in the channel already open", () => {
    searchHit.mockReturnValue({
      message: { id: "msg-2" },
      channelId: "chan-general",
    });
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("search-jump"));

    expect(mockScrollToMessage).toHaveBeenCalledWith("msg-2");
  });

  it("consumes a search hit in another channel even when the URL named a different one", async () => {
    // Two regressions in one case.
    //
    // 1. The jump effect used to guard on `initialChannelId` — the URL param —
    //    so arriving at `?channel=A` and then picking a hit in channel B
    //    compared B against the stale A on every pass and returned, leaving
    //    the target permanently unconsumed.
    // 2. The target message exists ONLY in the destination channel. That is
    //    what makes this fail against the racing implementation the production
    //    comment warns about: scrolling before the switch runs against the
    //    outgoing channel, which does not contain `only-in-random`, so the
    //    scroll no-ops. With one shared message fixture for every channel, a
    //    direct scroll would have satisfied the assertion and the test would
    //    have passed on the bug it claims to pin.
    mockUseChatChannel.mockImplementation((channelId: string | null) =>
      chatChannelResult({
        messages:
          channelId === "chan-random"
            ? [
                {
                  id: "only-in-random",
                  content: "hi",
                  created_at: "2026-01-01T00:02:00Z",
                },
              ]
            : MESSAGES,
      }),
    );
    searchHit.mockReturnValue({
      message: { id: "only-in-random" },
      channelId: "chan-random",
    });
    render(<ChatShell initialChannelId="chan-general" />);
    expect(mockScrollToMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("search-jump"));

    await waitFor(() => {
      expect(mockScrollToMessage).toHaveBeenCalledWith("only-in-random");
    });
    // And the shell actually switched — the jump is not a scroll in the old
    // channel that happens to share a message id.
    expect(screen.getByTestId("composer")).toHaveTextContent("chan-random");
  });

  it("refetches the channel list for a cross-channel search hit, so a just-created DM is not a false miss", () => {
    searchHit.mockReturnValue({
      message: { id: "msg-1" },
      channelId: "chan-random",
    });
    render(<ChatShell />);
    mockRefetch.mockClear();

    fireEvent.click(screen.getByTestId("search-jump"));

    // Search reads channels live while `useChannels()` serves a cached list.
    // Without this the id fails `channels.some(...)`, the shell silently falls
    // back to #general, and the jump strands.
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("says so when a jump target is not in the loaded window, instead of doing nothing", async () => {
    searchHit.mockReturnValue({
      message: { id: "way-older-than-the-window" },
      channelId: "chan-general",
    });
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("search-jump"));

    // The defect this replaces: the popover closed, nothing scrolled, and
    // nothing was said — a control that appears broken rather than a limit
    // that is stated. Search exists to reach messages beyond the loaded
    // window, so this is the common path, not an edge case.
    expect(
      await screen.findByText(/older than the history loaded here/i),
    ).toBeTruthy();
    expect(mockScrollToMessage).not.toHaveBeenCalled();
  });

  it("does not carry the unreachable notice into a channel the message was never in", async () => {
    searchHit.mockReturnValue({
      message: { id: "never-loaded" },
      channelId: "chan-general",
    });
    render(<ChatShell initialChannelId="chan-general" />);
    fireEvent.click(screen.getByTestId("search-jump"));
    expect(
      await screen.findByText(/older than the history loaded here/i),
    ).toBeTruthy();

    // Switching channels from the rail must not leave #general's notice
    // standing in #random's header, claiming something about a message that
    // was never in #random.
    fireEvent.click(screen.getByTestId("pick-random"));

    await waitFor(() => {
      expect(screen.getByTestId("composer")).toHaveTextContent("chan-random");
    });
    expect(
      screen.queryByText(/older than the history loaded here/i),
    ).toBeNull();
  });

  it("retries when the same unreachable hit is picked again", async () => {
    searchHit.mockReturnValue({
      message: { id: "never-loaded" },
      channelId: "chan-general",
    });
    render(<ChatShell initialChannelId="chan-general" />);
    fireEvent.click(screen.getByTestId("search-jump"));
    expect(
      await screen.findByText(/older than the history loaded here/i),
    ).toBeTruthy();

    // The natural "did that work?" second click. Without a nonce in the effect
    // deps the target id is unchanged, so nothing re-runs: the notice clears
    // and no jump is attempted — an inert row again, which is the whole defect
    // this surface was fixed to stop producing.
    fireEvent.click(screen.getByTestId("search-jump"));

    expect(
      await screen.findByText(/older than the history loaded here/i),
    ).toBeTruthy();
  });

  it("keeps the unreachable notice dismissed when new messages arrive", async () => {
    searchHit.mockReturnValue({
      message: { id: "never-loaded" },
      channelId: "chan-general",
    });
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);
    fireEvent.click(screen.getByTestId("search-jump"));
    expect(
      await screen.findByText(/older than the history loaded here/i),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(
      screen.queryByText(/older than the history loaded here/i),
    ).toBeNull();

    // A new message lands. Dismiss abandons the target, so this must not
    // re-raise the notice — otherwise the button visibly un-dismisses itself.
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          ...MESSAGES,
          { id: "msg-new", content: "new", created_at: "2026-01-03T00:00:00Z" },
        ],
      }),
    );
    rerender(<ChatShell initialChannelId="chan-general" />);

    expect(
      screen.queryByText(/older than the history loaded here/i),
    ).toBeNull();
  });

  it("clears the unreachable notice once the message actually arrives", async () => {
    searchHit.mockReturnValue({
      message: { id: "msg-late" },
      channelId: "chan-general",
    });
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);
    fireEvent.click(screen.getByTestId("search-jump"));
    expect(
      await screen.findByText(/older than the history loaded here/i),
    ).toBeTruthy();

    // The target stays pending, so a message that arrives later still gets its
    // jump — the deep-link behaviour #328 shipped, kept rather than traded away
    // for the notice.
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          ...MESSAGES,
          {
            id: "msg-late",
            content: "late",
            created_at: "2026-01-02T00:00:00Z",
          },
        ],
      }),
    );
    rerender(<ChatShell initialChannelId="chan-general" />);

    await waitFor(() => {
      expect(mockScrollToMessage).toHaveBeenCalledWith("msg-late");
    });
    expect(
      screen.queryByText(/older than the history loaded here/i),
    ).toBeNull();
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
 * #396: `/chat` never repeated `dashboard-shell.tsx`'s "Skip to main content"
 * pattern, so a keyboard user re-tabbed through the whole channel rail on
 * every visit to reach the timeline — and the timeline carried no `log`/
 * `feed` semantics at all, so a screen reader had no live-region cue that new
 * messages were being appended.
 */
describe("ChatShell accessibility landmarks (#396)", () => {
  it("renders a skip link that targets the timeline", () => {
    render(<ChatShell initialChannelId="chan-general" />);

    const skipLink = screen.getByRole("link", { name: /skip to messages/i });
    expect(skipLink).toHaveAttribute("href", "#chat-timeline");
  });

  it("marks the timeline region as a log landmark, but not a live one", () => {
    render(<ChatShell initialChannelId="chan-general" />);

    // `role="log"` alone still carries an ARIA-spec implicit `aria-live:
    // polite` default, so this has to be explicit `"off"` — MessageTimeline
    // virtualizes, and a live region wired to its subtree would re-announce
    // already-read messages every time ordinary scrolling remounts them.
    const log = screen.getByRole("log", { name: /chat timeline/i });
    expect(log).toHaveAttribute("id", "chat-timeline");
    expect(log).toHaveAttribute("aria-live", "off");
  });

  it("does not narrate the backfilled history as new on initial load", () => {
    render(<ChatShell initialChannelId="chan-general" />);

    expect(screen.queryByText(/^new message from/i)).not.toBeInTheDocument();
  });

  it("announces a genuinely new incoming message, decoupled from the virtualized timeline", () => {
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);
    expect(screen.queryByText(/^new message from/i)).not.toBeInTheDocument();

    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          ...MESSAGES,
          {
            id: "msg-3",
            content: "just landed",
            created_at: "2026-01-01T00:02:00Z",
          },
        ],
      }),
    );
    rerender(<ChatShell initialChannelId="chan-general" />);

    expect(screen.getByText(/new message from someone/i)).toBeInTheDocument();
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

/**
 * Bookmarks are chapter-wide, so jumping to one routinely means switching
 * channel first (#462) — unlike the in-channel pins panel, whose `onJump` can
 * scroll the timeline it is already looking at.
 */
describe("ChatShell bookmark jump (#462)", () => {
  it("switches to the bookmarked message's channel and scrolls to it", async () => {
    render(<ChatShell initialChannelId="chan-general" />);
    expect(mockScrollToMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("bookmarks-popover"));

    await waitFor(() => {
      expect(screen.getByTestId("composer")).toHaveTextContent("chan-random");
    });
    expect(mockScrollToMessage).toHaveBeenCalledWith("msg-2");
  });

  it("jumps even when the URL named a different channel", async () => {
    // The regression the `pendingJumpChannelId` split exists to prevent. The
    // old guard compared the pending jump against `initialChannelId` — the
    // *URL's* channel — so once the shell switched away from it, every
    // subsequent jump was silently dropped. A member who arrived from a
    // notification into #general and then opened a bookmark in #random got
    // nothing: the channel switched, the scroll never fired.
    render(
      <ChatShell initialChannelId="chan-general" initialMessageId="msg-1" />,
    );
    expect(mockScrollToMessage).toHaveBeenCalledWith("msg-1");
    mockScrollToMessage.mockClear();

    fireEvent.click(screen.getByTestId("bookmarks-popover"));

    await waitFor(() => {
      expect(mockScrollToMessage).toHaveBeenCalledWith("msg-2");
    });
  });
});

describe("ChatShell bookmark write failure (#462)", () => {
  it("says nothing while writes are succeeding", () => {
    render(<ChatShell initialChannelId="chan-general" />);

    expect(screen.queryByText("Bookmark not updated")).toBeNull();
  });

  it("surfaces a failed bookmark write as an alert", () => {
    // Without this the failure is completely silent: there is no optimistic
    // write, so a failed save leaves the chip reading "Save" exactly as if
    // nothing had been tapped, and the member concludes the feature is broken.
    mockBookmarkIsError.mockReturnValue(true);

    render(<ChatShell initialChannelId="chan-general" />);

    expect(screen.getByRole("alert")).toHaveTextContent("Bookmark not updated");
  });

  it("clears the alert on a channel switch", async () => {
    // Both mutations live at the shell level and TanStack keeps `isError` set
    // until the next attempt, so an unreset alert would follow the member into
    // every channel for the rest of the session.
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);
    mockBookmarkReset.mockClear();

    rerender(<ChatShell initialChannelId="chan-random" />);

    await waitFor(() => {
      expect(mockBookmarkReset).toHaveBeenCalled();
    });
    expect(mockUnbookmarkReset).toHaveBeenCalled();
  });
});

/**
 * #489 — Discord-style reply-with-quote.
 *
 * The shell owns the staged reply, so it owns the two facts nothing else can
 * check: that a `reply_to_id` reaches `channel.send`, and that it is the
 * **root** message per `spec/behavior/chat/README.md` ("Replying to a reply
 * references the root message (no deep nesting)").
 *
 * These live here rather than in `composer.test.tsx` because jsdom renders no
 * ProseMirror view — `useEditor` is stubbed to `null` there, so `Composer`'s
 * own `submit()` returns on its first line and no test can drive a real send
 * through it. The seam that *is* drivable is this one.
 */
describe("ChatShell reply-with-quote (#489)", () => {
  // `channel_id` is load-bearing now, not fixture noise: a staged target
  // carries the channel it was staged in, so a message without one could never
  // resolve. Modelling it is what lets the cross-channel cases below be real.
  const ROOT = {
    id: "msg-1",
    channel_id: "chan-general",
    content: "the original",
    created_at: "2026-01-01T00:00:00Z",
    reply_to_id: null,
  };
  const REPLY = {
    id: "msg-3",
    channel_id: "chan-general",
    content: "a reply to it",
    created_at: "2026-01-01T00:02:00Z",
    reply_to_id: "msg-1",
  };

  function withMessages(messages: unknown[]) {
    const result = {
      ...chatChannelResult(),
      messages: messages as typeof MESSAGES,
      send: vi.fn(),
    };
    mockUseChatChannel.mockReturnValue(result);
    return result;
  }

  it("sends nothing in reply_to_id when no reply is staged", () => {
    // The pre-#489 behaviour, pinned so a regression that always sends a reply
    // is as visible as one that never does.
    const channel = withMessages([ROOT]);
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("composer-send"));

    expect(channel.send).toHaveBeenCalledWith("hi", {
      replyToId: null,
      attachments: [],
    });
  });

  it("carries the staged message's id through to channel.send", () => {
    // The whole defect this issue names: `chat-shell.tsx` used to call
    // `channel.send(body, { attachments })` with no third field, so the
    // `replyToId` option — plumbed all the way from `chat-client.ts` — was
    // reachable by nothing on web.
    const channel = withMessages([ROOT]);
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("trigger-reply-msg-1"));
    fireEvent.click(screen.getByTestId("composer-send"));

    expect(channel.send).toHaveBeenCalledWith("hi", {
      replyToId: "msg-1",
      attachments: [],
    });
  });

  it("normalizes a reply-to-a-reply onto the root message (AC 3)", () => {
    // Client-side on purpose: `ChatService.createMessage` validates only
    // same-channel, and must keep doing so — the Discord importer writes
    // genuinely nested `reply_to_id` values that a server-side root rule
    // would rewrite.
    const channel = withMessages([ROOT, REPLY]);
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("trigger-reply-msg-3"));

    expect(screen.getByTestId("composer-reply-to")).toHaveTextContent("msg-1");

    fireEvent.click(screen.getByTestId("composer-send"));

    expect(channel.send).toHaveBeenCalledWith("hi", {
      replyToId: "msg-1",
      attachments: [],
    });
  });

  it("stages the target's own preview, derived from the live message", () => {
    withMessages([ROOT]);
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("trigger-reply-msg-1"));

    expect(screen.getByTestId("composer-reply-preview")).toHaveTextContent(
      "the original",
    );
  });

  it("clears the staged reply after a send, so it cannot attach to the next message", () => {
    // `channel.send` enqueues to the Dexie outbox and resolves on its own
    // schedule. A strip left standing would silently ride along on whatever
    // the member typed next.
    const channel = withMessages([ROOT]);
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("trigger-reply-msg-1"));
    fireEvent.click(screen.getByTestId("composer-send"));
    fireEvent.click(screen.getByTestId("composer-send"));

    expect(screen.getByTestId("composer-reply-to")).toHaveTextContent("none");
    expect(channel.send).toHaveBeenLastCalledWith("hi", {
      replyToId: null,
      attachments: [],
    });
  });

  it("drops the staged reply when the member cancels it", () => {
    const channel = withMessages([ROOT]);
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("trigger-reply-msg-1"));
    fireEvent.click(screen.getByTestId("composer-cancel-reply"));
    fireEvent.click(screen.getByTestId("composer-send"));

    expect(screen.getByTestId("composer-reply-to")).toHaveTextContent("none");
    expect(channel.send).toHaveBeenCalledWith("hi", {
      replyToId: null,
      attachments: [],
    });
  });

  it("drops the staged reply on a channel switch", async () => {
    // `chat.service.ts` 400s a `reply_to_id` naming a message in another
    // channel. The target carries the channel it was staged in, so this holds
    // structurally rather than by remembering to clear on every switch path —
    // including the deep-link effect, which sets `selectedChannelId` directly
    // and never calls the switch cleanup.
    const channel = withMessages([ROOT]);
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("trigger-reply-msg-1"));
    expect(screen.getByTestId("composer-reply-to")).toHaveTextContent("msg-1");

    fireEvent.click(screen.getByTestId("pick-random"));

    await waitFor(() => {
      expect(screen.getByTestId("composer")).toHaveTextContent("chan-random");
    });
    expect(screen.getByTestId("composer-reply-to")).toHaveTextContent("none");

    fireEvent.click(screen.getByTestId("composer-send"));
    expect(channel.send).toHaveBeenCalledWith("hi", {
      replyToId: null,
      attachments: [],
    });
  });

  it("offers no Reply control in a read-only channel (AC 4)", async () => {
    // `spec/behavior/chat/README.md`: "Announcement messages cannot be replied
    // to in-thread… it holds regardless of permissions." `ChatService` 400s
    // such a send. Two ways this fails if the control is offered anyway: a
    // member has no composer there at all (`can_post` false), so Reply visibly
    // does nothing; a holder of `announcements:post` does get one, so Reply
    // stages a strip that then fails on send.
    withMessages([ROOT]);
    render(<ChatShell initialChannelId="chan-announcements" />);

    await waitFor(() => {
      expect(screen.getByTestId("composer")).toHaveTextContent(
        "chan-announcements",
      );
    });
    expect(screen.getByTestId("reply-offered")).toHaveTextContent("false");
  });

  it("offers Reply in an ordinary channel", () => {
    // The other half of the pair: without this, withholding it everywhere
    // would pass the case above and ship a Reply control nobody can reach.
    withMessages([ROOT]);
    render(<ChatShell initialChannelId="chan-general" />);

    expect(screen.getByTestId("reply-offered")).toHaveTextContent("true");
  });

  it("keeps a staged reply visible and sendable when its parent leaves the window", () => {
    // Review changed this behaviour. Dropping the strip left the member with a
    // reply they could neither see nor dismiss — Escape and the × both hang off
    // `replyTo` — which then either vanished from the send or re-attached when
    // the parent reappeared. The strip now renders the unavailable variant and
    // the id still sends: same channel is guaranteed by scoping, which is all
    // `ChatService` validates. Reachable via a jump or backfill re-windowing
    // the list (#1571), not hypothetical.
    const channel = withMessages([ROOT]);
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("trigger-reply-msg-1"));
    expect(screen.getByTestId("composer-reply-to")).toHaveTextContent("msg-1");

    mockUseChatChannel.mockReturnValue({
      ...chatChannelResult(),
      messages: [] as typeof MESSAGES,
      send: channel.send,
    });
    rerender(<ChatShell initialChannelId="chan-general" />);

    expect(screen.getByTestId("composer-reply-to")).toHaveTextContent("msg-1");
    // The field `QuotedMessage` actually branches on. Asserting the preview
    // alone proved only that it was nullish.
    expect(screen.getByTestId("composer-reply-author")).toHaveTextContent(
      "unavailable",
    );
    fireEvent.click(screen.getByTestId("composer-send"));

    expect(channel.send).toHaveBeenCalledWith("hi", {
      replyToId: "msg-1",
      attachments: [],
    });
  });

  it("keeps a staged reply through a miss-click on the channel already open", () => {
    // The rail fires its switch handler for a click on the current channel too
    // — an ordinary miss-click, or a scroll-to-top gesture. Clearing the reply
    // there dropped it while leaving the draft text, so Enter posted a reply as
    // a top-level message with nothing on screen having changed.
    const channel = withMessages([ROOT]);
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("trigger-reply-msg-1"));
    fireEvent.click(screen.getByTestId("pick-general"));

    expect(screen.getByTestId("composer-reply-to")).toHaveTextContent("msg-1");
    fireEvent.click(screen.getByTestId("composer-send"));
    expect(channel.send).toHaveBeenCalledWith("hi", {
      replyToId: "msg-1",
      attachments: [],
    });
  });

  it("does not let a send in another channel discard a reply staged here", async () => {
    // Clearing unconditionally on send reproduced the exact failure channel
    // scoping exists to prevent: stage a reply in #general, answer a ping in
    // #random — that send wiped it — then come back to a per-channel draft
    // still sitting in the composer with no strip above it, so Enter posts the
    // reply as a top-level message.
    const channel = withMessages([ROOT]);
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("trigger-reply-msg-1"));
    expect(screen.getByTestId("composer-reply-to")).toHaveTextContent("msg-1");

    fireEvent.click(screen.getByTestId("pick-random"));
    await waitFor(() => {
      expect(screen.getByTestId("composer")).toHaveTextContent("chan-random");
    });
    // Scoping already hides it here, and the send must carry nothing.
    expect(screen.getByTestId("composer-reply-to")).toHaveTextContent("none");
    fireEvent.click(screen.getByTestId("composer-send"));
    expect(channel.send).toHaveBeenLastCalledWith("hi", {
      replyToId: null,
      attachments: [],
    });

    fireEvent.click(screen.getByTestId("pick-general"));
    await waitFor(() => {
      expect(screen.getByTestId("composer")).toHaveTextContent("chan-general");
    });

    expect(screen.getByTestId("composer-reply-to")).toHaveTextContent("msg-1");
  });

  it("offers no Reply control to a member who cannot post here (alumni)", async () => {
    // `can_post` comes back false for TWO reasons, and read-only is only one:
    // the other is the alumni lifecycle restriction. An alumnus in an ordinary
    // PUBLIC channel gets `is_read_only: false` + `can_post: false`, so the
    // composer renders an explanation paragraph and no editor — a Reply chip
    // there would stage into a strip that can never appear.
    withMessages([ROOT]);
    render(<ChatShell initialChannelId="chan-alumni-readable" />);

    await waitFor(() => {
      expect(screen.getByTestId("composer")).toHaveTextContent(
        "chan-alumni-readable",
      );
    });
    expect(screen.getByTestId("reply-offered")).toHaveTextContent("false");
  });
});
