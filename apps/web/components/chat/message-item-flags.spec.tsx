import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@repo/chat-core/types";
import { MessageItem, type MessageItemProps } from "./message-item";
import { NOBODY_BLOCKED } from "@/tests/block-list";
import {
  resetChatDensityForTests,
  setChatDensity,
} from "@/lib/chat/chat-density";

// Message flags (#3921): a flag a member puts on a message after it is sent.
// In its own file, beside the row's main suite, so the two change apart.

vi.mock("./message-attachments", () => ({
  MessageAttachments: () => <ul data-testid="attachments" />,
}));

const VIEWER = "11111111-1111-4111-8111-111111111111";
const SENDER = "22222222-2222-4222-8222-222222222222";
const FLAGGER = "33333333-3333-4333-8333-333333333333";
const names: Record<string, string> = {
  [SENDER]: "Elias Brandt",
  [FLAGGER]: "Marcus Ellison",
};

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "chan-1",
    sender_id: SENDER,
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
    content: "tailgate starts at 11 in lot C, bring chairs",
    kind: "text",
    payload: null,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    flag: null,
    flagged_by: null,
    flagged_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: new Date(2026, 10, 11, 13, 46).toISOString(),
    client_message_id: "client-1",
    attachment_count: 0,
    mentions: [],
    reactions: {},
    actions: [],
    _status: "confirmed",
    sender_blocked: false,
    _blockEvaluated: true,
    ...overrides,
  } as ChatMessage;
}

function renderRow(overrides: Partial<MessageItemProps> = {}) {
  return render(
    <div role="list">
      <MessageItem
        blockState={NOBODY_BLOCKED}
        message={message()}
        viewerId={VIEWER}
        showHeader
        nameFor={(id) => names[id] ?? null}
        onReact={vi.fn()}
        onUnreact={vi.fn()}
        isTapRevealed={false}
        onToggleTapReveal={vi.fn()}
        {...overrides}
      />
    </div>,
  );
}

const flagged = {
  flag: "important" as const,
  flagged_by: FLAGGER,
  flagged_at: "2026-11-11T14:00:00.000Z",
};

describe("MessageItem flags (#3921)", () => {
  it("tints an Important row in danger red and names who flagged it", () => {
    renderRow({ message: message(flagged) });
    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("data-flag", "important");
    expect(row.className).toContain("bg-destructive-tint");
    expect(row.className).toContain(
      "shadow-[inset_2px_0_0_var(--destructive)]",
    );
    expect(
      screen.getByText("Important · flagged by Marcus Ellison"),
    ).toBeInTheDocument();
  });

  it("draws a lighter flag as a caption only, with no tint", () => {
    renderRow({
      message: message({ ...flagged, flag: "funny", flagged_by: SENDER }),
    });
    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("data-flag", "funny");
    expect(row.className).not.toContain("bg-destructive-tint");
    // The sender's own flag names no one.
    expect(
      screen.getByText("Funny", { selector: ".sr-only" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/flagged by/)).toBeNull();
  });

  it("outranks the mention tint when a row is both", () => {
    renderRow({ message: message({ ...flagged, mentions: [VIEWER] }) });
    const row = screen.getByRole("listitem");
    expect(row.className).toContain("bg-destructive-tint");
    expect(row.className).not.toContain("bg-accent-subtle");
  });

  it("draws no flag on a deleted message", () => {
    renderRow({ message: message({ ...flagged, is_deleted: true }) });
    expect(screen.getByRole("listitem")).not.toHaveAttribute("data-flag");
    expect(screen.queryByText(/Important/)).toBeNull();
  });

  it("drops the name of a flagger the viewer blocked, keeping the flag", () => {
    renderRow({
      message: message(flagged),
      blockState: { ...NOBODY_BLOCKED, ids: new Set([FLAGGER]) },
    });
    expect(screen.getByRole("listitem")).toHaveAttribute(
      "data-flag",
      "important",
    );
    expect(screen.queryByText(/flagged by/)).toBeNull();
  });

  it("flags an unflagged message from the action bar, Important first", async () => {
    const onFlag = vi.fn();
    renderRow({ onFlag });

    await userEvent.click(screen.getByRole("button", { name: "Flag" }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Important",
      "Funny",
      "Interesting",
      "Question",
      "Hype",
      "FYI",
    ]);
    await userEvent.click(items[0]!);

    expect(onFlag).toHaveBeenCalledWith("msg-1", "important");
  });

  it("offers Remove flag to whoever added it", async () => {
    const onFlag = vi.fn();
    renderRow({ onFlag, viewerId: FLAGGER, message: message(flagged) });

    await userEvent.click(screen.getByRole("button", { name: "Flag" }));
    const menu = screen.getByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: /Important.*current flag/ }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(menu).getByRole("menuitem", { name: "Remove flag" }),
    );

    expect(onFlag).toHaveBeenCalledWith("msg-1", null);
  });

  it("offers no Flag control on someone else's flag, unless the viewer is an officer", () => {
    const { unmount } = renderRow({
      onFlag: vi.fn(),
      message: message(flagged),
    });
    expect(screen.queryByRole("button", { name: "Flag" })).toBeNull();
    unmount();

    renderRow({
      onFlag: vi.fn(),
      message: message(flagged),
      canManageChannel: true,
    });
    expect(screen.getByRole("button", { name: "Flag" })).toBeInTheDocument();
  });

  it("offers no Flag control where the surface doesn't wire one", () => {
    renderRow();
    expect(screen.queryByRole("button", { name: "Flag" })).toBeNull();
  });
});

