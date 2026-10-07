import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MessageItem, type MessageItemProps } from "./message-item";
import { reactionActionType, type ChatMessage } from "@repo/chat-core/types";
import { UNAVAILABLE_QUOTE } from "./reply-quote";
import { reducer } from "@/lib/hooks/use-toast";
import { NOBODY_BLOCKED } from "@/tests/block-list";

// The real list resolves signed URLs through `useFrappClient`, a provider this
// suite does not stand up; a stand-in is enough to say where the list sits.
vi.mock("./message-attachments", () => ({
  MessageAttachments: () => <ul data-testid="attachments" />,
}));

/**
 * `spec/ui/design-system/components.md` §11 specifies the author line as the
 * name then the time, beside an initials avatar. Until display-name resolution
 * landed this row rendered `Member 2f4a1c` with a uuid-derived avatar, so these
 * assert the resolved rendering and keep the truncated id as the degraded case
 * only.
 */
const VIEWER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: OTHER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "hello",
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

type NameResolver = (id: string) => string | null;

const nameFor: NameResolver = (id) => (id === OTHER ? "Alice Chen" : null);

function renderItem(msg: ChatMessage, resolver: NameResolver = nameFor) {
  return render(
    <div role="list">
      <MessageItem
        blockState={NOBODY_BLOCKED}
        message={msg}
        viewerId={VIEWER}
        showHeader
        nameFor={resolver}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        isTapRevealed={false}
        onToggleTapReveal={vi.fn()}
      />
    </div>,
  );
}

function renderItemWithProps(overrides: Partial<MessageItemProps> = {}) {
  return render(
    <div role="list">
      <MessageItem
        blockState={NOBODY_BLOCKED}
        message={message()}
        viewerId={VIEWER}
        showHeader
        nameFor={nameFor}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        isTapRevealed={false}
        onToggleTapReveal={vi.fn()}
        {...overrides}
      />
    </div>,
  );
}

describe("MessageItem author rendering", () => {
  it("renders the resolved display name", () => {
    renderItem(message());

    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.queryByText(/^Member /)).not.toBeInTheDocument();
  });

  it("derives the avatar from the name, not the uuid", () => {
    renderItem(message());

    expect(screen.getByText("AC")).toBeInTheDocument();
    expect(screen.queryByText("22")).not.toBeInTheDocument();
  });

  it("falls back to a truncated id when the sender is unresolvable", () => {
    renderItem(message(), () => null);

    expect(screen.getByText("Member 222222")).toBeInTheDocument();
  });

  it("treats an empty resolved name as unresolvable rather than blank", () => {
    // users.display_name is NOT NULL DEFAULT '', so '' is the real missing case.
    renderItem(message(), () => "");

    expect(screen.getByText("Member 222222")).toBeInTheDocument();
  });

  it("says 'You' on the viewer's own card", () => {
    // A card starts a run, so it carries the author line whoever sent it.
    renderItem(message({ sender_id: VIEWER, kind: "announcement" }));

    expect(screen.getByText("You")).toBeInTheDocument();
  });
});

/**
 * The compact layout `components.md` §11 specs (owner decision 2026-09-29,
 * #2873): no bubble, one shape for every row, and whose message it is carried
 * by the author line rather than by a side and a fill.
 */
describe("MessageItem compact layout (#2873)", () => {
  function bodyOf(container: HTMLElement): HTMLElement {
    const found = container.querySelector<HTMLElement>(
      '[data-slot="message-body"]',
    );
    if (!found) throw new Error("no message body rendered");
    return found;
  }

  function authorLine(container: HTMLElement): HTMLElement | null {
    return container.querySelector<HTMLElement>('[data-slot="author-line"]');
  }

  it("draws no bubble around anyone's message", () => {
    for (const sender of [VIEWER, OTHER]) {
      const { container, unmount } = renderItem(message({ sender_id: sender }));
      const className = bodyOf(container).className;

      // Every one of these was the bubble: its two fills, its hairline, its
      // radius and its padding.
      for (const bubbleClass of [
        "bg-card",
        "bg-primary",
        "border",
        "rounded-[18px]",
        "px-4",
      ]) {
        expect(className, `${sender} ${bubbleClass}`).not.toContain(bubbleClass);
      }
      expect(className, sender).toContain("text-foreground");
      unmount();
    }
  });

  it("gives the viewer's own row the same avatar and author line as anyone's", () => {
    const { container } = renderItem(message({ sender_id: VIEWER }));

    expect(authorLine(container)).not.toBeNull();
    expect(screen.getByText("You")).toBeInTheDocument();
    // The avatar is drawn for the viewer too; its initials come from the
    // uuid slice when the roster has no name for them.
    expect(screen.getByText("11")).toBeInTheDocument();
  });

  it("marks only the viewer's own name in the chapter accent", () => {
    const own = renderItem(message({ sender_id: VIEWER }));
    expect(screen.getByText("You").className).toContain("text-accent-text");
    own.unmount();

    renderItem(message({ sender_id: OTHER }));
    const name = screen.getByText("Alice Chen");
    expect(name.className).toContain("text-foreground");
    expect(name.className).not.toContain("text-accent-text");
  });

  it("puts the time of day on the author line, never the date", () => {
    const { container } = renderItem(message());
    const line = authorLine(container)!;
    const time = line.querySelector("time")!;

    expect(time.textContent).toBe(
      new Date(2026, 7, 16, 17, 9).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
    );
    // `formatClock` printed "Aug 16, 5:09 PM" on every author line.
    expect(line.textContent).not.toMatch(/Aug|16,/);
  });

  it("draws neither avatar nor author line on a follow-on row", () => {
    const { container } = renderItemWithProps({ showHeader: false });

    expect(authorLine(container)).toBeNull();
    expect(screen.queryByText("Alice Chen")).not.toBeInTheDocument();
    expect(screen.queryByText("AC")).not.toBeInTheDocument();
    expect(container.querySelector('[role="listitem"]')?.className).toContain(
      "pt-0.5",
    );
  });

  it("keeps a follow-on's own time in the gutter, hidden until the row is revealed", () => {
    const { container, unmount } = renderItemWithProps({ showHeader: false });
    const gutter = container.querySelector<HTMLElement>(
      '[data-slot="gutter-time"]',
    );

    expect(gutter).not.toBeNull();
    expect(gutter?.getAttribute("dateTime")).toBe(message().created_at);
    // Hours and minutes: the run's author line already says AM or PM.
    expect(gutter?.textContent).toMatch(/^\d{1,2}:09$/);
    // Whole tokens: `group-hover/message:opacity-100` is always present.
    const hidden = gutter!.className.split(/\s+/);
    expect(hidden).toContain("opacity-0");
    expect(hidden).not.toContain("opacity-100");
    expect(hidden).toContain("group-hover/message:opacity-100");
    unmount();

    const revealed = renderItemWithProps({
      showHeader: false,
      isTapRevealed: true,
    });
    expect(
      revealed.container
        .querySelector('[data-slot="gutter-time"]')!
        .className.split(/\s+/),
    ).toContain("opacity-100");
  });

  it("anchors the gutter time to the right, so a long one spills left", () => {
    const { container } = renderItemWithProps({ showHeader: false });
    const tokens = container
      .querySelector('[data-slot="gutter-time"]')!
      .className.split(/\s+/);
    expect(tokens).toContain("flex");
    expect(tokens).toContain("justify-end");
  });

  it("keeps AM/PM in the gutter once the run has crossed noon", () => {
    const noon = new Date(2026, 7, 16, 12, 20).toISOString();
    const morning = new Date(2026, 7, 16, 11, 50).toISOString();
    const { container } = renderItemWithProps({
      message: message({ created_at: noon }),
      showHeader: false,
      runStartedAt: morning,
    });
    expect(
      container.querySelector('[data-slot="gutter-time"]')?.textContent,
    ).toBe(
      new Date(noon).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }),
    );
  });

  it("wraps the action bar inside the row rather than spilling past it", () => {
    const { container } = renderItem(message({ sender_id: VIEWER }));
    const bar = container.querySelector('[aria-label="Message actions"]')!;
    const tokens = bar.className.split(/\s+/);
    expect(tokens).toContain("flex-wrap");
    expect(tokens).toContain("max-w-[calc(100%-2rem)]");
  });

  it("draws no gutter time on the row that starts a run", () => {
    const { container } = renderItem(message());
    expect(container.querySelector('[data-slot="gutter-time"]')).toBeNull();
    expect(container.querySelector('[role="listitem"]')?.className).toContain(
      "pt-4",
    );
  });

  it("lifts the whole row one surface step when revealed", () => {
    const rest = renderItemWithProps();
    const row = rest.container.querySelector('[role="listitem"]')!;
    expect(row.className).toContain("hover:bg-surface-1");
    expect(row.className).not.toMatch(/(^|\s)bg-surface-1/);
    rest.unmount();

    const tapped = renderItemWithProps({ isTapRevealed: true });
    expect(
      tapped.container.querySelector('[role="listitem"]')?.className,
    ).toMatch(/(^|\s)bg-surface-1/);
  });

  it("keeps a deleted message's author line and draws the placeholder", () => {
    const { container } = renderItem(
      message({ sender_id: VIEWER, is_deleted: true }),
    );

    expect(screen.getByText("[message deleted]")).toBeInTheDocument();
    expect(authorLine(container)).not.toBeNull();
  });

  it("dims a pending message's text until it posts", () => {
    const { container } = renderItem(
      message({ sender_id: VIEWER, _status: "pending" }),
    );
    expect(bodyOf(container).className).toContain("text-muted-foreground");
    expect(screen.getByText("Sending…")).toBeInTheDocument();
  });

  it("dims a failed message's text and says so in the danger tone", () => {
    const { container } = renderItem(
      message({ sender_id: VIEWER, _status: "failed", _error: "Offline" }),
    );
    expect(bodyOf(container).className).toContain("text-muted-foreground");
    expect(screen.getByText("Offline").parentElement?.className).toContain(
      "text-destructive-text",
    );
  });
});

