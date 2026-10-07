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
 * cluster and dismisses any other's (#1193).
 *
 * It has one caller today, `message-timeline.tsx`; it had two until #2142
 * deleted `thread-panel.tsx`, which is why the toggle logic and the key
 * derivation above are here rather than inline in the list that uses them. Kept
 * as a hook rather than folded back in: the value of "one reveal id per list"
 * is that a second list cannot get it subtly wrong, and the instant a second
 * list exists it needs this, not a copy.
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
