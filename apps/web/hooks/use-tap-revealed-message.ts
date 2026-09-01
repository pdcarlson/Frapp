"use client";

import { useCallback, useState } from "react";
import type { ChatMessage } from "@repo/chat-core/types";

type RevealableMessage = Pick<ChatMessage, "id" | "client_message_id">;

/**
 * Same key basis `MessageTimeline`'s own `computeItemKey` uses (a message's
 * server `id` is not stable across the optimistic → confirmed transition on
 * its own — `client_message_id` is, per `packages/chat-core/src/types.ts`).
 */
export function messageRevealKey(message: RevealableMessage): string {
  return message.client_message_id ?? message.id;
}

/**
 * One reveal id per list — tapping a message row toggles *that* row's action
 * cluster and dismisses any other's (#1193). Shared by `message-timeline.tsx`
 * (virtualized) and `thread-panel.tsx` (a plain array), so the toggle logic
 * and the key derivation above live in one place rather than being
 * hand-rolled in lockstep on both — a mismatch between the two would show up
 * as "the wrong row's cluster stays open," which no compiler or unit test
 * scoped to a single list owner would catch.
 */
export function useTapRevealedMessage() {
  const [revealedId, setRevealedId] = useState<string | null>(null);

  const isRevealed = useCallback(
    (message: RevealableMessage) => revealedId === messageRevealKey(message),
    [revealedId],
  );

  const toggle = useCallback((message: RevealableMessage) => {
    const id = messageRevealKey(message);
    setRevealedId((current) => (current === id ? null : id));
  }, []);

  return { isRevealed, toggle };
}
