import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { PinsPanel } from "./pins-popover";
import { BookmarksPanel, type BookmarkEntry } from "./bookmarks-popover";
import { messageRowButtonClass } from "./message-list-row";

/**
 * Pins and Bookmarks draw their rows through one `MessageListRow` (#1566).
 * These pin the classes each panel renders, written out as the panels spelled
 * them before they shared the row, so a panel that drifts from the shared row
 * (or a shared row that drifts from what both panels drew) turns this red.
 */

const OTHER = "22222222-2222-4222-8222-222222222222";
const nameFor = (id: string) => (id === OTHER ? "Alice Chen" : null);
const WHEN = new Date(2026, 7, 16, 17, 9).toISOString();

const LIST = "max-h-72 divide-y divide-border overflow-y-auto";
const BODY =
  "mt-1 line-clamp-3 block whitespace-pre-wrap text-base text-muted-foreground";
const PIN_BUTTON = cn(
  "block w-full px-3 py-3 text-left text-caption transition-colors",
  "hover:bg-card-hover hover:text-foreground",
  FOCUS_RING,
);
const BOOKMARK_BUTTON = cn(
  "block w-full py-3 pl-3 pr-11 text-left text-caption transition-colors",
  "hover:bg-card-hover hover:text-foreground",
  FOCUS_RING,
);
const BOOKMARK_INERT = "block w-full py-3 pl-3 pr-11 text-left text-caption";

// Only what the row reads: `pins-popover.spec.tsx` owns the full fixture and
// what the panel does with it; this file owns only the markup.
const PIN = {
  id: "msg-1",
  sender_id: OTHER,
  author_name: null,
  author_external_id: null,
  content: "the dues link",
  kind: "text",
  is_pinned: true,
  pinned_at: WHEN,
  is_deleted: false,
  created_at: WHEN,
} as unknown as ChatMessage;

function bookmark(overrides: Partial<BookmarkEntry> = {}): BookmarkEntry {
  return {
    id: "bm-1",
    message_id: "msg-1",
    created_at: WHEN,
    message: {
      id: "msg-1",
      channel_id: "chan-1",
      sender_id: OTHER,
      author_name: null,
      author_external_id: null,
      content: "the dues link",
      is_deleted: false,
      created_at: WHEN,
    },
    ...overrides,
  };
}

describe("messageRowButtonClass", () => {
  it("is the class the search results' rows share with pins", () => {
    // `ChatSearchPanel` takes only the button class and body from the shared
    // row; its rows are otherwise its own.
    expect(messageRowButtonClass()).toBe(PIN_BUTTON);
    expect(messageRowButtonClass(true)).toBe(BOOKMARK_BUTTON);
  });
});

describe("MessageListRow, as the pins and bookmarks panels render it", () => {
  it("draws a pin's row with the full-width padding and no positioning", () => {
    const { container } = render(
      <PinsPanel messages={[PIN]} nameFor={nameFor} />,
    );
    expect(container.querySelector("ul")).toHaveAttribute("class", LIST);
    expect(container.querySelector("li")).not.toHaveAttribute("class");
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("class", PIN_BUTTON);
    const [author, time, body] = Array.from(button.children);
    expect(author).toHaveAttribute(
      "class",
      "block font-semibold text-foreground",
    );
    expect(author).toHaveTextContent("Alice Chen");
    expect(time).toHaveAttribute("class", "block text-muted-foreground");
    expect(body).toHaveAttribute("class", BODY);
  });

  it("draws a bookmark's row with room for Remove, inside a positioned item", () => {
    const { container } = render(
      <BookmarksPanel
        bookmarks={[bookmark()]}
        nameFor={nameFor}
        onRemove={() => {}}
      />,
    );
    expect(container.querySelector("ul")).toHaveAttribute("class", LIST);
    expect(container.querySelector("li")).toHaveAttribute("class", "relative");
    const jump = screen.getAllByRole("button")[0]!;
    expect(jump).toHaveAttribute("class", BOOKMARK_BUTTON);
    expect(jump.children[2]).toHaveAttribute("class", BODY);
    expect(
      screen.getByRole("button", { name: "Remove bookmark" }).parentElement,
    ).toBe(container.querySelector("li"));
  });

  it("draws an unavailable bookmark as a static, italic row", () => {
    const { container } = render(
      <BookmarksPanel
        bookmarks={[bookmark({ message_available: false })]}
        nameFor={nameFor}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const row = container.querySelector("li > div");
    expect(row).toHaveAttribute("class", BOOKMARK_INERT);
    expect(row?.children[0]).toHaveTextContent("Unavailable");
    expect(row?.children[2]).toHaveAttribute("class", `${BODY} italic`);
  });
});