/**
 * The action bar floats over the row's top-right corner, icon-only
 * (`components.md` §11 § Per-message actions; #2247's action-bar item).
 */
describe("MessageItem action bar", () => {
  function bar(container: HTMLElement): HTMLElement {
    const found = container.querySelector<HTMLElement>(
      '[role="group"][aria-label="Message actions"]',
    );
    if (!found) throw new Error("no action bar rendered");
    return found;
  }

  it("pins to the row's top-right corner and reserves no height", () => {
    for (const sender of [VIEWER, OTHER]) {
      const { container, unmount } = renderItem(message({ sender_id: sender }));
      const className = bar(container).className;

      expect(className, sender).toContain("absolute");
      expect(className, sender).toContain("right-4");
      expect(className, sender).toContain("top-0");
      expect(className, sender).toContain("-translate-y-1/2");
      // Opaque, because it overlaps the text it floats over.
      expect(className, sender).toContain("bg-card");
      expect(bar(container).parentElement?.getAttribute("role")).toBe(
        "listitem",
      );
      unmount();
    }
  });

  it("comes after the message in reading order", () => {
    const { container } = renderItem(message());
    const row = container.querySelector('[role="listitem"]')!;

    // Last in the row, so a screen reader and the tab sequence reach the
    // message before the controls that act on it.
    expect(row.lastElementChild).toBe(bar(container));
  });

  it("names every icon, and draws no word on any of them", () => {
    renderItemWithProps({
      message: message({ sender_id: VIEWER }),
      onReply: vi.fn(),
      onToggleBookmark: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
    });

    for (const name of ["Reply", "Save", "Edit", "Delete"]) {
      const button = screen.getByRole("button", { name });
      expect(button, name).toHaveAttribute("title");
      expect(button.textContent?.trim(), name).toBe("");
    }
    expect(screen.getByRole("button", { name: "Open emoji picker" })).toHaveAttribute(
      "title",
    );
  });
});

/**
 * #1193: `:hover`/`:focus-within` never fire on a coarse pointer, so the
 * per-message action cluster (quick reactions, Reply) was unreachable there.
 * `isTapRevealed`/`onToggleTapReveal` are the parent-owned reveal state; this
 * file pins the row's own half — the CSS class that actually paints it
 * visible, and the tap handler that requests the toggle.
 */
