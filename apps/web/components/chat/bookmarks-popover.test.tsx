import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import {
  BookmarksPopover,
  type BookmarkEntry,
} from "./bookmarks-popover";
import type { ChatMessage } from "@repo/chat-core/types";

/**
 * The personal Bookmarks panel (#462).
 *
 * The behaviours pinned here are the ones a reskin or a refactor would silently
 * lose: the three distinct not-a-list states, the chapter-wide jump that has to
 * carry a channel, and the deleted-message placeholder the spec requires the
 * bookmark to keep surfacing.
 */

const OTHER = "22222222-2222-4222-8222-222222222222";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-random",
    sender_id: OTHER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "the dues link",
    kind: "text",
    payload: null,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: new Date(2026, 7, 16, 17, 9).toISOString(),
    client_message_id: "client-1",
    attachment_count: 0,
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  } as ChatMessage;
}

const entry = (overrides: Partial<BookmarkEntry> = {}): BookmarkEntry => ({
  id: "bm-1",
  message_id: "msg-1",
  created_at: new Date(2026, 7, 17, 9, 30).toISOString(),
  message: message(),
  ...overrides,
});

const nameFor = (id: string) => (id === OTHER ? "Alice Chen" : null);

function renderPanel(props: Partial<Parameters<typeof BookmarksPopover>[0]> = {}) {
  return render(
    <BookmarksPopover bookmarks={[]} nameFor={nameFor} {...props} />,
  );
}

