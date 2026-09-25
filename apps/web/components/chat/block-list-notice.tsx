"use client";

import { Loader2 } from "lucide-react";
import {
  BLOCK_LIST_WAITING_FOR_NETWORK,
  blockListNotice,
} from "@repo/chat-core/block-copy";
import type { BlockListStatus } from "@repo/validation";
import { cn } from "@/lib/utils";
import { CHIP, CHIP_HIT_AREA } from "./chip";

export interface BlockListNoticeProps {
  status: BlockListStatus;
  heldCount: number;
  onRetry: () => void;
  isRetrying: boolean;
  isPaused: boolean;
}

/**
 * The timeline's report on a block list it could not confirm
 * (`spec/behavior/chat/README.md` § The masking contract: "When the list is
 * unavailable the member is told so"). Rows that arrived by a path the server
 * could not mask are held off the timeline meanwhile, and this is the only
 * place that says so — a silent gap would read as lost messages (#2313).
 *
 * **The live region is always mounted**, and empty until there is something to
 * say, so the notice appearing (or its held count changing) is announced — a
 * region that mounts already populated is not reliably read out.
 *
 * **Retry says when it cannot help.** While the list's read is parked waiting
 * for the network (`isPaused`), a click could not run it any sooner, so the
 * control is replaced by a line saying it retries once the browser is online.
 */
export function BlockListNotice({
  status,
  heldCount,
  onRetry,
  isRetrying,
  isPaused,
}: BlockListNoticeProps) {
  const notice = blockListNotice(status, heldCount);

  return (
    <div role="status" aria-live="polite" className="shrink-0">
      {notice ? (
        <div className="mx-4 mb-2 flex items-center gap-3 rounded-md border border-warning/45 bg-warning/[.13] px-3 py-2 text-[12.5px]">
          <p className="min-w-0 flex-1 text-foreground">
            <span className="font-semibold">{notice.title}. </span>
            <span className="text-muted-foreground">{notice.body}</span>
          </p>
          {notice.canRetry ? (
            isPaused ? (
              <span className="shrink-0 text-muted-foreground">
                {BLOCK_LIST_WAITING_FOR_NETWORK}
              </span>
            ) : (
              <button
                type="button"
                className={cn(CHIP.base, CHIP.neutral, CHIP_HIT_AREA, "gap-1")}
                aria-label="Retry loading your block list"
                disabled={isRetrying}
                aria-busy={isRetrying}
                onClick={onRetry}
              >
                {isRetrying ? (
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                Retry
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