describe("MessageItem tap-to-reveal (#1193)", () => {
  function actionsCluster(container: HTMLElement): HTMLElement {
    const found = container.querySelector<HTMLElement>(
      '[role="group"][aria-label="Message actions"]',
    );
    if (!found) throw new Error("no action cluster rendered");
    return found;
  }

  it("hides the action cluster (no pointer events, no opacity) when not revealed", () => {
    const { container } = renderItemWithProps({ isTapRevealed: false });
    const cluster = actionsCluster(container);

    // Whole tokens, not substrings: the always-present `group-hover/message:`
    // variants contain these words too.
    const tokens = cluster.className.split(/\s+/);
    expect(tokens).toContain("pointer-events-none");
    expect(tokens).toContain("opacity-0");
    expect(tokens).not.toContain("opacity-100");
  });

  it("shows the action cluster when this row is the one tap-revealed", () => {
    const { container } = renderItemWithProps({ isTapRevealed: true });
    const cluster = actionsCluster(container);

    const tokens = cluster.className.split(/\s+/);
    expect(tokens).toContain("pointer-events-auto");
    expect(tokens).toContain("opacity-100");
    expect(tokens).not.toContain("opacity-0");
  });

  it("requests a toggle when the row is tapped", async () => {
    const user = userEvent.setup();
    const onToggleTapReveal = vi.fn();
    render(
      <div role="list">
        <MessageItem
          blockState={NOBODY_BLOCKED}
          message={message()}
          viewerId={VIEWER}
          showHeader
          nameFor={nameFor}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
          isTapRevealed={false}
          onToggleTapReveal={onToggleTapReveal}
        />
      </div>,
    );

    await user.click(screen.getByRole("listitem"));

    expect(onToggleTapReveal).toHaveBeenCalledTimes(1);
  });

  it("does not toggle for a message with no actions to reveal (unconfirmed)", async () => {
    // `showActions` gates on `isConfirmed`; a pending row's tap must not
    // reach for a toggle that would reveal a cluster the row never renders.
    const user = userEvent.setup();
    const onToggleTapReveal = vi.fn();
    render(
      <div role="list">
        <MessageItem
          blockState={NOBODY_BLOCKED}
          message={message({ _status: "pending" })}
          viewerId={VIEWER}
          showHeader
          nameFor={nameFor}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
          isTapRevealed={false}
          onToggleTapReveal={onToggleTapReveal}
        />
      </div>,
    );

    await user.click(screen.getByRole("listitem"));

    expect(onToggleTapReveal).not.toHaveBeenCalled();
  });

  it("does not toggle when the tap ends a text selection inside this row", () => {
    // A click firing after the member lifted off from selecting text must
    // not also flip the action cluster open — that would be swallowing the
    // selection gesture with an unrelated UI change (acceptance criterion).
    const onToggleTapReveal = vi.fn();
    const { container } = renderItemWithProps({ onToggleTapReveal });

    const row = container.querySelector('[role="listitem"]');
    if (!row) throw new Error("no row rendered");
    // A real node inside the row, so `currentTarget.contains(anchorNode)`
    // is genuinely true — the scoped check this guards against a false
    // suppress from a *different* row's leftover selection (below).
    const anchorNode = row.querySelector("p, span") ?? row.firstElementChild;
    if (!anchorNode) throw new Error("row has no child to anchor a selection on");
    const getSelectionSpy = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "hello",
      anchorNode,
    } as unknown as Selection);

    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onToggleTapReveal).not.toHaveBeenCalled();

    getSelectionSpy.mockRestore();
  });

  it("still toggles when a *different* row's selection is stale (iOS Safari lag)", () => {
    // The unscoped version of this guard (`window.getSelection()` checked
    // globally) would wrongly suppress this tap — the exact regression the
    // scoped `currentTarget.contains(anchorNode)` check exists to avoid.
    const onToggleTapReveal = vi.fn();
    const { container } = renderItemWithProps({ onToggleTapReveal });

    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    elsewhere.textContent = "leftover selection from another message";

    const row = container.querySelector('[role="listitem"]');
    if (!row) throw new Error("no row rendered");
    const getSelectionSpy = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "leftover selection from another message",
      anchorNode: elsewhere.firstChild,
    } as unknown as Selection);

    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onToggleTapReveal).toHaveBeenCalledTimes(1);

    getSelectionSpy.mockRestore();
    elsewhere.remove();
  });

  it("does not toggle for a click on a button nested inside the row", async () => {
    // The reaction chips, Reply, and the emoji-picker trigger all live
    // inside this row; without this guard, using any of them would also
    // re-toggle the cluster in the same gesture (review finding).
    const user = userEvent.setup();
    const onToggleTapReveal = vi.fn();
    // Reply stages an inline reply now rather than opening the thread panel
    // (#489). The control is the same chip in the same cluster, so it is still
    // the right representative nested button for this guard — only the handler
    // it fires changed.
    const onReply = vi.fn();
    renderItemWithProps({ onToggleTapReveal, onReply, isTapRevealed: true });

    await user.click(screen.getByRole("button", { name: /reply/i }));

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onToggleTapReveal).not.toHaveBeenCalled();
  });
});

/**
 * #489. `spec/behavior/chat/README.md` § Reply threads: "The UI shows the
 * replied-to message as a quote/preview above the reply… Discord-style
 * reply-with-quote, not Slack-style nested threads."
 *
 * Before this, the row's **Reply** control opened a thread panel, which had no
 * composer — so no web surface could author a reply at all — and nothing in the
 * timeline read `reply_to_id`.
 */
describe("MessageItem reply-with-quote (#489)", () => {
  const PARENT = message({ id: "parent-1", content: "the original" });

  it("stages an inline reply from the Reply control, and jumps nowhere", async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    const onJumpToParent = vi.fn();
    renderItemWithProps({ onReply, onJumpToParent, isTapRevealed: true });

    await user.click(screen.getByRole("button", { name: /reply/i }));

    expect(onReply).toHaveBeenCalledTimes(1);
    // The whole defect: this control used to lead to a read-only panel.
    expect(onJumpToParent).not.toHaveBeenCalled();
  });

  it("offers no Reply control when the surface does not wire one", () => {
    // A chip that calls nothing is worse than no chip.
    renderItemWithProps({ isTapRevealed: true });
    expect(
      screen.queryByRole("button", { name: /reply/i }),
    ).not.toBeInTheDocument();
  });

  it("renders the parent's author and body above a reply", () => {
    renderItemWithProps({
      message: message({ id: "child-1", reply_to_id: "parent-1", content: "agreed" }),
      replyParent: PARENT,
    });
    expect(screen.getByText("the original")).toBeInTheDocument();
    expect(screen.getByText("agreed")).toBeInTheDocument();
  });

  it("jumps to the quoted message from the quote (#2142)", async () => {
    // The quote used to open `ThreadPanel` in the Details rail. Both are gone;
    // the quote now scrolls the timeline to the message it quotes, which is the
    // same destination with a composer under it.
    const user = userEvent.setup();
    const onJumpToParent = vi.fn();
    renderItemWithProps({
      message: message({ id: "child-1", reply_to_id: "parent-1" }),
      replyParent: PARENT,
      onJumpToParent,
    });

    await user.click(screen.getByRole("button", { name: /the original/i }));

    expect(onJumpToParent).toHaveBeenCalledWith(PARENT);
  });

  it("renders no quote at all on a message that is not a reply", () => {
    renderItemWithProps({ message: message({ reply_to_id: null }) });
    expect(screen.queryByText(UNAVAILABLE_QUOTE)).not.toBeInTheDocument();
    expect(screen.queryByText("the original")).not.toBeInTheDocument();
  });

  it("still marks a reply as one when its parent is outside the loaded window", () => {
    // `undefined` (not a reply) and `null` (a reply whose parent is not loaded)
    // must stay distinguishable. Keyed on `reply_to_id`, not on `replyParent`,
    // so a missing parent cannot silently downgrade the row to a plain message.
    renderItemWithProps({
      message: message({ id: "child-1", reply_to_id: "gone" }),
      replyParent: null,
    });
    expect(screen.getByText(UNAVAILABLE_QUOTE)).toBeInTheDocument();
  });

  it("drops the quote on a deleted reply, as it drops the reactions", () => {
    // A tombstone is not something anyone said, so it must not keep asserting
    // what it was answering.
    renderItemWithProps({
      message: message({ id: "child-1", reply_to_id: "parent-1", is_deleted: true }),
      replyParent: PARENT,
    });
    expect(screen.queryByText("the original")).not.toBeInTheDocument();
  });

  it("quotes a deleted PARENT as a tombstone rather than hiding the quote", () => {
    // The opposite case, and it must not be folded into the one above: the
    // reply is still real and still needs to say what it answered.
    renderItemWithProps({
      message: message({ id: "child-1", reply_to_id: "parent-1" }),
      replyParent: message({ id: "parent-1", is_deleted: true, content: "" }),
    });
    expect(screen.getByText("[message deleted]")).toBeInTheDocument();
  });
});