describe("BookmarksPopover", () => {
  it("labels the trigger with the count for screen readers", () => {
    renderPanel({ bookmarks: [entry(), entry({ id: "bm-2" })] });

    expect(
      screen.getByRole("button", { name: "2 bookmarked messages" }),
    ).toBeInTheDocument();
  });

  it("does not claim the member has no bookmarks while the request is in flight", async () => {
    // The false-empty defect: "nothing saved yet" is a claim about the
    // member's own data, and asserting it before the answer arrives is worse
    // than saying nothing.
    renderPanel({ isLoading: true });
    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByText(/Loading your bookmarks/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing saved yet/)).not.toBeInTheDocument();
  });

  it("distinguishes a failed load from an empty list", async () => {
    renderPanel({ isError: true });
    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByText(/Couldn’t load your bookmarks/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing saved yet/)).not.toBeInTheDocument();
  });

  it("says the list is private in the empty state", async () => {
    // The one place the privacy guarantee is stated to the member. Nothing else
    // in the UI tells them a bookmark is not visible to their officers.
    renderPanel();
    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByText(/only you can see/i)).toBeInTheDocument();
  });

  it("jumps with the message own channel, not the active one", async () => {
    // The reason this panel's `onJump` takes two arguments where the pins
    // panel's takes one: bookmarks are chapter-wide, so a row routinely points
    // into a channel the member is not currently looking at.
    const onJump = vi.fn();
    renderPanel({ bookmarks: [entry()], onJump });

    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByRole("button", { name: /dues link/ }));

    expect(onJump).toHaveBeenCalledWith("chan-random", "msg-1");
  });

  it("dismisses itself on jump so it does not cover what it scrolled to", async () => {
    const onJump = vi.fn();
    renderPanel({ bookmarks: [entry()], onJump });

    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByRole("button", { name: /dues link/ }));

    expect(screen.queryByText("Your bookmarks")).not.toBeInTheDocument();
  });

  it("keeps a bookmark whose message was deleted, showing the placeholder", async () => {
    // `spec/behavior/chat/README.md`: the bookmark "surfaces a '[message
    // deleted]' placeholder" rather than disappearing. This is the user-visible
    // end of the guarantee the repository and service specs pin server-side.
    renderPanel({
      bookmarks: [
        entry({
          message: message({ is_deleted: true, content: "[message deleted]" }),
        }),
      ],
    });

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByText("[message deleted]")).toBeInTheDocument();
  });

  it("does not offer a jump for a message whose channel is no longer readable", async () => {
    // `message_available: false` means the API redacted the row because the
    // viewer lost access. Jumping would set the shell's channel to one absent
    // from the viewer's channel list, which silently resolves to #general and
    // never scrolls — a control that looks like it worked and did the wrong
    // thing. The row must not be a button at all.
    const onJump = vi.fn();
    renderPanel({
      bookmarks: [
        entry({
          message_available: false,
          message: message({ content: "[unavailable]" }),
        }),
      ],
      onJump,
    });

    await userEvent.click(screen.getByRole("button"));

    expect(
      screen.queryByRole("button", { name: /unavailable/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("[unavailable]")).toBeInTheDocument();
    expect(onJump).not.toHaveBeenCalled();
  });

  it("still counts and lists a redacted row, so the member can see they saved it", async () => {
    // Redacting rather than dropping the row is the whole point: the member
    // keeps the record of their own bookmark — and, crucially, the ability to
    // remove it — even though the content is no longer theirs to read.
    renderPanel({
      bookmarks: [
        entry({
          message_available: false,
          message: message({ content: "[unavailable]" }),
        }),
      ],
    });

    expect(
      screen.getByRole("button", { name: "1 bookmarked messages" }),
    ).toBeInTheDocument();

    // The "lists" half, actually asserted: the earlier version of this test
    // only read the trigger label and would have passed on an empty panel.
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("[unavailable]")).toBeInTheDocument();
  });

  it("offers Remove on a row whose channel is no longer readable", async () => {
    // The defect this closes. The API was changed so that un-bookmarking a
    // lost-access row succeeds — but the only other un-bookmark control is the
    // "Saved" chip on the message row, reachable only from a channel the member
    // can still open. Without a control here, exactly the rows that need
    // removing are the ones with no way to remove them.
    const onRemove = vi.fn();
    renderPanel({
      bookmarks: [entry({ message_available: false })],
      onRemove,
    });

    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(
      screen.getByRole("button", { name: "Remove bookmark" }),
    );

    expect(onRemove).toHaveBeenCalledWith("msg-1");
  });

  it("offers Remove on a readable row too", async () => {
    const onRemove = vi.fn();
    renderPanel({ bookmarks: [entry()], onRemove });

    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(
      screen.getByRole("button", { name: "Remove bookmark" }),
    );

    expect(onRemove).toHaveBeenCalledWith("msg-1");
  });

  it("removing does not also fire the jump", async () => {
    // The Remove control sits inside the row. If it were nested in the row's
    // own button, or the click bubbled to it, every removal would also navigate
    // — and the panel would close over the result.
    const onRemove = vi.fn();
    const onJump = vi.fn();
    renderPanel({ bookmarks: [entry()], onRemove, onJump });

    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(
      screen.getByRole("button", { name: "Remove bookmark" }),
    );

    expect(onRemove).toHaveBeenCalled();
    expect(onJump).not.toHaveBeenCalled();
  });

  it("treats a row with no availability field as available", async () => {
    // Forward-compatibility with a cached payload from before the field
    // existed: defaulting "unknown" to unavailable would make every row inert
    // for one render after a deploy.
    const onJump = vi.fn();
    renderPanel({ bookmarks: [entry()], onJump });

    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByRole("button", { name: /dues link/ }));

    expect(onJump).toHaveBeenCalledWith("chan-random", "msg-1");
  });

  it("timestamps the row by when it was saved, not when the message was sent", async () => {
    // The two differ by a day in this fixture. A member scanning their
    // bookmarks is looking for "the thing I saved recently", so the save time
    // is the useful one — and getting it backwards would be invisible in any
    // test that used the same date for both.
    renderPanel({ bookmarks: [entry()] });
    await userEvent.click(screen.getByRole("button"));

    const row = screen.getByRole("button", { name: /dues link/ });
    expect(row.textContent).toContain("9:30");
    expect(row.textContent).not.toContain("5:09");
  });
});
