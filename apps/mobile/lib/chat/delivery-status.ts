/**
 * Exhaustive presentation of `ChatMessage._status` for the mobile thread.
 *
 * Lives in `lib/` so it can carry a spec — a `*.spec.ts` next to a screen
 * under `app/` is bundled by expo-router (see `channel-list.ts`).
 *
 * #1910: `MessageStatus` grew `unconfirmed` (and `recorded`) and mobile's
 * non-exhaustive `_status` chains treated every unknown as sent. A lost write
 * that looks delivered is the worst available presentation. This switch is
 * the compile-error site: widening the union without a new case fails
 * `tsc --noEmit` in `apps/mobile` rather than falling through.
 *
 * `failed` and `unconfirmed` are not interchangeable — see the `MessageStatus`
 * docblock in `@repo/chat-core/types`. Discard is a ledger-safety ban on
 * `unconfirmed`/`recorded`, not a styling choice. Mobile has no slash
 * dispatcher (`use-chat-channel.ts`), so there is no safe replay path:
 * `unconfirmed` is shown read-only (no Retry) until one exists. Do not invent
 * a slash dispatch or a discard control here.
 *
 * Copy for the two terminal notes is mirrored from web
 * `apps/web/components/chat/message-item.tsx` so the surfaces cannot drift.
 */

import type { ChatMessage, MessageStatus } from "@repo/chat-core/types";

/** Fallback when the row carries no `_error`. Web's unconfirmed note. */
export const UNCONFIRMED_NOTE = "Not confirmed";

/** Fallback when the row carries no `_error`. Web's recorded note. */
export const RECORDED_NOTE =
  "Recorded — the chat card didn't post. Don't run this command again.";

/**
 * Discriminated chrome for one row. `status` is `MessageStatus` itself, so a
 * UI `switch` on `chrome.status` is also exhaustive — two compile-error
 * sites, not one helper the renderers can ignore.
 */
export type DeliveryChrome =
  | { status: "pending" }
  | { status: "confirmed" }
  | { status: "failed"; error: string }
  | { status: "unconfirmed"; note: string }
  | { status: "recorded"; note: string };

export function deliveryChrome(
  message: Pick<ChatMessage, "_status" | "_error">,
): DeliveryChrome {
  const status: MessageStatus = message._status;
  switch (status) {
    case "pending":
      return { status: "pending" };
    case "confirmed":
      return { status: "confirmed" };
    case "failed":
      return { status: "failed", error: message._error ?? "Send failed" };
    case "unconfirmed":
      return {
        status: "unconfirmed",
        note: message._error ?? UNCONFIRMED_NOTE,
      };
    case "recorded":
      return {
        status: "recorded",
        note: message._error ?? RECORDED_NOTE,
      };
    default: {
      const _never: never = status;
      return _never;
    }
  }
}