/**
 * Edit is server-enforced own-only and, client-side, only offered for a
 * plain-text message (`canEditMessage`) — a card has no free-text `content`
 * a member typed. Delete is offered for the viewer's own message, or any
 * message when `canManageChannel` is set (mirrors the server's
 * `channels:manage` override).
 */
describe("MessageItem edited marker", () => {
  const edited = { edited_at: new Date(2026, 7, 16, 17, 12).toISOString() };

  it("marks an edited message after its text", () => {
    const { container } = renderItem(message(edited));
    const marker = screen.getByText("(edited)");
    // Inside the body, after the last line — not on the author line, which a
    // follow-on row does not draw.
    expect(
      container.querySelector('[data-slot="message-body"]'),
    ).toContainElement(marker);
    expect(
      container.querySelector('[data-slot="author-line"]'),
    ).not.toContainElement(marker);
  });

  it("marks an edited follow-on row, which has no author line (#2872)", () => {
    renderItemWithProps({ message: message(edited), showHeader: false });
    expect(screen.getByText("(edited)")).toBeInTheDocument();
  });

  it("marks the viewer's own edited message the same way", () => {
    renderItem(message({ ...edited, sender_id: VIEWER }));
    expect(screen.getByText("(edited)")).toBeInTheDocument();
  });

  it("marks a pinned message after its text, on a follow-on row too", () => {
    const { container } = renderItemWithProps({
      message: message({ is_pinned: true }),
      showHeader: false,
    });
    const pinned = screen.getByText("Pinned");
    expect(
      container.querySelector('[data-slot="message-body"]'),
    ).toContainElement(pinned);
  });

  it("marks a photo-only message on a line of its own under the photo", () => {
    const { container } = renderItem(
      message({
        ...edited,
        content: "",
        attachment_count: 1,
        is_pinned: true,
      }),
    );
    // No text row above the photo (§11): the markers follow the attachment.
    expect(container.querySelector('[data-slot="message-body"]')).toBeNull();
    const markers = container.querySelector('[data-slot="message-trailing"]')!;
    expect(markers).toHaveTextContent("(edited)Pinned");
    expect(
      screen
        .getByTestId("attachments")
        .compareDocumentPosition(markers) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Flush with the column, not indented as if it trailed text.
    expect(markers.parentElement).toHaveClass("[&>span]:ml-0");
  });

  it("names an imported Discord author on the author line", () => {
    const { container } = renderItem(
      message({
        kind: "imported",
        sender_id: null,
        author_name: "archive-bot",
        author_external_id: "99",
      }),
    );
    expect(
      container.querySelector('[data-slot="author-line"]'),
    ).toHaveTextContent("archive-bot");
  });

  it("marks no pin on a deleted message", () => {
    renderItem(message({ is_pinned: true, is_deleted: true }));
    expect(screen.queryByText("Pinned")).not.toBeInTheDocument();
  });

  it("sizes a card to its content, not the thread's width", () => {
    // The body column stretches its children, as the bubble's column did not.
    renderItem(message({ kind: "announcement", content: "Formal is Friday" }));
    expect(
      screen.getByText("Formal is Friday").closest(".rounded-lg"),
    ).toHaveClass(
      "w-fit",
      "max-w-full",
    );
    renderItem(message({ id: "dues-1", kind: "dues", content: "Pay up" }));
    expect(
      screen.getByText(/not built yet/).closest(".rounded-lg"),
    ).toHaveClass("w-fit", "max-w-full");
  });

  it("marks an edited card under the card, not inside it", () => {
    const { container } = renderItem(
      message({ ...edited, kind: "announcement", payload: { title: "Formal" } }),
    );
    const marker = screen.getByText("(edited)");
    expect(container.querySelector('[data-slot="message-body"]')).toBeNull();
    expect(marker).toBeInTheDocument();
  });

  it("drops the marker once the message is deleted, on either side", () => {
    const { unmount } = renderItem(message({ ...edited, is_deleted: true }));
    expect(screen.queryByText("(edited)")).not.toBeInTheDocument();
    unmount();
    renderItem(message({ ...edited, is_deleted: true, sender_id: VIEWER }));
    expect(screen.queryByText("(edited)")).not.toBeInTheDocument();
  });

  it("marks nothing on a message never edited", () => {
    renderItem(message());
    expect(screen.queryByText("(edited)")).not.toBeInTheDocument();
  });
});

describe("MessageItem edit and delete", () => {
  it("offers Edit on the viewer's own text message when onEdit is provided", () => {
    renderItemWithProps({
      message: message({ sender_id: VIEWER }),
      onEdit: vi.fn(),
    });

    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  it("does not offer Edit on someone else's message", () => {
    renderItemWithProps({
      message: message({ sender_id: OTHER }),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      canManageChannel: true,
    });

    expect(
      screen.queryByRole("button", { name: /edit/i }),
    ).not.toBeInTheDocument();
  });

  it("does not offer Edit on the viewer's own card message (no free-text content)", () => {
    renderItemWithProps({
      message: message({ sender_id: VIEWER, kind: "announcement" }),
      onEdit: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: /edit/i }),
    ).not.toBeInTheDocument();
  });

  it("does not offer Edit when no onEdit handler is given", () => {
    renderItemWithProps({ message: message({ sender_id: VIEWER }) });

    expect(
      screen.queryByRole("button", { name: /edit/i }),
    ).not.toBeInTheDocument();
  });

  it("offers Delete on the viewer's own message when onDelete is provided", () => {
    renderItemWithProps({
      message: message({ sender_id: VIEWER }),
      onDelete: vi.fn(),
    });

    expect(
      screen.getByRole("button", { name: /delete/i }),
    ).toBeInTheDocument();
  });

  it("offers Delete on someone else's message only with channels:manage", () => {
    const onDelete = vi.fn();
    const { rerender } = renderItemWithProps({
      message: message({ sender_id: OTHER }),
      onDelete,
      canManageChannel: false,
    });
    expect(
      screen.queryByRole("button", { name: /delete/i }),
    ).not.toBeInTheDocument();

    rerender(
      <div role="list">
        <MessageItem
          blockState={NOBODY_BLOCKED}
          message={message({ sender_id: OTHER })}
          viewerId={VIEWER}
          showHeader
          nameFor={nameFor}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
          isTapRevealed={false}
          onToggleTapReveal={vi.fn()}
          onDelete={onDelete}
          canManageChannel
        />
      </div>,
    );
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });

  it("calls onDelete with the message id directly — MessageItem does not confirm on its own", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    renderItemWithProps({
      message: message({ id: "msg-9", sender_id: VIEWER }),
      onDelete,
    });

    await user.click(screen.getByRole("button", { name: /delete/i }));

    expect(onDelete).toHaveBeenCalledWith("msg-9");
  });

  it("opens an inline editor pre-filled with the current content, and saves on click", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    renderItemWithProps({
      message: message({ id: "msg-2", sender_id: VIEWER, content: "hello" }),
      onEdit,
    });

    await user.click(screen.getByRole("button", { name: /edit/i }));

    const textbox = screen.getByRole("textbox");
    expect(textbox).toHaveValue("hello");

    await user.clear(textbox);
    await user.type(textbox, "hello, edited");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onEdit).toHaveBeenCalledWith("msg-2", "hello, edited");
    // The editor closes once the save resolves.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("cancels without calling onEdit and restores the original content", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderItemWithProps({
      message: message({ sender_id: VIEWER, content: "hello" }),
      onEdit,
    });

    await user.click(screen.getByRole("button", { name: /edit/i }));
    await user.type(screen.getByRole("textbox"), " world");
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("picks up a content change from elsewhere while the untouched editor is still open", async () => {
    // Same component instance across a content update (rows are keyed by
    // id, not remounted) — an edit landing from another of the viewer's own
    // sessions while this editor sits open-but-untouched must not leave it
    // showing what the message *used to* say.
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { rerender } = renderItemWithProps({
      message: message({ id: "msg-1", sender_id: VIEWER, content: "hello" }),
      onEdit,
    });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.getByRole("textbox")).toHaveValue("hello");

    rerender(
      <div role="list">
        <MessageItem
          blockState={NOBODY_BLOCKED}
          message={message({ id: "msg-1", sender_id: VIEWER, content: "hello v2" })}
          viewerId={VIEWER}
          showHeader
          nameFor={nameFor}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
          isTapRevealed={false}
          onToggleTapReveal={vi.fn()}
          onEdit={onEdit}
        />
      </div>,
    );

    expect(screen.getByRole("textbox")).toHaveValue("hello v2");
  });

  it("does not clobber an in-progress draft when content changes elsewhere after typing has started", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { rerender } = renderItemWithProps({
      message: message({ id: "msg-1", sender_id: VIEWER, content: "hello" }),
      onEdit,
    });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    await user.type(screen.getByRole("textbox"), " there");
    expect(screen.getByRole("textbox")).toHaveValue("hello there");

    rerender(
      <div role="list">
        <MessageItem
          blockState={NOBODY_BLOCKED}
          message={message({ id: "msg-1", sender_id: VIEWER, content: "hello v2" })}
          viewerId={VIEWER}
          showHeader
          nameFor={nameFor}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
          isTapRevealed={false}
          onToggleTapReveal={vi.fn()}
          onEdit={onEdit}
        />
      </div>,
    );

    expect(screen.getByRole("textbox")).toHaveValue("hello there");
  });

  it("closes the editor when Edit is withdrawn mid-edit, rather than leaving a Save that does nothing (#2775)", async () => {
    const user = userEvent.setup();
    const { rerender } = renderItemWithProps({
      message: message({ id: "msg-1", sender_id: VIEWER, content: "hello" }),
      onEdit: vi.fn(),
    });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    // The channel was made read-only, or the member became an alumnus: the
    // shell stops passing `onEdit`.
    rerender(
      <div role="list">
        <MessageItem
          blockState={NOBODY_BLOCKED}
          message={message({ id: "msg-1", sender_id: VIEWER, content: "hello" })}
          viewerId={VIEWER}
          showHeader
          nameFor={nameFor}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
          isTapRevealed={false}
          onToggleTapReveal={vi.fn()}
        />
      </div>,
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps the editor open with the draft intact when the save rejects", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockRejectedValue(new Error("network error"));
    renderItemWithProps({
      message: message({ sender_id: VIEWER, content: "hello" }),
      onEdit,
    });

    await user.click(screen.getByRole("button", { name: /edit/i }));
    await user.type(screen.getByRole("textbox"), " world");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onEdit).toHaveBeenCalledWith("msg-1", "hello world");
    expect(screen.getByRole("textbox")).toHaveValue("hello world");
  });

  it("hides reaction chips on a deleted message — nothing left to react to", () => {
    renderItemWithProps({
      message: message({
        sender_id: VIEWER,
        is_deleted: true,
        reactions: { "👍": [OTHER] },
      }),
    });

    expect(screen.queryByText("👍")).not.toBeInTheDocument();
  });

  it("draws imported Discord reaction totals as read-only chips", () => {
    const onReact = vi.fn();
    renderItemWithProps({
      onReact,
      message: message({
        kind: "imported",
        sender_id: null,
        author_name: "archive-bot",
        payload: {
          source: "discord",
          reactions: [
            { emoji: "🔥", name: null, count: 4 },
            { emoji: "party_blob", name: "party_blob", count: 2 },
          ],
        },
      }),
    });

    expect(
      screen.getByLabelText(/🔥 reaction, 4\. From the imported archive/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/:party_blob: reaction, 2\. From the imported archive/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /from the imported archive/i }),
    ).not.toBeInTheDocument();
    expect(onReact).not.toHaveBeenCalled();
  });

  it("does not draw payload.reactions on a live message", () => {
    renderItemWithProps({
      message: message({
        kind: "text",
        payload: {
          source: "discord",
          reactions: [{ emoji: "🔥", name: null, count: 4 }],
        },
      }),
    });
    expect(screen.queryByLabelText(/imported archive/)).not.toBeInTheDocument();
  });

  it("hides the imported summary on a deleted archive row", () => {
    renderItemWithProps({
      message: message({
        kind: "imported",
        is_deleted: true,
        sender_id: null,
        author_name: "archive-bot",
        payload: {
          source: "discord",
          reactions: [{ emoji: "🔥", name: null, count: 4 }],
        },
      }),
    });
    expect(screen.queryByLabelText(/imported archive/)).not.toBeInTheDocument();
  });

  it("closes an open editor rather than leaving a stale draft when the message is deleted out from under it", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const { rerender } = renderItemWithProps({
      message: message({ id: "msg-1", sender_id: VIEWER, content: "hello" }),
      onEdit,
    });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    // A `channels:manage` holder (or the sender from another tab) deletes it
    // while this row's editor is still open.
    rerender(
      <div role="list">
        <MessageItem
          blockState={NOBODY_BLOCKED}
          message={message({
            id: "msg-1",
            sender_id: VIEWER,
            content: "hello",
            is_deleted: true,
          })}
          viewerId={VIEWER}
          showHeader
          nameFor={nameFor}
          onReact={vi.fn()}
          onUnreact={vi.fn()}
          isTapRevealed={false}
          onToggleTapReveal={vi.fn()}
          onEdit={onEdit}
        />
      </div>,
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("[message deleted]")).toBeInTheDocument();
  });
});

