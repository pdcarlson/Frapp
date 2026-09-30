import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CHAT_MESSAGE_KINDS } from "@repo/chat-core/types";
import type { ChatMessage } from "@repo/chat-core/types";
import { isCardMessage } from "@repo/chat-core/message-actions";
import { MessageRenderer } from "./index";

/**
 * `isCardMessage` and the `MessageRenderer` switch are two statements of one
 * fact, and the row believes the first while the screen shows the second. If
 * they disagree, a card's `(edited)` and Pinned markers go into a text body
 * that never renders (and vanish), or a plain message's markers drop under it
 * as if it were a card; and Edit is offered on, or withheld from, the wrong
 * kinds (`canEditMessage` reads the same list). Nothing type-checks the pair.
 *
 * So rather than trusting the docstring's claim that the predicate "mirrors the
 * switch", this renders **every kind the wire contract allows** and checks that
 * a text body appeared exactly when the predicate said it would. A new kind
 * added to `CHAT_MESSAGE_KINDS` and the switch, but not to `CARD_KINDS`, fails
 * here.
 */

vi.mock("@/components/shared/subscription-gate", () => ({
  useSubscriptionGate: () => ({
    allowed: true,
    isPending: false,
    state: { allowed: true },
    isOffline: false,
    noticeId: "notice",
    controlProps: () => ({
      disabled: false,
      title: undefined,
      "aria-describedby": undefined,
    }),
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
        //
        // `useNow` is the one exception: it reaches no client (a plain
        // `useSyncExternalStore` clock, safe to mount here), and stubbing it
        // to the query shape above would silently turn `now` into `NaN` in
        // every card's `closesAt.getTime() < now` / window-open arithmetic
        // instead of a real timestamp.
        if (prop === "useNow") return target[prop as keyof typeof target];
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
    author_name: null,
    author_avatar_path: null,
    author_external_id: null,
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
    attachment_count: 0,
    reactions: {},
    actions: [],
    _status: "confirmed",
    ...overrides,
  } as ChatMessage;
}

/** A plain message's text names itself; a card draws no such slot. */
function hasTextBody(container: HTMLElement): boolean {
  return container.querySelector('[data-slot="message-body"]') !== null;
}

describe("the renderer registry and the layout predicate agree", () => {
  for (const kind of [...CHAT_MESSAGE_KINDS, "some_future_kind"]) {
    it(`${kind}: predicate matches what actually rendered`, () => {
      const { container } = render(
        <MessageRenderer
          message={message(kind)}
          viewerId="11111111-1111-4111-8111-111111111111"
          isConfirmed
          onAct={vi.fn()}
        />,
      );
      expect(hasTextBody(container)).toBe(!isCardMessage(message(kind)));
    });
  }

  it("a deleted message of any kind draws the text placeholder", () => {
    // `MessageRenderer` routes every deleted row to `TextRenderer`, so a
    // deleted card is a placeholder line, not a card frame around nothing.
    for (const kind of CHAT_MESSAGE_KINDS) {
      const { container, unmount } = render(
        <MessageRenderer
          message={message(kind, { is_deleted: true })}
          viewerId="11111111-1111-4111-8111-111111111111"
          isConfirmed
          onAct={vi.fn()}
        />,
      );
      expect(hasTextBody(container), `${kind} deleted`).toBe(true);
      unmount();
    }
  });

});