describe("MessageItem flags across densities and states (#3921)", () => {
  afterEach(() => {
    act(() => setChatDensity("cozy"));
    window.localStorage.clear();
    resetChatDensityForTests();
  });

  const captions = (container: HTMLElement) =>
    container.querySelectorAll('[data-slot="message-flag"]').length;

  it.each(["cozy", "compact", "bubbles"] as const)(
    "draws one caption in %s, for text and for a message that is only a file",
    (density) => {
      act(() => setChatDensity(density));
      for (const overrides of [
        {},
        { content: "", attachment_count: 1 },
      ] as Partial<ChatMessage>[]) {
        const { container, unmount } = renderRow({
          message: message({ ...flagged, ...overrides }),
        });
        expect(
          captions(container),
          `${density} ${JSON.stringify(overrides)}`,
        ).toBe(1);
        unmount();
      }
    },
  );

  it("draws the caption above the bubble, not on its fill", () => {
    act(() => setChatDensity("bubbles"));
    const { container } = renderRow({
      message: message({ ...flagged, sender_id: VIEWER }),
    });
    const caption = container.querySelector('[data-slot="message-flag"]');
    expect(caption?.closest(".bg-primary")).toBeNull();
  });

  it("holds the deeper tint on a tapped Important row", () => {
    renderRow({ message: message(flagged), isTapRevealed: true });
    expect(screen.getByRole("listitem").className).toContain(
      "bg-destructive-tint-hover",
    );
    expect(screen.getByRole("listitem").className).not.toContain(
      "bg-surface-1",
    );
  });

  it("reads chapter-accent text on the row in the foreground tone", () => {
    renderRow({ message: message(flagged) });
    expect(screen.getByRole("listitem").className).toContain(
      "[&_.text-primary]:text-foreground",
    );
  });

  it("marks the Flag button on while the message is flagged", () => {
    renderRow({
      onFlag: vi.fn(),
      viewerId: FLAGGER,
      message: message(flagged),
    });
    const flagged_on = screen.getByRole("button", { name: "Flag" }).className;
    renderRow({ onFlag: vi.fn() });
    const buttons = screen.getAllByRole("button", { name: "Flag" });
    expect(flagged_on).not.toEqual(buttons[1]!.className);
  });

  it("offers no Flag control on an imported or audit row", () => {
    for (const kind of ["imported", "system_audit"] as const) {
      const { unmount } = renderRow({
        onFlag: vi.fn(),
        message: message({ kind }),
      });
      expect(screen.queryByRole("button", { name: "Flag" }), kind).toBeNull();
      unmount();
    }
  });
});