describe("MessageItem bookmark toggle (#462)", () => {
  it("renders no bookmark control when the surface does not wire one", () => {
    // A control that silently does nothing is the dead end
    // spec/ui/design-system/README.md §5 rule 2 bans — the pins panel already
    // had to be rescued from exactly that. A
    // surface without `onToggleBookmark` hides the affordance instead.
    renderItemWithProps();

    expect(
      screen.queryByRole("button", { name: /^Save$|^Saved$/ }),
    ).not.toBeInTheDocument();
  });

  it("offers Save on an unbookmarked message and reports pressed state", async () => {
    renderItemWithProps({ onToggleBookmark: vi.fn(), isBookmarked: false });

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("reads pressed once bookmarked, under the same name", () => {
    // `aria-pressed` carries the state, and the name stays "Save": a toggle
    // whose name flips announces to a screen reader as one button disappearing
    // and a different one arriving in the same slot. Only the tooltip says
    // "Saved".
    renderItemWithProps({ onToggleBookmark: vi.fn(), isBookmarked: true });

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveAttribute("title", "Saved");
  });

  it("asks for the opposite of the current state, not a blind toggle", async () => {
    const onToggleBookmark = vi.fn();
    renderItemWithProps({ onToggleBookmark, isBookmarked: true });

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onToggleBookmark).toHaveBeenCalledWith("msg-1", false);
  });

  it("sends true when saving a message that is not yet bookmarked", async () => {
    const onToggleBookmark = vi.fn();
    renderItemWithProps({ onToggleBookmark, isBookmarked: false });

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onToggleBookmark).toHaveBeenCalledWith("msg-1", true);
  });

  it("shows no bookmark control on a deleted message", () => {
    // The whole action cluster is gated on `showActions`, which excludes
    // tombstones. The spec's deletion rule is that an *existing* bookmark
    // survives — not that a tombstone can be bookmarked fresh — and the
    // Bookmarks panel is where that survival is asserted.
    renderItemWithProps({
      message: message({ is_deleted: true, content: "[message deleted]" }),
      onToggleBookmark: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: /^Save$|^Saved$/ }),
    ).not.toBeInTheDocument();
  });
});

