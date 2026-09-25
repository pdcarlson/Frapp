import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect } from "react";

/**
 * Overrides folded into the `useChannels()` mock, so a case can drive the
 * pending and error branches that now render INSIDE the layout rather than
 * replacing it. Reset in `afterEach` on the block that sets it.
 */
const { channelsQueryState } = vi.hoisted(() => ({
  channelsQueryState: { value: {} as Record<string, unknown> },
}));

/**
 * The persisted chapter id, which is `null` in the server-rendered HTML and
 * until zustand rehydrates. Mutable so the no-chapter suite can drive the state
 * every cold load actually starts in; reset in that block's `afterEach`.
 */
const { chapterStoreState } = vi.hoisted(() => ({
  chapterStoreState: { value: "chapter-1" as string | null },
}));

// Mutable so the unresolved-viewer window can be exercised (#2243). `null` is
// what `useFrappUser` really reports until `GET /v1/users/me` answers, and the
// static `"viewer-1"` this used to be meant no test could reach that window.
/*
  Two identities, because the shell reads two (#2249).

  `viewerState` is the **resolved** id — live if `GET /v1/users/me` answered,
  else the one cached beside the Dexie first chunk — and it is what the shell
  paints with. `liveViewerState` is the live half alone, which two guards read
  because what they actually need is "has the live window loaded", not "who is
  this". Tests that do not care set both through `setViewer`.
*/
const { viewerState, liveViewerState } = vi.hoisted(() => ({
  viewerState: { userId: "viewer-1" as string | null },
  liveViewerState: { userId: "viewer-1" as string | null },
}));

/** Both halves at once — the ordinary case, where identity simply resolved. */
function setViewer(userId: string | null) {
  viewerState.userId = userId;
  liveViewerState.userId = userId;
}

