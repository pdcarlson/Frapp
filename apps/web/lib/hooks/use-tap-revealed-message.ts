"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChatMessage } from "@repo/chat-core/types";

type RevealableMessage = Pick<ChatMessage, "id" | "client_message_id">;

/**
 * Same key basis `MessageTimeline`'s own `computeItemKey` uses (a message's
 * server `id` is not stable across the optimistic → confirmed transition on
 * its own — `client_message_id` is, per `packages/chat-core/src/types.ts`).
 */
function messageRevealKey(message: RevealableMessage): string {
  return message.client_message_id ?? message.id;
}

/**
 * One reveal id per list — tapping a message row toggles *that* row's action
 * cluster and dismisses any other's (#1193).
 *
 * Its caller is `message-timeline.tsx`. The message-thread panel (#4034)
 * calls it too and hands the result to its timeline (`tapRevealed`), so the
 * parent it draws above the list shares the replies' one reveal id. That is
 * why the toggle logic and the key derivation above are here rather than
 * inline in the list that uses them. Kept
 * as a hook rather than folded back in: the value of "one reveal id per list"
 * is that a second list cannot get it subtly wrong, and the instant a second
 * list exists it needs this, not a copy.
 */
export function useTapRevealedMessage() {
  const [revealedId, setRevealedId] = useState<string | null>(null);

  // A mouse never sets the reveal (`MessageItem`'s `handleRowTap`), so on a
  // touchscreen laptop a mouse press anywhere is the way back out of a row a
  // finger pinned open; otherwise only another finger tap could clear it.
  useEffect(() => {
    if (revealedId === null) return;
    function dismissOnMouse(event: PointerEvent) {
      if (event.pointerType === "mouse") setRevealedId(null);
    }
    document.addEventListener("pointerdown", dismissOnMouse);
    return () => document.removeEventListener("pointerdown", dismissOnMouse);
  }, [revealedId]);

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