/**
 * #1733 — the `unconfirmed` row: a heavy command whose response was lost.
 *
 * The row must read as "we don't know", not as a failure, and its only action
 * must be a replay of the original request. Both halves are load-bearing: red
 * "failed" styling is what makes an officer re-type the command, and a Discard
 * here would throw away the only trace of a grant that may have committed.
 */
const REPLAY = {
  command: "points",
  channelId: "chan-1",
  clientMessageId: "client-1",
  body: {
    target_user_id: OTHER,
    amount: 5,
    category: "MANUAL",
    reason: "great work",
    channel_id: "chan-1",
    client_message_id: "client-1",
  },
} as const;

function unconfirmedMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return message({
    sender_id: VIEWER,
    kind: "loading",
    content: "Granting 5 points…",
    _status: "unconfirmed",
    _error: "Not confirmed — these points may or may not have been recorded.",
    _replay: REPLAY,
    ...overrides,
  } as Partial<ChatMessage>);
}

describe("MessageItem unconfirmed rows (#1733)", () => {
  it("offers Retry", () => {
    renderItemWithProps({
      message: unconfirmedMessage(),
      onRetryUnconfirmed: vi.fn(),
    });

    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  // The row may be the only trace of a committed ledger write.
  it("offers no Discard, even when a discard handler is wired", () => {
    renderItemWithProps({
      message: unconfirmedMessage(),
      onRetryUnconfirmed: vi.fn(),
      onDiscard: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: /discard/i }),
    ).not.toBeInTheDocument();
  });

  it("replays the original request, not just the cache key", async () => {
    const onRetryUnconfirmed = vi.fn();
    renderItemWithProps({
      message: unconfirmedMessage(),
      onRetryUnconfirmed,
    });

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    // The ORIGINAL body, carrying the ORIGINAL client_message_id — that is what
    // lets the server recognise the replay instead of writing a second row.
    expect(onRetryUnconfirmed).toHaveBeenCalledWith(REPLAY);
  });

  it("shows the unconfirmed note rather than a send-failure message", () => {
    renderItemWithProps({
      message: unconfirmedMessage(),
      onRetryUnconfirmed: vi.fn(),
    });

    expect(screen.getByText(/may or may not have been recorded/i)).toBeInTheDocument();
    expect(screen.queryByText(/send failed/i)).not.toBeInTheDocument();
  });

  // A row with no replay descriptor has nothing safe to resend, so it must not
  // render a control that would do nothing.
  it("renders no retry control when the row carries no replay", () => {
    renderItemWithProps({
      message: unconfirmedMessage({ _replay: undefined }),
      onRetryUnconfirmed: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: /retry/i }),
    ).not.toBeInTheDocument();
  });

  it("disables the control while a replay is in flight, so one click is one replay", async () => {
    let release: () => void = () => {};
    const onRetryUnconfirmed = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    renderItemWithProps({
      message: unconfirmedMessage(),
      onRetryUnconfirmed,
    });

    const button = screen.getByRole("button", { name: /retry/i });
    await userEvent.click(button);

    expect(screen.getByRole("button", { name: /retrying/i })).toBeDisabled();
    expect(onRetryUnconfirmed).toHaveBeenCalledTimes(1);
    release();
  });
});

/**
 * Regression guards from the #1733 review: an unconfirmed row must not look
 * like one still in flight, and its note must actually be announced.
 */
