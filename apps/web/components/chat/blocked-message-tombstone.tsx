"use client";

import { Loader2 } from "lucide-react";
import {
  TOMBSTONE_STALE_TEXT,
  TOMBSTONE_TEXT,
} from "@repo/chat-core/block-copy";
import type { MaskedRefreshState } from "@repo/chat-core/blocks";
import { cn } from "@/lib/utils";
import { CHIP, CHIP_HIT_AREA } from "./chip";

export interface BlockedMessageTombstoneProps {
  /** Only in the controls' accessible names; never drawn. */
  senderName: string | null;
  /**
   * `false` only when this client confirmed unblocking the sender and this row
   * is still the server's masked copy (older than the page the unblock
   * re-read). There is nothing to unblock, so the control is withheld rather
   * than left dead (`tombstoneCanUnblock`).
   */
  canUnblock: boolean;
  onUnblock: () => void;
  /**
   * The sender's post-unblock re-read, when `canUnblock` is `false`: `failed`
   * offers Reload, `refreshing` shows it busy, and `null` offers nothing.
   */
  reload: MaskedRefreshState | null;
  onReload: () => void;
  /** Top padding follows the timeline's grouping, like any other row. */
  showHeader: boolean;
}

/**
 * What the timeline draws in place of a message from a member the viewer
 * blocked (`spec/behavior/chat/README.md` § What a block does and does not
 * hide), on the cold read and on the Realtime echo alike (#2313).
 *
 * **Takes no message.** Only the fact of a hidden message reaches this
 * component — never its body, author, avatar, attachments, reactions or card
 * payload — so no later edit here can start rendering what the block hides.
 * Not mounting `MessageAttachments` is also what stops an echoed row's files
 * from being fetched: the attachments route answers a blocked sender's message
 * as it does a deleted one (#2324), and the fetch would paint an error line.
 *
 * **Unblock is the only action** — no "show anyway" (owner decision
 * 2026-09-22): a server-masked row arrives with its content already withheld,
 * so expand could only ever work on the rows that happened to arrive live.
 * After an unblock this client confirmed, a leftover masked copy offers Reload
 * only if the re-read that would restore it failed.
 *
 * Drawn in the incoming lane with the avatar gutter held open, as an outline
 * with no fill, so it reads as the absence of a message rather than as one.
 */
export function BlockedMessageTombstone({
  senderName,
  canUnblock,
  onUnblock,
  reload,
  onReload,
  showHeader,
}: BlockedMessageTombstoneProps) {
  const hiddenFrom = senderName
    ? `hidden messages from ${senderName}`
    : "hidden messages";

  return (
    <div
      role="listitem"
      className={cn("flex gap-2.5 px-5 pb-1", showHeader ? "pt-4" : "pt-1")}
      data-blocked="true"
    >
      <div className="w-8 shrink-0" />
      <div className="flex min-w-0 max-w-[86%] items-center gap-3 rounded-[18px] rounded-bl-[6px] border border-border px-4 py-2">
        <p className="min-w-0 text-[12.5px] italic text-muted-foreground">
          {canUnblock ? TOMBSTONE_TEXT : TOMBSTONE_STALE_TEXT}
        </p>
        {canUnblock ? (
          <button
            type="button"
            className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA)}
            aria-label={
              senderName ? `Unblock ${senderName}` : "Unblock this member"
            }
            onClick={onUnblock}
          >
            Unblock
          </button>
        ) : reload === "refreshing" ? (
          <span role="status" className="inline-flex">
            <Loader2
              className="h-3.5 w-3.5 animate-spin text-muted-foreground"
              aria-hidden="true"
            />
            <span className="sr-only">{`Reloading ${hiddenFrom}`}</span>
          </span>
        ) : reload === "failed" ? (
          <button
            type="button"
            className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA)}
            aria-label={`Reload ${hiddenFrom}`}
            onClick={onReload}
          >
            Reload
          </button>
        ) : null}
      </div>
    </div>
  );
}