const {
  mockScrollToMessage,
  mockRefetch,
  mockUseChatChannel,
  mockComposerMount,
  mockComposerMountProps,
  mockUseMyPermissions,
  searchHit,
} = vi.hoisted(() => ({
  mockScrollToMessage: vi.fn(),
  mockRefetch: vi.fn(),
  mockUseChatChannel: vi.fn(),
  mockComposerMount: vi.fn(),
  /**
   * The props `<Composer>` was mounted with, captured at mount.
   *
   * Separate from `mockComposerMount` so its existing single-argument
   * assertions keep reading cleanly. Captured at mount rather than read off the
   * rendered DOM because that is the real component's semantics: `draft`
   * becomes the editor's document and `claimShellFocus` is called once, both
   * when Tiptap constructs the editor rather than during render.
   */
  mockComposerMountProps: vi.fn(),
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

/**
 * `sender_id` is optional, and the two rows below deliberately omit it: an author
 * the roster cannot resolve is what makes the "from someone" announcement test's
 * fallback reachable. The #2243 tests set it, so the element type has to admit
 * it — without that the object literals there trip excess-property checking and
 * `check-types` fails while the suite still passes.
 */
type ShellMessage = {
  id: string;
  content: string;
  created_at: string;
  sender_id?: string | null;
};

const MESSAGES: ShellMessage[] = [
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
// Hide conversation (#2303). Each hide awaits its own `mutateAsync` promise,
// so a case settles that promise to drive the shell's success and failure.
const mockLeaveMutateAsync = vi.fn();
const mockReopenMutate = vi.fn();
const mockToast = vi.fn();

// ChatShell pulls a wide surface from @repo/hooks; stub every hook it reads
// so the component renders from a controlled `channels`/message state
// instead of hitting the network.
/*
  The viewer's block list (#2313). Ready and naming nobody by default, so the
  shell's other cases see every row; the block cases below set it.
*/
const blockListState = vi.hoisted(() => ({
  value: {
    ids: new Set<string>() as ReadonlySet<string>,
    unblocked: new Set<string>() as ReadonlySet<string>,
    status: "ready" as "ready" | "loading" | "unavailable",
    retry: () => {},
    isRetrying: false,
    isPaused: false,
    // Read, so no persisted floor would apply (`blockIdsWithFloor`).
    readAt: 1,
  },
}));

vi.mock("./use-unblock-flow", () => ({
  useUnblockFlow: () => ({
    requestUnblock: vi.fn(),
    reloadMaskedCopies: vi.fn(),
    isPending: false,
    confirmDialog: null,
  }),
}));

vi.mock("@repo/hooks", () => ({
  useBlockedUserIds: () => blockListState.value,
  useChannels: () => ({
    data: CHANNELS,
    isFetching: false,
    refetch: mockRefetch,
    ...channelsQueryState.value,
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
  // Read by `OpsSetupNudge`, which the shell renders above the timeline
  // (#492). Left deliberately inert: `useOrgConfig` above returns no
  // `enabled_modules`, so `selectOpsNudge` gets `undefined` and the card is
  // never eligible. These cases are about the shell, and a nudge that never
  // renders keeps it out of their way — `ops-setup-nudge.spec.tsx` is where
  // its own behaviour is pinned.
  useAccessibleChapters: () => ({ data: [] }),
  useDismissOpsNudge: () => ({ mutate: vi.fn() }),
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
  useLeaveChannel: () => ({ mutateAsync: mockLeaveMutateAsync }),
  useGetOrCreateDm: () => ({ mutate: mockReopenMutate }),
  canHideConversation: (channel: { type: string }) => channel.type === "DM",
  otherMemberId: (
    channel: { member_ids?: string[] | null },
    viewerId: string | null,
  ) => (channel.member_ids ?? []).find((id) => id !== viewerId) ?? null,
  hideConversationConfirmTitle: (name: string) =>
    `Hide your conversation with ${name}?`,
  HIDE_CONVERSATION_CONFIRM_ACTION: "Hide",
  HIDE_CONVERSATION_CONFIRM_BODY: "It leaves your list.",
  HIDE_CONVERSATION_FAILED_TITLE: "Couldn't hide the conversation",
  HIDE_CONVERSATION_FAILED_BODY: "Nothing changed.",
  HIDE_CONVERSATION_LABEL: "Hide conversation",
  HIDDEN_CONVERSATIONS_LABEL: "Hidden conversations",
}));

// Captured so the hide failure (#2303) is observable; no other case here
// asserts on a toast.
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (
    selector: (s: { activeChapterId: string | null }) => unknown,
  ) => selector({ activeChapterId: chapterStoreState.value }),
}));

/*
  The shell reads identity through `useChatViewerId` (#2249), which layers the
  id cached beside the first chunk under the live `GET /v1/users/me` one. Mocked
  at that seam rather than at `useFrappUser`, because the shell no longer calls
  `useFrappUser` — the resolved id is what it paints with, and `viewerState` is
  how these tests say what it resolved to.
*/
vi.mock("@/lib/chat/viewer-id", () => ({
  useChatViewerId: () => viewerState.userId,
}));

// The live half, read by the deep-link jump and the announcer baseline.
vi.mock("@/lib/auth/use-frapp-user", () => ({
  useFrappUser: () => ({
    userId: liveViewerState.userId,
    isLoading: liveViewerState.userId === null,
  }),
}));

vi.mock("@/lib/chat/use-chat-channel", () => ({
  useChatChannel: (channelId: string | null) => mockUseChatChannel(channelId),
}));

// Heavy children (real timeline/composer need Virtuoso/tiptap DOM APIs jsdom
// doesn't provide) are stubbed — this test is about ChatShell's own
// deep-link wiring, not their internals.
vi.mock("./channel-list", () => ({
  ChannelListSkeleton: () => <div data-testid="channel-list-skeleton" />,
  ChannelList: ({
    onPick,
    onHide,
    categories,
  }: {
    onPick?: (ch: {
      id: string;
      hidden?: boolean;
      member_ids?: string[];
    }) => void;
    onHide?: (ch: { id: string; name: string; type: string }) => void;
    categories?: { id: string; name: string }[];
  }) => (
    <div data-testid="channel-list">
      {/* The rail's Hide on a DM row, and a row from its Hidden conversations
          group (#2303): the shell confirms the first and reopens the second. */}
      <button
        data-testid="rail-hide-dm"
        onClick={() =>
          onHide?.({ id: "chan-dm", name: "dm-viewer-other", type: "DM" })
        }
      >
        rail hide
      </button>
      <button
        data-testid="rail-hide-other"
        onClick={() =>
          onHide?.({ id: "chan-dm-2", name: "dm-viewer-third", type: "DM" })
        }
      >
        rail hide other
      </button>
      <button
        data-testid="pick-hidden-dm"
        onClick={() =>
          onPick?.({
            id: "chan-dm",
            hidden: true,
            member_ids: ["viewer-1", "other-1"],
          })
        }
      >
        hidden dm
      </button>
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
// real ProseMirror view (jsdom can't render one; see composer.spec.tsx).
// Keyed off `channelId` rather than `channelName` because this file's
// `directChannelDisplayName` stub always returns `""`.
vi.mock("./composer", () => ({
  Composer: ({
    channelId,
    draft,
    claimShellFocus,
    onSend,
    replyTo,
    onCancelReply,
  }: {
    channelId: string;
    // The shell-to-editor handoff (#2176) is entirely carried by these two:
    // `draft` is what the real `useEditor` builds its document from, and
    // `claimShellFocus` is the caret the shell's `<textarea>` was holding.
    draft?: string;
    claimShellFocus?: () => boolean;
    onSend?: (body: string, attachments: unknown[]) => void;
    replyTo?: {
      id: string;
      author: string | null;
      preview: string | null;
      hidden?: string | null;
    } | null;
    onCancelReply?: () => void;
  }) => {
    // Deliberately mount-only: the assertion below needs "did this
    // component get a fresh instance", which an exhaustive `[channelId]`
    // dep array would defeat by firing on every prop update too.
    useEffect(() => {
      mockComposerMount(channelId);
      // Claimed here, not read in render — the real component calls this from
      // Tiptap's `onCreate`, and the claim is what makes it one-shot.
      mockComposerMountProps({ draft, focusClaimed: claimShellFocus?.() ?? false });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div
        data-testid="composer" data-draft={draft ?? ""}>
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
        <span data-testid="composer-reply-hidden">{replyTo?.hidden ?? ""}</span>
        <button data-testid="composer-send" onClick={() => onSend?.("hi", [])}>
          send
        </button>
        <button data-testid="composer-cancel-reply" onClick={onCancelReply}>
          cancel reply
        </button>
      </div>
    );
  },
  // A real `<textarea>`, not an inert box: what this suite asserts about
  // `ComposerShell` is that the shell the cold load renders can be focused and
  // typed into, and that what is typed reaches `<Composer>`. Its own rendering
  // (geometry, Enter handling, surviving hydration) belongs to
  // `composer.spec.tsx`, which drives the real component.
  ComposerShell: ({
    onTextChange,
    onFocusChange,
  }: {
    onTextChange?: (text: string) => void;
    onFocusChange?: (focused: boolean) => void;
  }) => (
    <textarea
      data-testid="composer-shell"
      aria-label="Message composer"
      onChange={(event) => onTextChange?.(event.target.value)}
      onFocus={() => onFocusChange?.(true)}
      onBlur={() => onFocusChange?.(false)}
    />
  ),
}));
// The four header popovers are now four panels behind one `ChannelMenu` (the
// `⋯` control), so the shell wires their jump callbacks through that one
// component. Stubbed down to the two buttons these cases actually drive, so
// they exercise the *shell's* jump wiring rather than a panel's own behaviour
// or Radix's popover mechanics — each panel's rendering is owned by its own
// spec, and the menu's view switching by `channel-menu.spec.tsx`.
vi.mock("./channel-menu", () => ({
  ChannelMenu: ({
    messages,
    hiddenPins,
    onJumpToSearchHit,
    onJumpToBookmark,
    hideConversation,
  }: {
    messages: Array<{ id: string }>;
    hiddenPins: { blocked: number; held: number };
    onJumpToSearchHit: (hit: { message: { id: string }; channelId: string }) => void;
    onJumpToBookmark: (channelId: string, messageId: string) => void;
    hideConversation?: { name: string; onHide: () => void };
  }) => (
    <div>
      {/* What the Pinned panel would read: the block list's cases assert on it. */}
      <span data-testid="menu-messages">
        {messages.map((m) => m.id).join(",")}
      </span>
      <span data-testid="menu-hidden-pins">
        {`${hiddenPins.blocked}/${hiddenPins.held}`}
      </span>
      {hideConversation ? (
        <button
          type="button"
          data-testid="hide-conversation"
          onClick={hideConversation.onHide}
        >
          hide
        </button>
      ) : null}
      <button
        type="button"
        data-testid="search-jump"
        onClick={() => onJumpToSearchHit(searchHit())}
      >
        search
      </button>
      <button
        type="button"
        data-testid="bookmarks-popover"
        onClick={() => onJumpToBookmark("chan-random", "msg-2")}
      >
        bookmarks
      </button>
    </div>
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
  const MessageTimelineSkeleton = () => (
    <div data-testid="message-timeline-skeleton" />
  );
  return { MessageTimeline, MessageTimelineSkeleton };
});

import { blockClearance } from "@repo/chat-core/blocks";
import { ChatShell } from "./chat-shell";

function chatChannelResult(
  overrides: Partial<{
    isLoading: boolean;
    messages: typeof MESSAGES;
    // The composer-shell handoff (#2176) runs through both of these: the shell
    // writes with `setDraft`, and `draft` is what the editor is built from.
    draft: string;
    setDraft: (body: string) => void;
  }> = {},
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
    draft: overrides.draft ?? "",
    setDraft: overrides.setDraft ?? vi.fn(),
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
  // Session-wide by design, so a row an earlier case showed against a ready
  // list would otherwise stay cleared into the next one.
  blockClearance.reset();
  blockListState.value = {
    ...blockListState.value,
    ids: new Set(),
    unblocked: new Set(),
    status: "ready",
  };
  setViewer("viewer-1");
  mockScrollToMessage.mockClear();
  mockRefetch.mockClear();
  mockUseChatChannel.mockReset();
  mockUseChatChannel.mockReturnValue(chatChannelResult());
  mockComposerMount.mockClear();
  mockComposerMountProps.mockClear();
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
    // The channels column DOES render underneath, and that is the change
    // #2142 made: this state used to replace the whole route, so a member who
    // followed a dead link lost the list they would pick a live channel from.
    // The state is now scoped to the thread column beside it.
    expect(screen.getByTestId("channel-list")).toBeTruthy();
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

  it("waits for the live window before calling a jump target unreachable (#2249)", async () => {
    /*
      The cached first chunk resolves identity from disk, so a warm load has a
      viewer id long before the network has answered for the *messages*. This
      guard is not about identity though — it decides whether to tell the member
      "That message is older than the history loaded here.", and the cached tail
      is by construction the rows that existed when the cache was written. A
      deep link to something posted while they were away would miss against it
      and state that, out loud, over a message the backfill is about to deliver.

      So the jump keeps waiting on the *live* id, which is the proxy it has
      always used for "the live window has landed" (#2269 replaces the proxy).
      Asserted rather than left to the comment, because nothing else would fail
      if a later change simplified the two identities back into one.
    */
    viewerState.userId = "viewer-1"; // cached id resolved…
    liveViewerState.userId = null; // …live one has not.
    searchHit.mockReturnValue({
      message: { id: "way-older-than-the-window" },
      channelId: "chan-general",
    });
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("search-jump"));

    await waitFor(() => expect(searchHit).toHaveBeenCalled());
    expect(
      screen.queryByText(/older than the history loaded here/i),
    ).not.toBeInTheDocument();
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

  /*
    The announcer is another place #2243's null viewer reached — not the last one:
    `chat-shell.tsx`'s composer reply-quote strip still passes a nullable `userId`
    to `resolveAuthorLabel`, and the `renderers/` subtree still types it nullable.
    Both are logged against #2249 rather than counted as done here. This one is
    covered because it is not behind the timeline's identity gate — this effect runs off `channel.messages`
    whatever the timeline is rendering. `sender_id === null` is false for every
    row, so the member's own arriving message was narrated to them as somebody
    else's: the mis-ID on the one surface that cannot be glanced at and re-read.
  */
  it("does not attribute a new message while the viewer is unresolved", () => {
    setViewer(null);
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);

    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          ...MESSAGES,
          {
            id: "msg-3",
            sender_id: "viewer-1",
            content: "just landed",
            created_at: "2026-01-01T00:02:00Z",
          },
        ],
      }),
    );
    rerender(<ChatShell initialChannelId="chan-general" />);

    // Silent rather than wrong. "Someone" would be a claim about a message the
    // member had just written themselves.
    expect(screen.queryByText(/^new message from/i)).not.toBeInTheDocument();
  });

  it("takes its baseline from the live window, not the cached tail (#2249)", () => {
    /*
      The announcer's first run sets the baseline every later arrival is measured
      against, and the rule two tests up is that anything already there when the
      member arrived is part of what they arrived to, not an event.

      A cached id resolves before the network answers, so if this effect ran on
      it the baseline would be taken from the *cached tail* — and the backfill
      replacing those rows would then read as a burst of arrivals and narrate
      messages that were sitting there before the page opened. Pinned because
      the failure is the announcer talking over a member who has just loaded the
      page, on the one surface they cannot re-read.
    */
    viewerState.userId = "viewer-1"; // cached id resolved…
    liveViewerState.userId = null; // …live one has not.
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);

    // The live backfill lands, replacing the seeded tail with a longer window.
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          ...MESSAGES,
          {
            id: "msg-while-away",
            sender_id: "alice",
            content: "arrived while they were away",
            created_at: "2026-01-01T00:02:00Z",
          },
        ],
      }),
    );
    rerender(<ChatShell initialChannelId="chan-general" />);

    expect(screen.queryByText(/^new message from/i)).not.toBeInTheDocument();
  });

  it("keeps announcing, and says \"You\", once identity settles", () => {
    /*
      The guard must not be a permanent mute. It returns *before* the seen-ref is
      written, so the resolve re-runs this effect with the ref still empty — and
      the empty ref then takes the channel-switch branch, which adopts whatever
      is latest as the baseline without narrating it. That is the same rule
      "does not narrate the backfilled history as new on initial load" above
      states: a message that landed while the app was still booting is part of
      what the member arrived to, not an event they should hear about. What has
      to survive is the *next* one, and its attribution.
    */
    setViewer(null);
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);
    const landed = {
      id: "msg-3",
      sender_id: "viewer-1",
      content: "just landed",
      created_at: "2026-01-01T00:02:00Z",
    };
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({ messages: [...MESSAGES, landed] }),
    );
    rerender(<ChatShell initialChannelId="chan-general" />);

    setViewer("viewer-1");
    rerender(<ChatShell initialChannelId="chan-general" />);
    // Adopted as the baseline, not retro-announced — and, crucially, never
    // announced under the wrong name on the way.
    expect(screen.queryByText(/^new message from/i)).not.toBeInTheDocument();

    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          ...MESSAGES,
          landed,
          {
            id: "msg-4",
            sender_id: "viewer-1",
            content: "and another",
            created_at: "2026-01-01T00:03:00Z",
          },
        ],
      }),
    );
    rerender(<ChatShell initialChannelId="chan-general" />);

    // "You", because the viewer is known now — the branch the null viewer used
    // to skip straight past.
    expect(screen.getByText(/new message from you/i)).toBeInTheDocument();
  });
});