describe("MessageItem unconfirmed presentation (#1733 review)", () => {
  it("does not render the row as busy", () => {
    const { container } = renderItemWithProps({
      message: unconfirmedMessage(),
      onRetryUnconfirmed: vi.fn(),
    });

    // A shimmer under aria-busy reads as "still working", so an officer waits
    // instead of pressing Retry — and a possibly-committed grant gets re-typed.
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("announces the unconfirmed note in a live region", () => {
    renderItemWithProps({
      message: unconfirmedMessage(),
      onRetryUnconfirmed: vi.fn(),
    });

    const note = screen.getByText(/may or may not have been recorded/i);
    expect(note.closest("[aria-live]")).not.toBeNull();
  });

  it("keeps a genuinely pending row busy", () => {
    const { container } = renderItemWithProps({
      message: unconfirmedMessage({
        _status: "pending",
        _error: undefined,
        _replay: undefined,
      } as Partial<ChatMessage>),
    });

    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("swallows a rejected retry rather than leaving it unhandled", async () => {
    const onRetryUnconfirmed = vi.fn(() => Promise.reject(new Error("boom")));
    renderItemWithProps({
      message: unconfirmedMessage(),
      onRetryUnconfirmed,
    });

    await userEvent.click(screen.getByRole("button", { name: /retry/i }));

    // The button must return to a usable state; the handler owns reporting.
    expect(
      await screen.findByRole("button", { name: /^retry$/i }),
    ).toBeEnabled();
  });
});

describe("MessageItem unconfirmed live regions (#1733 review)", () => {
  // Two populated live regions on one row get re-announced together on every
  // Virtuoso remount. A terminal row is not a live status.
  it("leaves exactly one live region on the row", () => {
    const { container } = renderItemWithProps({
      message: unconfirmedMessage(),
      onRetryUnconfirmed: vi.fn(),
    });

    const populated = Array.from(
      container.querySelectorAll("[aria-live]"),
    ).filter((el) => (el.textContent ?? "").trim().length > 0);
    expect(populated).toHaveLength(1);
  });

  it("keeps the card a live status while it is genuinely pending", () => {
    const { container } = renderItemWithProps({
      message: unconfirmedMessage({
        _status: "pending",
        _error: undefined,
        _replay: undefined,
      } as Partial<ChatMessage>),
    });

    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });

  // The row's note must not restate the toast's guidance: it sits directly
  // above its own Retry button, where "use Retry on the message" is nonsense.
  it("does not print the toast's guidance on the row", () => {
    renderItemWithProps({
      message: unconfirmedMessage(),
      onRetryUnconfirmed: vi.fn(),
    });

    expect(screen.queryByText(/use retry on the message/i)).toBeNull();
  });
});

/**
 * #1789 — `card_posted: false`: the write committed, the chat card did not.
 *
 * Distinct from `unconfirmed` on purpose. Retry is the dangerous action here
 * (a fresh command mints a new key and doubles an append-only write), so the
 * row must not offer one. The sticky warning toast is secondary and evictable
 * (`TOAST_LIMIT = 1`); this row is the trace that has to survive that.
 */
function recordedMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return message({
    sender_id: VIEWER,
    kind: "loading",
    content: "Granting 5 points…",
    _status: "recorded",
    _error:
      "Points recorded — the chat card didn't post. Don't run this command again.",
    ...overrides,
  } as Partial<ChatMessage>);
}

describe("MessageItem recorded rows (#1789)", () => {
  it("offers neither Retry nor Discard, even when those handlers are wired", () => {
    renderItemWithProps({
      message: recordedMessage(),
      onRetry: vi.fn(),
      onDiscard: vi.fn(),
      onRetryUnconfirmed: vi.fn(),
    });

    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /discard/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/granting 5 points/i)).toBeInTheDocument();
  });

  it("does not render the row as busy", () => {
    const { container } = renderItemWithProps({
      message: recordedMessage(),
    });

    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("announces the recorded note in a live region, not as a failure", () => {
    const { container } = renderItemWithProps({
      message: recordedMessage(),
    });

    const note = screen.getByText(/don't run this command again/i);
    expect(note.closest("[aria-live]")).not.toBeNull();
    expect(note.className).not.toMatch(/destructive/);
    expect(container.querySelector(".text-destructive-text")).toBeNull();
  });

  it("keeps the recorded row after the next toast evicts the warning", () => {
    renderItemWithProps({
      message: recordedMessage(),
      onRetry: vi.fn(),
      onDiscard: vi.fn(),
    });

    expect(screen.getByText(/don't run this command again/i)).toBeInTheDocument();

    // MessageItem does not subscribe to toast state — that independence is
    // the architecture (#1789). This half pins the eviction path itself:
    // `ADD_TOAST` slices to `TOAST_LIMIT = 1`. Raising that limit is not
    // this issue's fix.
    const after = reducer(
      {
        toasts: [
          {
            id: "warning",
            title: "/points partly succeeded",
            description:
              "Points were recorded, but the chat card couldn't be posted.",
            open: true,
          },
        ],
      },
      {
        type: "ADD_TOAST",
        toast: {
          id: "next",
          title: "Messages can't carry attachments",
          open: true,
        },
      },
    );
    expect(after.toasts).toHaveLength(1);
    expect(after.toasts[0]?.id).toBe("next");
    expect(after.toasts.some((t) => t.id === "warning")).toBe(false);

    expect(screen.getByText(/don't run this command again/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });
});

/**
 * The inline editor takes the body's place, at the body column's width.
 *
 * Under the §11 bubble layout this suite pinned a fix for a "postage stamp"
 * editor: a `<textarea>` inside a shrink-wrapped bubble resolved its `w-full`
 * circularly and sized itself from `cols=20`. The compact layout's body column
 * is a `flex-1` track with a definite width, so that cannot recur; what is
 * left to pin is that the editor stays in the row and fills that column.
 * jsdom computes no layout, so these assert the structure, not pixels.
 */
describe("MessageItem inline editor", () => {
  /** The edit surface itself — the element the textarea is wrapped in. */
  function editSurface(): HTMLElement {
    const field = screen.getByRole("textbox");
    if (!field.parentElement) throw new Error("editor is not mounted");
    return field.parentElement;
  }

  async function openEditor(content = "hello") {
    const user = userEvent.setup();
    const rendered = renderItemWithProps({
      message: message({ sender_id: VIEWER, content }),
      onEdit: vi.fn().mockResolvedValue(undefined),
    });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    return { user, ...rendered };
  }

  it("edits in the row itself, never in a dialog or a popover", async () => {
    const { container } = await openEditor();

    // A dialog or popover portals out of the row, so the row would no longer
    // contain the field. Queried through `screen`, not `container`: Radix
    // portals a Dialog or a Popover to `document.body`, a *sibling* of the
    // container RTL renders into, so a container-scoped query for one is null
    // whether or not it is there — a tripwire that cannot trip.
    const row = container.querySelector('[role="listitem"]');
    expect(row).not.toBeNull();
    expect(row).toContainElement(screen.getByRole("textbox"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("takes the body's place in the body column, at its full width", async () => {
    const { container } = await openEditor();

    expect(container.querySelector('[data-slot="message-body"]')).toBeNull();
    expect(editSurface().className).toContain("w-full");
    // The column the field fills is the flex-1 track beside the gutter, which
    // is what gives `w-full` a definite width to resolve against.
    expect(editSurface().parentElement?.className).toContain("flex-1");
  });

  it("is the plain text input, not a bubble in draft", async () => {
    await openEditor();

    expect(editSurface().className).not.toContain("rounded-[18px]");
    // Grows with the draft instead of scrolling a fixed box, on the body's
    // 25px line box so the draft wraps near where the message wrapped.
    expect(screen.getByRole("textbox").className).toContain(
      "field-sizing-content",
    );
    expect(screen.getByRole("textbox").className).toContain("leading-[25px]");
    expect(screen.getByRole("textbox").className).toContain("max-h-40");
  });

  it("gives the body back when the editor closes", async () => {
    const { container, user } = await openEditor();

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    expect(container.querySelector('[data-slot="message-body"]')).not.toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps the reply quote in place while editing", async () => {
    const user = userEvent.setup();
    renderItemWithProps({
      message: message({ sender_id: VIEWER, reply_to_id: "msg-parent" }),
      replyParent: message({ id: "msg-parent", content: "the original" }),
      onEdit: vi.fn(),
    });
    expect(screen.getByText("the original")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /edit/i }));

    // Only the *body* becomes editable. A quote is a property of the message,
    // not of how its text is drawn, and it is not what is being edited —
    // dropping it was the other half of the jump, since the block also lost
    // whatever width the quote was contributing. The attachment list rides the
    // same rung of the block and is covered by the same change, but it cannot
    // be mounted here: `MessageAttachments` resolves signed URLs through
    // `useFrappClient` and needs a provider this suite does not stand up.
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(screen.getByText("the original")).toBeInTheDocument();
  });

  it("gives the field a name of its own", async () => {
    await openEditor();

    // The row has no visible label to point at, so without this the one control
    // a member is asked to type into announces as an unnamed text field.
    expect(
      screen.getByRole("textbox", { name: /edit message/i }),
    ).toBeInTheDocument();
  });
});

/**
 * Keyboard and focus for the inline editor. Escape and Enter already worked and
 * were untested; the focus hand-back did not exist — Cancel dropped focus to
 * `<body>`, which on a virtualized timeline means the next Tab starts over at
 * the top of the document rather than at the message the member was just
 * editing.
 */
describe("MessageItem inline editor keyboard", () => {
  async function openEditor(content = "hello") {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockResolvedValue(undefined);
    const rendered = renderItemWithProps({
      message: message({ id: "msg-kb", sender_id: VIEWER, content }),
      onEdit,
    });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    return { user, onEdit, ...rendered };
  }

  it("closes on Escape without saving", async () => {
    const { user, onEdit } = await openEditor();

    await user.type(screen.getByRole("textbox"), " world");
    await user.keyboard("{Escape}");

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("returns focus to Edit when the editor is dismissed from the keyboard", async () => {
    const { user } = await openEditor();

    await user.keyboard("{Escape}");

    // The cluster is unmounted for the whole time the editor is open, so the
    // button being focused here did not exist at the moment Escape fired — the
    // hand-back has to survive that commit and land after the remount.
    expect(screen.getByRole("button", { name: /edit/i })).toHaveFocus();
  });

  it("returns focus to Edit after a keyboard save too", async () => {
    const { user, onEdit } = await openEditor();

    await user.keyboard("{Enter}");

    // Saving is the *common* way out of the editor, so skipping the hand-back
    // here left the usual path with the defect the rare one was fixed for:
    // `disabled` drops focus to the body while the request is in flight, and
    // the next Tab then restarts at the top of a 200-row timeline.
    expect(onEdit).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /edit/i })).toHaveFocus();
  });

  it("does not pin the hover cluster open when the mouse dismissed the editor", async () => {
    const { user } = await openEditor();

    await user.click(screen.getByRole("button", { name: /cancel/i }));

    // The action cluster is revealed by `group-focus-within`, so focusing Edit
    // holds it open. That is what a keyboard user wants and the opposite of
    // what a member who just clicked Cancel wants — their pointer is somewhere
    // else, and they would be left with four controls painted over the message
    // until focus happened to move again. A real click reports `detail >= 1`;
    // keyboard activation of a button reports 0.
    expect(screen.getByRole("button", { name: /edit/i })).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it("hands the caret back to the field when a save fails", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn().mockRejectedValue(new Error("network error"));
    renderItemWithProps({
      message: message({ sender_id: VIEWER, content: "hello" }),
      onEdit,
    });
    await user.click(screen.getByRole("button", { name: /edit/i }));
    await user.type(screen.getByRole("textbox"), " world");
    await user.click(screen.getByRole("button", { name: /save/i }));

    // The editor stays open with the draft — already covered above — but
    // `disabled` blurred the field for the duration of the request, so being
    // told to try again used to mean clicking back into the form first.
    expect(screen.getByRole("textbox")).toHaveValue("hello world");
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("refuses to save a draft emptied down to whitespace", async () => {
    const { user, onEdit } = await openEditor();

    await user.clear(screen.getByRole("textbox"));
    await user.type(screen.getByRole("textbox"), "   ");

    // Deleting a message is a different control with a different authorization
    // (`channels:manage` overrides ownership there and not here), so emptying
    // the field must not become a back door to it. Enter is gated by the same
    // `saveEdit` guard as the button, not only by the button's `disabled`.
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
    await user.keyboard("{Enter}");
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("saves on Enter and keeps Shift+Enter for a newline", async () => {
    const { user, onEdit } = await openEditor();

    await user.type(screen.getByRole("textbox"), " one{Shift>}{Enter}{/Shift}two");
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("hello one\ntwo");

    await user.keyboard("{Enter}");

    expect(onEdit).toHaveBeenCalledWith("msg-kb", "hello one\ntwo");
  });
});

/**
 * Whose reaction a chip is (#2243).
 *
 * `mine` used to be `viewerId ? group.userIds.includes(viewerId) : false`, which
 * on an unresolved viewer is the same confident `false` that mis-drew the bubble
 * — but with a worse consequence than a side. A chip that reads unlit does not
 * merely look wrong: its click handler sends `onReact`, so tapping the reaction
 * you already left adds a second one instead of removing yours. `viewerId` is
 * non-nullable now and the ternary is gone; these pin the behaviour it was
 * guarding, which nothing asserted before.
 *
 * Targeted by the `N, including you` label rather than the emoji text, because
 * `ReactionQuickPick` renders the same glyph in the hover row under a different
 * label (`React with 👍`).
 */
describe("MessageItem reaction chip ownership (#2243)", () => {
  it("lights the viewer's own reaction and removes it on click", async () => {
    const onReact = vi.fn();
    const onUnreact = vi.fn();
    renderItemWithProps({
      message: message({ reactions: { [reactionActionType("👍")]: [VIEWER] } }),
      onReact,
      onUnreact,
    });

    const chip = screen.getByRole("button", { name: /including you/i });
    expect(chip).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(chip);

    expect(onUnreact).toHaveBeenCalledWith("msg-1", "👍");
    expect(onReact).not.toHaveBeenCalled();
  });

  it("leaves someone else's reaction unlit and adds to it on click", async () => {
    const onReact = vi.fn();
    const onUnreact = vi.fn();
    renderItemWithProps({
      message: message({ reactions: { [reactionActionType("👍")]: [OTHER] } }),
      onReact,
      onUnreact,
    });

    const chip = screen.getByRole("button", { name: /reaction, 1\. Click to react/i });
    expect(chip).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(chip);

    expect(onReact).toHaveBeenCalledWith("msg-1", "👍");
    expect(onUnreact).not.toHaveBeenCalled();
  });
});
