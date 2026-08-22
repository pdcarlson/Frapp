import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CHAT_MESSAGE_KINDS } from "@repo/chat-core/types";
import type { ChatMessage } from "@repo/chat-core/types";
import { MessageRenderer, rendersAsBubble } from "./index";

/**
 * `rendersAsBubble` and the `MessageRenderer` switch are two statements of one
 * fact, and the row layout believes the first while the screen shows the second.
 * If they disagree, a card renders inside the right-aligned self-bubble column —
 * silently, because nothing type-checks the pair.
 *
 * So rather than trusting the docstring's claim that the predicate "mirrors the
 * switch", this renders **every kind the wire contract allows** and checks that
 * a bubble appeared exactly when the predicate said one would. A new kind added
 * to `CHAT_MESSAGE_KINDS` and the switch, but not to `CARD_KINDS`, fails here.
 */

vi.mock("@/components/shared/subscription-gate", () => ({
  useSubscriptionGate: () => ({
    allowed: true,
    isPending: false,
    state: { allowed: true },
    noticeId: "notice",
    controlProps: () => ({ disabled: false, "aria-describedby": undefined }),
    noticeRef: { current: null },
  }),
  SubscriptionNotice: () => null,
}));

/*
 * Spread the real module rather than replacing it: a hand-listed mock has to be
 * re-listed every time a card reaches for one more hook, and the failure mode is
 * an unrelated test breaking with "No export is defined on the mock". Only the
 * hooks that would hit the network are stubbed.
 */
vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const query = { data: undefined, isPending: false, isError: false };
  const mutation = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  return new Proxy(
    { ...actual },
    {
      get(target, prop: string) {
        // Every hook is stubbed — the real ones need the client provider this
        // test deliberately does not mount. Plain helpers pass through.
        if (prop.startsWith("use")) {
          return () =>
            /^use(Update|Confirm|Reject|Check|Create|Delete|Mark|Send|Request|Upload)/.test(prop)
              ? mutation
              : query;
        }
        return target[prop as keyof typeof target];
      },
    },
  );
});

function message(kind: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${kind}`,
    channel_id: "chan-1",
    sender_id: "11111111-1111-4111-8111-111111111111",
    content: "hello",
    kind,
    payload: null,
    reply_to_id: null,
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: new Date(2026, 7, 16, 17, 9).toISOString(),
    client_message_id: `client-${kind}`,
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  } as ChatMessage;
}

/** The bubble is the only thing in the tree carrying the locked 18px radius. */
function hasBubble(container: HTMLElement): boolean {
  return container.querySelector('[class*="rounded-[18px]"]') !== null;
}

describe("the renderer registry and the layout predicate agree", () => {
  for (const kind of [...CHAT_MESSAGE_KINDS, "some_future_kind"]) {
    it(`${kind}: predicate matches what actually rendered`, () => {
      const { container } = render(
        <MessageRenderer
          message={message(kind)}
          viewerId="11111111-1111-4111-8111-111111111111"
          isSelf
          isConfirmed
          onAct={vi.fn()}
        />,
      );
      expect(hasBubble(container)).toBe(rendersAsBubble(message(kind)));
    });
  }

  it("a deleted message keeps the layout its kind had", () => {
    // Deleting must not move a row across the thread: the body becomes a
    // tombstone, the row does not change columns.
    for (const kind of CHAT_MESSAGE_KINDS) {
      expect(
        rendersAsBubble(message(kind, { is_deleted: true })),
        `${kind} deleted`,
      ).toBe(rendersAsBubble(message(kind)));
    }
  });
});
