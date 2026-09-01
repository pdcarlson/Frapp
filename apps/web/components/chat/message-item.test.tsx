import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { MessageItem, type MessageItemProps } from "./message-item";
import type { ChatMessage } from "@repo/chat-core/types";

/**
 * `spec/ui/design-system/components.md` specifies the incoming meta line as
 * `Name · time` with an initials avatar. Until display-name resolution landed
 * this row rendered `Member 2f4a1c` with a uuid-derived avatar, so these assert
 * the resolved rendering and keep the truncated id as the degraded case only.
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

  it("says 'You' on the viewer's own *card*, which keeps the incoming layout", () => {
    // §11 sides bubbles only. A rich card is a card in the flow whoever sent
    // it, so it still carries the author line.
    renderItem(message({ sender_id: VIEWER, kind: "announcement" }));

    expect(screen.getByText("You")).toBeInTheDocument();
  });
});

/**
 * The two shapes `components.md` §11 draws. The distinction is load-bearing
 * rather than cosmetic — it is the whole of "mine vs theirs" on a surface where
 * the accent varies per chapter — so it is asserted rather than eyeballed.
 */
describe("MessageItem bubble sides", () => {
  function bubbleOf(container: HTMLElement): HTMLElement {
    const found = container.querySelector<HTMLElement>(
      '[class*="rounded-\\[18px\\]"]',
    );
    if (!found) throw new Error("no bubble rendered");
    return found;
  }

  it("gives an incoming bubble the card fill, a hairline and the left tail", () => {
    const { container } = renderItem(message());
    const bubble = bubbleOf(container);

    expect(bubble.className).toContain("bg-card");
    expect(bubble.className).toContain("border-border");
    expect(bubble.className).toContain("rounded-bl-[6px]");
  });

  it("gives the viewer's own bubble the accent pair and the right tail", () => {
    const { container } = renderItem(message({ sender_id: VIEWER }));
    const bubble = bubbleOf(container);

    // The one place a message takes the chapter accent, and the engine
    // guarantees this pair together — never a hand-picked foreground.
    expect(bubble.className).toContain("bg-primary");
    expect(bubble.className).toContain("text-primary-foreground");
    expect(bubble.className).toContain("rounded-br-[6px]");
    expect(bubble.className).not.toContain("border-border");
  });

  it("drops the avatar and the name from the viewer's own bubble row", () => {
    renderItem(message({ sender_id: VIEWER }));

    // §11: self is right-aligned with no avatar, and its caption is the time
    // (plus the delivery state), not a name.
    expect(screen.queryByText("You")).not.toBeInTheDocument();
    expect(screen.queryByText("11")).not.toBeInTheDocument();
  });

  it("keeps a deleted message on its own side rather than reflowing the thread", () => {
    renderItem(message({ sender_id: VIEWER, is_deleted: true }));

    expect(screen.getByText("[message deleted]")).toBeInTheDocument();
    expect(screen.queryByText("You")).not.toBeInTheDocument();
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
    const found = container.querySelector<HTMLElement>(".absolute.top-0.z-10");
    if (!found) throw new Error("no action cluster rendered");
    return found;
  }

  it("hides the action cluster (no pointer events, no opacity) when not revealed", () => {
    const { container } = renderItemWithProps({ isTapRevealed: false });
    const cluster = actionsCluster(container);

    expect(cluster.className).toContain("pointer-events-none");
    expect(cluster.className).toContain("opacity-0");
  });

  it("shows the action cluster when this row is the one tap-revealed", () => {
    const { container } = renderItemWithProps({ isTapRevealed: true });
    const cluster = actionsCluster(container);

    expect(cluster.className).toContain("pointer-events-auto");
    expect(cluster.className).toContain("opacity-100");
  });

  it("requests a toggle when the row is tapped", async () => {
    const user = userEvent.setup();
    const onToggleTapReveal = vi.fn();
    render(
      <div role="list">
        <MessageItem
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

  it("does not toggle when the tap ends a text selection inside the bubble", async () => {
    // A click firing after the member lifted off from selecting text must
    // not also flip the action cluster open — that would be swallowing the
    // selection gesture with an unrelated UI change (acceptance criterion).
    const onToggleTapReveal = vi.fn();
    const { container } = renderItemWithProps({ onToggleTapReveal });

    const getSelectionSpy = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "hello",
    } as Selection);

    const row = container.querySelector('[role="listitem"]');
    if (!row) throw new Error("no row rendered");
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onToggleTapReveal).not.toHaveBeenCalled();

    getSelectionSpy.mockRestore();
  });
});
