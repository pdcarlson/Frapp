import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";

/**
 * `ChannelMenu` is the merge of four header popovers into one `⋯` (`1t`), so
 * what belongs here is the merge itself: which view is showing, what closes the
 * popover, and the two signals that used to live on the deleted trigger buttons
 * and would otherwise have been lost with them.
 *
 * The four panels are stubbed. Their own rendering is owned by their own specs,
 * and the real `ChatSearchPanel` would pull `useSearch` and a debounce into a
 * file that is not about searching.
 */
vi.mock("./chat-search-popover", () => ({
  ChatSearchPanel: ({
    onJump,
  }: {
    onJump: (hit: { message: { id: string }; channelId: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="search-panel"
      onClick={() => onJump({ message: { id: "msg-1" }, channelId: "chan-1" })}
    >
      search panel
    </button>
  ),
}));
vi.mock("./pins-popover", () => ({
  PinsPanel: ({ onJump }: { onJump?: (messageId: string) => void }) => (
    <button
      type="button"
      data-testid="pins-panel"
      onClick={() => onJump?.("msg-2")}
    >
      pins panel
    </button>
  ),
}));
vi.mock("./bookmarks-popover", () => ({
  BookmarksPanel: ({
    onJump,
    onRemove,
  }: {
    onJump: (channelId: string, messageId: string) => void;
    onRemove: (messageId: string) => void;
  }) => (
    <div>
      <button
        type="button"
        data-testid="saved-jump"
        onClick={() => onJump("chan-2", "msg-3")}
      >
        jump
      </button>
      <button
        type="button"
        data-testid="saved-remove"
        onClick={() => onRemove("msg-3")}
      >
        remove
      </button>
    </div>
  ),
}));
vi.mock("./notification-level-popover", () => ({
  NotificationLevelPanel: () => <div data-testid="notifications-panel" />,
}));

import { ChannelMenu } from "./channel-menu";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    channel_id: "chan-1",
    sender_id: "u1",
    content: "hi",
    created_at: new Date("2026-01-01T12:00:00Z").toISOString(),
    is_pinned: false,
    ...overrides,
  } as ChatMessage;
}

function renderMenu(overrides: Partial<Parameters<typeof ChannelMenu>[0]> = {}) {
  const props = {
    activeChannelId: "chan-1",
    messages: [] as ChatMessage[],
    nameFor: () => "Someone",
    channelNameFor: () => "general",
    onJumpToMessage: vi.fn(),
    onJumpToSearchHit: vi.fn(),
    onJumpToBookmark: vi.fn(),
    bookmarks: [],
    bookmarksLoading: false,
    bookmarksError: false,
    onRemoveBookmark: vi.fn(),
    notificationLevel: "all" as const,
    notificationSaving: false,
    onChangeNotificationLevel: vi.fn(),
    ...overrides,
  };
  render(<ChannelMenu {...props} />);
  return props;
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Channel menu" }));
}

describe("ChannelMenu (#2142)", () => {
  it("opens on the row list, not on a panel", async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);

    expect(screen.getByRole("button", { name: /Pinned/ })).toBeInTheDocument();
    expect(screen.queryByTestId("pins-panel")).not.toBeInTheDocument();
  });

  it("swaps to the panel a row names, and back", async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: /Pinned/ }));
    expect(screen.getByTestId("pins-panel")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Back to channel menu" }),
    );
    expect(screen.queryByTestId("pins-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Pinned/ })).toBeInTheDocument();
  });

  it("mounts only the selected panel, which is what scopes the search query", async () => {
    // `ChatSearchPanel` drops its own `open` gate because being mounted IS the
    // gate now. That is only true if the menu really does unmount the panels it
    // is not showing, so it is asserted here rather than assumed there.
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: /Search messages/ }));

    expect(screen.getByTestId("search-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("pins-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("notifications-panel")).not.toBeInTheDocument();
  });

  it("closes on a jump, so the panel does not cover the message it scrolled to", async () => {
    // The defect each panel used to guard itself: a 320px panel left open over
    // the timeline hides the message it just navigated to. The panels no longer
    // own their popover, so the guarantee lives here.
    const user = userEvent.setup();
    const props = renderMenu({ messages: [message({ is_pinned: true })] });
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: /Pinned/ }));
    await user.click(screen.getByTestId("pins-panel"));

    expect(props.onJumpToMessage).toHaveBeenCalledWith("msg-2");
    expect(screen.queryByTestId("pins-panel")).not.toBeInTheDocument();
  });

  it("stays open when a saved message is removed", async () => {
    // Curating a list is not navigating away from it. Closing here would make
    // clearing several bookmarks four clicks apiece.
    const user = userEvent.setup();
    const props = renderMenu();
    await openMenu(user);

    await user.click(screen.getByRole("button", { name: /Saved/ }));
    await user.click(screen.getByTestId("saved-remove"));

    expect(props.onRemoveBookmark).toHaveBeenCalledWith("msg-3");
    expect(screen.getByTestId("saved-jump")).toBeInTheDocument();
  });

  it("reopens on the row list rather than resuming the last panel", async () => {
    const user = userEvent.setup();
    renderMenu();
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: /Saved/ }));
    await user.keyboard("{Escape}");
    await openMenu(user);

    expect(screen.queryByTestId("saved-jump")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Saved/ })).toBeInTheDocument();
  });

  it("carries the pin count the deleted trigger badge used to show", async () => {
    const user = userEvent.setup();
    renderMenu({
      messages: [
        message({ id: "a", is_pinned: true }),
        message({ id: "b", is_pinned: true }),
        message({ id: "c" }),
      ],
    });
    await openMenu(user);

    expect(
      screen.getByRole("button", { name: "Pinned, 2" }),
    ).toBeInTheDocument();
  });

  it("states no saved count until the list has actually loaded", async () => {
    // `0` while the query is in flight is a claim that nothing is saved, which
    // is exactly what the panel's own loading state exists to avoid saying.
    const user = userEvent.setup();
    renderMenu({ bookmarks: [], bookmarksLoading: true });
    await openMenu(user);

    expect(screen.getByRole("button", { name: "Saved" })).toBeInTheDocument();
  });

  it("is disabled with no channel open", () => {
    renderMenu({ activeChannelId: null });

    expect(screen.getByRole("button", { name: "Channel menu" })).toBeDisabled();
  });
});