/**
 * `ChatShell` computes `canManageChannel` and owns the delete-confirmation
 * flow itself (`MessageTimeline` only renders the button and
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

describe("ChatShell hide conversation (#2303)", () => {
  const DM = {
    id: "chan-dm",
    name: "dm-viewer-other",
    type: "DM",
    member_ids: ["viewer", "other"],
  };
  const OTHER_DM = { ...DM, id: "chan-dm-2", name: "dm-viewer-third" };

  /** A promise the case settles by hand, standing in for one request. */
  function pending() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  afterEach(() => {
    channelsQueryState.value = {};
    mockLeaveMutateAsync.mockReset();
    mockReopenMutate.mockReset();
    mockToast.mockReset();
  });

  it("offers Hide only on a 1:1 DM", () => {
    channelsQueryState.value = { data: [...CHANNELS, DM] };
    const { unmount } = render(<ChatShell initialChannelId="chan-general" />);
    expect(screen.queryByTestId("hide-conversation")).toBeNull();
    unmount();

    render(<ChatShell initialChannelId="chan-dm" />);
    expect(screen.getByTestId("hide-conversation")).toBeInTheDocument();
  });

  it("hides the open DM, then moves off it once the write lands", async () => {
    channelsQueryState.value = { data: [...CHANNELS, DM] };
    const write = pending();
    mockLeaveMutateAsync.mockReturnValue(write.promise);
    render(<ChatShell initialChannelId="chan-dm" />);
    expect(screen.getByTestId("composer")).toHaveTextContent("chan-dm");

    fireEvent.click(screen.getByTestId("hide-conversation"));
    expect(mockLeaveMutateAsync).toHaveBeenCalledWith("chan-dm");

    // The re-read list still carries the row, flagged: the shell must not
    // keep it open just because it can still resolve it.
    channelsQueryState.value = {
      data: [...CHANNELS, { ...DM, hidden: true }],
    };
    await act(async () => write.resolve());

    await waitFor(() => {
      expect(screen.getByTestId("composer")).toHaveTextContent("chan-general");
    });
  });

  it("still moves off the open DM when a second hide starts before the first lands", async () => {
    channelsQueryState.value = { data: [...CHANNELS, DM, OTHER_DM] };
    const first = pending();
    const second = pending();
    mockLeaveMutateAsync
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<ChatShell initialChannelId="chan-dm" />);

    fireEvent.click(screen.getByTestId("hide-conversation"));
    fireEvent.click(screen.getByTestId("rail-hide-other"));
    await waitFor(() => {
      expect(
        screen.getByText(/^Hide your conversation with/),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => {
      expect(mockLeaveMutateAsync).toHaveBeenCalledWith("chan-dm-2");
    });

    channelsQueryState.value = {
      data: [
        ...CHANNELS,
        { ...DM, hidden: true },
        { ...OTHER_DM, hidden: true },
      ],
    };
    await act(async () => {
      second.resolve();
      first.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId("composer")).toHaveTextContent("chan-general");
    });
  });

  it("confirms a Hide from the rail before hiding, and cancelling hides nothing", async () => {
    channelsQueryState.value = { data: [...CHANNELS, DM] };
    mockLeaveMutateAsync.mockResolvedValue(undefined);
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("rail-hide-dm"));
    await waitFor(() => {
      expect(
        screen.getByText(/^Hide your conversation with/),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText(/^Hide your conversation with/)).toBeNull();
    });
    expect(mockLeaveMutateAsync).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("rail-hide-dm"));
    await waitFor(() => {
      expect(
        screen.getByText(/^Hide your conversation with/),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    await waitFor(() => {
      expect(mockLeaveMutateAsync).toHaveBeenCalledWith("chan-dm");
    });
  });

  it("toasts a failed hide at once, even for a DM that is not open", async () => {
    channelsQueryState.value = { data: [...CHANNELS, DM] };
    mockLeaveMutateAsync.mockRejectedValue(new Error("offline"));
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("rail-hide-dm"));
    await waitFor(() => {
      expect(
        screen.getByText(/^Hide your conversation with/),
      ).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith({
        title: "Couldn't hide the conversation",
        description: "Nothing changed.",
      });
    });
    expect(screen.getByTestId("composer")).toHaveTextContent("chan-general");
  });

  it("reopens a DM picked from the Hidden conversations group", () => {
    channelsQueryState.value = {
      data: [...CHANNELS, { ...DM, hidden: true }],
    };
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("pick-hidden-dm"));

    // Reopening goes through the DM route with the other member, which is
    // what clears the hide server-side; the thread opens at once regardless.
    expect(mockReopenMutate).toHaveBeenCalledWith({ member_id: "other-1" });
    expect(screen.getByTestId("composer")).toHaveTextContent("chan-dm");
  });

  it("does not reopen anything when a visible row is picked", () => {
    render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("pick-random"));
    expect(mockReopenMutate).not.toHaveBeenCalled();
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
 * These live here rather than in `composer.spec.tsx` because jsdom renders no
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

/**
 * Lane 3 acceptance (#2142). These are the three things the lane is *for*, and
 * each of them is the kind of change that quietly comes back: a rail is easy to
 * re-add, and a loading gate is easy to re-introduce the next time a query
 * needs settling before a list renders.
 */
describe("ChatShell greenfield grammar (#2142)", () => {
  afterEach(() => {
    channelsQueryState.value = {};
  });

  it("renders no Details rail", () => {
    render(<ChatShell />);

    expect(screen.queryByRole("complementary", { name: "Thread" })).toBeNull();
    expect(screen.queryByText("Details")).toBeNull();
  });

  it("renders two columns, not three", () => {
    render(<ChatShell />);

    // The channels column is a labelled region; the thread column is not, so
    // counting labelled regions counts the rails. Three meant a Details rail.
    expect(screen.getAllByRole("region")).toHaveLength(1);
    expect(
      screen.getByRole("region", { name: "Channels" }),
    ).toBeInTheDocument();
  });

  it("states no channel count above the list", () => {
    render(<ChatShell />);

    // `1t`: the count restated the length of a list already on screen.
    expect(screen.queryByText(/\d+ channels?$/)).toBeNull();
  });

  it("paints the channels column while the channel list is still loading", async () => {
    // `1s` deletes "the shell-level LoadingState card": a card that replaces the
    // route makes the channel column paint last rather than first.
    channelsQueryState.value = { isPending: true, data: undefined };
    render(<ChatShell />);

    expect(
      screen.getByRole("region", { name: "Channels" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("channel-list-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("Loading chapter channels…")).toBeNull();
  });

  it("keeps the channels column usable when the channel list fails", () => {
    // The error used to replace the route, so a member who could not load one
    // channel lost the list they would pick another from.
    channelsQueryState.value = { isError: true, data: undefined };
    render(<ChatShell />);

    expect(screen.getByText("Couldn't load channels")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Channels" }),
    ).toBeInTheDocument();
  });
});

/**
 * #2145: what a cold load renders before anything has resolved.
 *
 * `/chat` used to server-render a lone 208px "No chapter selected" card in place
 * of the whole route: `activeChapterId` comes from a persisted zustand store
 * that initializes to `null`, so a member WITH a chapter was indistinguishable
 * from one without, and hydration then replaced that card with the two-column
 * frame. `1s` puts "channel column chrome" in the 0ms set and budgets zero CLS
 * above the composer.
 */
describe("ChatShell cold load, before anything resolves (#2145)", () => {
  afterEach(() => {
    chapterStoreState.value = "chapter-1";
    channelsQueryState.value = {};
  });

  it("renders the frame, not a card in place of it", () => {
    chapterStoreState.value = null;
    channelsQueryState.value = { isPending: true, data: undefined };
    render(<ChatShell />);

    expect(
      screen.getByRole("region", { name: "Channels" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("channel-list-skeleton")).toBeInTheDocument();
  });

  it("swaps content inside a frame that was already up", () => {
    // The regression this pins is a re-render, not a first render: the frame
    // present before the list lands must be the same frame that holds it after,
    // or the swap is the shift.
    chapterStoreState.value = null;
    channelsQueryState.value = { isPending: true, data: undefined };
    const { rerender } = render(<ChatShell />);
    const before = screen.getByRole("region", { name: "Channels" });

    chapterStoreState.value = "chapter-1";
    channelsQueryState.value = {};
    rerender(<ChatShell />);

    expect(screen.getByRole("region", { name: "Channels" })).toBe(before);
    expect(screen.getByTestId("channel-list")).toBeInTheDocument();
  });
});

/**
 * #2145: the channel list decides, not the persisted chapter id.
 *
 * The first cut of `channelsPaneState` short-circuited on `!activeChapterId`
 * ahead of everything else, which read as harmless and was not. `useChannels()`
 * takes no chapter argument — no `enabled` gate, `["channels"]` as its whole
 * query key — and the API resolves a sole membership server-side, so the list
 * arrives while the store field is still `null`. Ordering the state on the field
 * therefore hid the rail and the timeline over the top of data that had already
 * loaded, while `activeChannel` (derived from `channels`) resolved anyway.
 */
describe("ChatShell with channels but no persisted chapter (#2145)", () => {
  afterEach(() => {
    chapterStoreState.value = "chapter-1";
  });

  it("renders the timeline rather than a no-chapter card", () => {
    chapterStoreState.value = null;
    render(<ChatShell />);

    expect(screen.getByTestId("message-timeline")).toBeInTheDocument();
    expect(screen.queryByText("No chapter selected")).toBeNull();
  });

  it("never mounts a composer under a card that says to pick a chapter", () => {
    /*
      The concrete defect: the member got a working composer beneath "Pick an
      active chapter to load its channels", with no timeline above it. They could
      type, send into #general, and never see the result — and the unchanged
      `markChannelRead` effect stamped their read cursor for messages that were
      never on screen. Asserted as an invariant rather than against the old
      ordering, so any future short-circuit that reintroduces it fails here.
    */
    chapterStoreState.value = null;
    render(<ChatShell />);

    const sawNoChapterCard = screen.queryByText("No chapter selected") !== null;
    const sawComposer = screen.queryByTestId("composer") !== null;

    expect(sawNoChapterCard && sawComposer).toBe(false);
  });
});

/**
 * #2145: "no chapter" as a terminal state, which is the only thing it can
 * honestly mean once the query has settled with nothing.
 */
describe("ChatShell with no chapter and no channels (#2145)", () => {
  afterEach(() => {
    chapterStoreState.value = "chapter-1";
    channelsQueryState.value = {};
  });

  it("says so, inside the frame rather than in place of it", () => {
    chapterStoreState.value = null;
    channelsQueryState.value = { data: [], isPending: false };
    render(<ChatShell />);

    // Phrased as an instruction, not a claim about the account —
    // `profile-panel.tsx` owns that reasoning for the same window.
    expect(screen.getByText("No chapter selected")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Channels" }),
    ).toBeInTheDocument();
  });

  it("does not shimmer a channel list that will never arrive", () => {
    // Terminal: the query has settled, so a placeholder here would have no exit
    // and would shimmer for as long as the tab stayed open.
    chapterStoreState.value = null;
    channelsQueryState.value = { data: [], isPending: false };
    render(<ChatShell />);

    expect(screen.queryByTestId("channel-list-skeleton")).toBeNull();
  });

  it("does not announce a channel load that is not happening", () => {
    chapterStoreState.value = null;
    channelsQueryState.value = { data: [], isPending: false };
    render(<ChatShell />);

    expect(screen.queryByText("Loading channels")).toBeNull();
  });
});

/**
 * The responsive contract, which lane 3 nearly dropped.
 *
 * The old layout was a `grid` that collapsed to one stacked column below `md`.
 * The flush two-column rewrite is breakpoint-free by construction, and below
 * `lg` the app nav is a drawer — so a fixed 240px channels column beside the
 * thread leaves the thread about 135px at the documented 375px floor. That
 * passes the floor suite, which only reads `scrollWidth`, while failing what
 * the floor is for.
 *
 * jsdom applies no media queries, so these read the classes rather than the
 * rendered widths. That is the right granularity anyway: the defect was a
 * missing breakpoint, not a wrong number.
 */
describe("ChatShell narrow viewports (#2142)", () => {
  function columns() {
    const channels = screen.getByRole("region", { name: "Channels" });
    // The thread column is the channels column's next sibling.
    const thread = channels.nextElementSibling as HTMLElement;
    return { channels, thread };
  }

  it("shows one column at a time below lg, and both at lg", () => {
    render(<ChatShell />);
    const { channels, thread } = columns();

    // Full width when it is the only column; 240px once both fit.
    expect(channels.className).toContain("w-full");
    expect(channels.className).toContain("lg:w-60");
    // Exactly one of the two is hidden below lg.
    const hiddenBelowLg = [channels, thread].filter((el) =>
      el.className.includes("max-lg:hidden"),
    );
    expect(hiddenBelowLg).toHaveLength(1);
  });

  it("opens on the thread, so a deep link lands on its message", () => {
    render(<ChatShell initialChannelId="chan-general" />);
    const { channels, thread } = columns();

    expect(channels.className).toContain("max-lg:hidden");
    expect(thread.className).not.toContain("max-lg:hidden");
  });

  it("navigates back to the list and forward again on a pick", async () => {
    render(<ChatShell />);

    fireEvent.click(screen.getByRole("button", { name: "Back to channels" }));
    await waitFor(() => {
      expect(columns().channels.className).not.toContain("max-lg:hidden");
    });
    expect(columns().thread.className).toContain("max-lg:hidden");

    // Picking has to navigate, because the two are never both on screen here.
    fireEvent.click(screen.getByTestId("pick-random"));
    await waitFor(() => {
      expect(columns().thread.className).not.toContain("max-lg:hidden");
    });
  });
});

/**
 * Two regressions the rewrite introduced and this pins shut: a cold load that
 * says nothing to assistive tech, and an error branch that blanks a list the
 * member is still using.
 */
describe("ChatShell channel-list states (#2142)", () => {
  afterEach(() => {
    channelsQueryState.value = {};
  });

  it("announces the cold load, which the skeleton alone cannot", () => {
    channelsQueryState.value = { isPending: true, data: undefined };
    render(<ChatShell />);

    // The deleted whole-route LoadingState carried this; the skeleton is
    // aria-hidden, so it is no replacement on its own.
    expect(screen.getByText("Loading channels")).toBeInTheDocument();
  });

  it("announces it from outside the channels column, which narrow hides", () => {
    // `narrowPane` defaults to "thread", so below `lg` the column holding the
    // skeleton is `display:none` — and `display:none` is out of the
    // accessibility tree, so a caption inside it is silent at exactly the
    // width where it was the only thing on screen.
    channelsQueryState.value = { isPending: true, data: undefined };
    render(<ChatShell />);

    const channels = screen.getByRole("region", { name: "Channels" });
    expect(channels).not.toContainElement(screen.getByText("Loading channels"));
  });

  it("does not make the channel list itself a live region", () => {
    // `role="status"` implies `aria-atomic`, so putting it on the list's own
    // container made every unread badge repaint re-read all N channel names.
    render(<ChatShell />);

    const list = screen.getByTestId("channel-list");
    expect(list.closest("[role='status']")).toBeNull();
  });

  it("keeps a cached list rendered when a background refetch fails", () => {
    // TanStack keeps the last good `data` when a refetch errors. Branching on
    // `isError` first blanked the rail and unmounted the timeline because one
    // request 502'd during an API restart.
    channelsQueryState.value = { isError: true };
    render(<ChatShell />);

    expect(screen.getByTestId("channel-list")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load channels")).toBeNull();
  });
});

/**
 * Below `lg` the two columns are never both on screen, so every control that
 * moves between them has to actually move. Each of these was a dead end.
 */
describe("ChatShell narrow navigation (#2142)", () => {
  afterEach(() => {
    channelsQueryState.value = {};
  });

  function columns() {
    const channels = screen.getByRole("region", { name: "Channels" });
    return { channels, thread: channels.nextElementSibling as HTMLElement };
  }

  it("brings the thread on screen when a deep link arrives", async () => {
    const { rerender } = render(<ChatShell />);
    fireEvent.click(screen.getByRole("button", { name: "Back to channels" }));
    await waitFor(() => {
      expect(columns().thread.className).toContain("max-lg:hidden");
    });

    // App Router updates search params in place rather than remounting, so the
    // pane state survives the navigation. Jumping into a hidden column consumes
    // the target while nothing visibly happens.
    rerender(<ChatShell initialChannelId="chan-random" initialMessageId="msg-2" />);

    await waitFor(() => {
      expect(columns().thread.className).not.toContain("max-lg:hidden");
    });
  });

  it("shows the list when 'Browse channels' is taken", async () => {
    render(<ChatShell initialChannelId="does-not-exist" />);

    fireEvent.click(screen.getByRole("button", { name: "Browse channels" }));

    await waitFor(() => {
      expect(columns().channels.className).not.toContain("max-lg:hidden");
    });
  });

  it("offers no way back when there is no list to go back to", () => {
    // The channels column renders its header over an empty scroll area in these
    // states, and the only control that returns is a channel row — so Back
    // would strand the member on a blank pane with Retry out of reach.
    channelsQueryState.value = { isError: true, data: undefined };
    render(<ChatShell />);

    expect(screen.queryByRole("button", { name: "Back to channels" })).toBeNull();
    expect(screen.getByText("Couldn't load channels")).toBeInTheDocument();
  });
});


/**
 * #2176: the composer shell, and its upgrade to the real editor.
 *
 * `1s` puts "composer shell" in the 0ms SSR set and budgets "composer focusable
 * <= 400ms", but `<Composer>` is gated on `activeChannel` — derived from the
 * channel list — so before this the budget was gated on a network round trip.
 * These cases pin the two halves the shell cannot own itself: that what is
 * typed into it reaches the channel's draft, and that focus follows it across
 * the swap.
 */
describe("ChatShell composer shell and its upgrade (#2176)", () => {
  afterEach(() => {
    channelsQueryState.value = {};
    chapterStoreState.value = "chapter-1";
  });

  it("puts a composer the member can type into on screen before the channel list resolves", () => {
    channelsQueryState.value = { isPending: true, data: undefined };
    render(<ChatShell />);

    expect(screen.getByTestId("composer-shell")).toBeInTheDocument();
    // And not both at once — the real composer has no channel to address yet.
    expect(screen.queryByTestId("composer")).toBeNull();
  });

  it("routes what is typed into the shell to the channel's draft", () => {
    /*
      `setDraft` and not a seed prop of its own. `useChatChannel` stores what it
      is given whether or not there is a channel id and only masks `draft` until
      there is one, so this single call is the entire handoff: the text is
      already in place on the render that mounts `<Composer>`.
    */
    const setDraft = vi.fn();
    mockUseChatChannel.mockReturnValue(chatChannelResult({ setDraft }));
    channelsQueryState.value = { isPending: true, data: undefined };
    render(<ChatShell />);

    fireEvent.change(screen.getByTestId("composer-shell"), {
      target: { value: "hello" },
    });

    expect(setDraft).toHaveBeenLastCalledWith("hello");
  });

  it("builds the editor from what was typed into the shell", () => {
    // The other half of the handoff, from the editor's side: whatever
    // `useChatChannel` is serving as `draft` when the channel lands is what
    // `useEditor` builds its document from.
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({ draft: "typed while waiting" }),
    );
    render(<ChatShell />);

    expect(mockComposerMountProps).toHaveBeenCalledWith(
      expect.objectContaining({ draft: "typed while waiting" }),
    );
  });

  it("carries focus into the editor when the member was typing in the shell", () => {
    /*
      Without this a member who starts typing during the channel round trip
      loses focus to `document.body` the instant the list lands — mid-sentence,
      and worse than the unfocusable skeleton this replaced.
    */
    channelsQueryState.value = { isPending: true, data: undefined };
    const { rerender } = render(<ChatShell />);
    fireEvent.focus(screen.getByTestId("composer-shell"));

    channelsQueryState.value = {};
    rerender(<ChatShell />);

    expect(mockComposerMountProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ focusClaimed: true }),
    );
  });

  it("does not take focus the member never gave the shell", () => {
    // A member who is reading, or scrolling the channel rail, must not have the
    // caret yanked into the composer when the list happens to land.
    channelsQueryState.value = { isPending: true, data: undefined };
    const { rerender } = render(<ChatShell />);

    channelsQueryState.value = {};
    rerender(<ChatShell />);

    expect(mockComposerMountProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ focusClaimed: false }),
    );
  });

  it("does not carry that focus into a later channel switch", () => {
    // `chat-shell.tsx` keys `<Composer>` on channel id and name (#1014), so
    // every switch is a fresh mount. Inheriting the shell's focus intent would
    // pull the caret back into the composer on each one.
    channelsQueryState.value = { isPending: true, data: undefined };
    const { rerender } = render(<ChatShell />);
    fireEvent.focus(screen.getByTestId("composer-shell"));

    channelsQueryState.value = {};
    rerender(<ChatShell />);
    fireEvent.click(screen.getByTestId("pick-random"));

    expect(mockComposerMountProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ focusClaimed: false }),
    );
  });

  it("leaves no focusable composer in a state that will never get a channel", () => {
    /*
      A control with nowhere to send is the dead end the release gate forbids.
      The shell earns its place only while something is still in flight; these
      three states have settled with no channel to address.
    */
    for (const state of [
      { isError: true, data: undefined },
      { data: [], isPending: false },
    ]) {
      channelsQueryState.value = state;
      const { unmount } = render(<ChatShell />);
      expect(screen.queryByTestId("composer-shell")).toBeNull();
      unmount();
    }

    chapterStoreState.value = null;
    channelsQueryState.value = { data: [], isPending: false };
    render(<ChatShell />);
    expect(screen.queryByTestId("composer-shell")).toBeNull();
  });
});

describe("ChatShell block list (#2313)", () => {
  it("does not announce a new message from a member the viewer blocked", () => {
    blockListState.value = {
      ...blockListState.value,
      ids: new Set(["blocked-1"]),
    };
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);

    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          ...MESSAGES,
          {
            id: "msg-3",
            sender_id: "blocked-1",
            content: "just landed",
            created_at: "2026-01-01T00:02:00Z",
          },
        ],
      }),
    );
    rerender(<ChatShell initialChannelId="chan-general" />);

    expect(screen.queryByText(/^new message from/i)).not.toBeInTheDocument();
  });

  it("still announces a new message from anyone else", () => {
    blockListState.value = {
      ...blockListState.value,
      ids: new Set(["blocked-1"]),
    };
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);

    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          ...MESSAGES,
          {
            id: "msg-3",
            sender_id: "friend-1",
            content: "just landed",
            created_at: "2026-01-01T00:02:00Z",
          },
        ],
      }),
    );
    rerender(<ChatShell initialChannelId="chan-general" />);

    expect(screen.getByText(/new message from someone/i)).toBeInTheDocument();
  });

  it("keeps a blocked member's message out of the Pinned panel, even when an echo put its words back", () => {
    blockListState.value = {
      ...blockListState.value,
      ids: new Set(["blocked-1"]),
    };
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          ...MESSAGES,
          {
            id: "msg-3",
            sender_id: "blocked-1",
            content: "pinned insult",
            created_at: "2026-01-01T00:02:00Z",
          },
        ],
      }),
    );
    render(<ChatShell initialChannelId="chan-general" />);

    expect(screen.getByTestId("menu-messages")).toHaveTextContent(
      /^msg-1,msg-2$/,
    );
  });

  it("counts a blocked member's pin as hidden, not absent", () => {
    blockListState.value = {
      ...blockListState.value,
      ids: new Set(["blocked-1"]),
    };
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          { ...MESSAGES[0]!, is_pinned: true } as (typeof MESSAGES)[number],
          {
            id: "msg-3",
            sender_id: "blocked-1",
            content: "pinned insult",
            created_at: "2026-01-01T00:02:00Z",
            is_pinned: true,
          } as (typeof MESSAGES)[number],
        ],
      }),
    );
    render(<ChatShell initialChannelId="chan-general" />);

    expect(screen.getByTestId("menu-messages")).toHaveTextContent(/^msg-1$/);
    expect(screen.getByTestId("menu-hidden-pins")).toHaveTextContent("1/0");
  });

  it("keeps a held row out of the Pinned panel while the list cannot vouch for it", () => {
    blockListState.value = { ...blockListState.value, status: "unavailable" };
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          {
            ...MESSAGES[0]!,
            sender_id: "friend-1",
            is_pinned: true,
          } as (typeof MESSAGES)[number],
          { ...MESSAGES[1]!, sender_id: "viewer-1" },
        ],
      }),
    );
    render(<ChatShell initialChannelId="chan-general" />);

    // msg-1 arrived with no server verdict from someone else: held. The
    // viewer's own msg-2 is always shown. The held pin is counted as held,
    // not blocked: nothing says its sender is.
    expect(screen.getByTestId("menu-messages")).toHaveTextContent(/^msg-2$/);
    expect(screen.getByTestId("menu-hidden-pins")).toHaveTextContent("0/1");
  });

  it("hides a staged reply's quote once its author is blocked", async () => {
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          {
            ...MESSAGES[0]!,
            channel_id: "chan-general",
            sender_id: "friend-1",
          } as (typeof MESSAGES)[number],
        ],
      }),
    );
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);
    fireEvent.click(screen.getByTestId("trigger-reply-msg-1"));
    expect(screen.getByTestId("composer-reply-to")).toHaveTextContent("msg-1");
    expect(screen.getByTestId("composer-reply-hidden")).toBeEmptyDOMElement();

    // A block made on another device, picked up when the list is re-read.
    blockListState.value = {
      ...blockListState.value,
      ids: new Set(["friend-1"]),
    };
    rerender(<ChatShell initialChannelId="chan-general" />);

    expect(screen.getByTestId("composer-reply-hidden")).toHaveTextContent(
      "Message from a member you blocked",
    );
  });

  it("waits on a jump to a held message instead of calling it unloaded, and lands once the list reads", () => {
    blockListState.value = { ...blockListState.value, status: "unavailable" };
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          ...MESSAGES,
          {
            id: "msg-held",
            sender_id: "friend-1",
            content: "arrived during the outage",
            created_at: "2026-01-01T00:02:00Z",
          },
        ],
      }),
    );
    searchHit.mockReturnValue({
      message: { id: "msg-held" },
      channelId: "chan-general",
    });
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);

    fireEvent.click(screen.getByTestId("search-jump"));

    expect(
      screen.queryByText(/older than the history loaded here/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/waiting on your block list/i),
    ).toBeInTheDocument();
    expect(mockScrollToMessage).not.toHaveBeenCalled();

    // The list reads: the row is drawn, and the pending jump lands on it.
    blockListState.value = { ...blockListState.value, status: "ready" };
    rerender(<ChatShell initialChannelId="chan-general" />);

    expect(mockScrollToMessage).toHaveBeenCalledWith("msg-held");
    expect(
      screen.queryByText(/waiting on your block list/i),
    ).not.toBeInTheDocument();
  });

  it("replaces an earlier miss's notice once the target turns out to be held", () => {
    blockListState.value = { ...blockListState.value, status: "unavailable" };
    searchHit.mockReturnValue({
      message: { id: "msg-late" },
      channelId: "chan-general",
    });
    const { rerender } = render(<ChatShell initialChannelId="chan-general" />);
    fireEvent.click(screen.getByTestId("search-jump"));
    expect(
      screen.getByText(/older than the history loaded here/i),
    ).toBeInTheDocument();

    // It then arrives over the echo while the list is still unreadable.
    mockUseChatChannel.mockReturnValue(
      chatChannelResult({
        messages: [
          ...MESSAGES,
          {
            id: "msg-late",
            sender_id: "friend-1",
            content: "late",
            created_at: "2026-01-01T00:02:00Z",
          },
        ],
      }),
    );
    rerender(<ChatShell initialChannelId="chan-general" />);

    expect(
      screen.queryByText(/older than the history loaded here/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/waiting on your block list/i),
    ).toBeInTheDocument();
  });

  it("says so above the timeline when the block list cannot be read", () => {
    blockListState.value = { ...blockListState.value, status: "unavailable" };
    render(<ChatShell initialChannelId="chan-general" />);

    expect(
      screen.getByText(/couldn't load your block list/i),
    ).toBeInTheDocument();
  });
});
