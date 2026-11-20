"use client";

import { useEffect, useId, useState } from "react";
import {
  useComingUpPostReview,
  useMemberDisplayNames,
  useTrackComingUpDates,
} from "@repo/hooks";
import {
  COMING_UP_REVIEW_COPY,
  type ComingUpReviewRow,
  type MeetingContent,
} from "@repo/validation";
import { dashboardTableCheckboxClassName } from "@/components/shared/table-controls";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/lib/hooks/use-toast";

/**
 * The review that follows Post (#5672 step 3; Paul picked "Review at Post",
 * 2026-11-19): once minutes are posted, the poster sees what each Coming up
 * date still needs, a task for the member the minutes say owns it or for
 * the poster, every one ticked for them to untick, and the dates already on
 * the calendar, and makes what they leave ticked in one press, as Fireflies,
 * Granola and Otter review a call's action items before they reach a
 * tracker. The minutes post first, with no question (Paul, 2026-11-16), so
 * a review closed or failed never holds them back. The host mounts it once
 * the minutes post. The phone's `coming-up-post-review.tsx` offers the same
 * lines, in the same order and words.
 */
export function ComingUpPostReview({
  meetingId,
  content,
  viewerId,
  onDone,
}: {
  meetingId: string;
  content: Pick<MeetingContent, "dates" | "action_items">;
  viewerId: string | null;
  /** The review closed, or had nothing to offer. The host unmounts it. */
  onDone: () => void;
}) {
  const ids = useId();
  const { toast } = useToast();
  const names = useMemberDisplayNames();
  const offered = useComingUpPostReview(meetingId, content, true);
  const track = useTrackComingUpDates();
  // The lines as they first read: making a task changes what tracks a date,
  // and the list must not move under the poster's hand.
  const [rows, setRows] = useState<ComingUpReviewRow[] | null>(null);
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const needed = !!viewerId && !!offered?.some((row) => row.kind === "task");
  if (rows === null && offered && needed) {
    setRows(offered);
    setTicked(
      new Set(offered.filter((row) => row.checked).map((row) => row.index)),
    );
  }
  // Nothing to review: no date needs a task, or the poster can't make one.
  // Judged once, before the lines freeze: the tasks Track makes refetch what
  // `offered` reads, and must not close the review under the poster.
  useEffect(() => {
    if (rows === null && offered && !needed) onDone();
  }, [rows, offered, needed, onDone]);

  const chosen = (rows ?? []).filter(
    (row) => row.kind === "task" && ticked.has(row.index),
  );

  async function save() {
    if (!viewerId) return;
    const { made, failed } = await track.mutateAsync({
      rows: chosen,
      viewerId,
    });
    if (made > 0) toast({ title: COMING_UP_REVIEW_COPY.made(made) });
    if (failed > 0) {
      toast({
        title: COMING_UP_REVIEW_COPY.failed(failed),
        description: COMING_UP_REVIEW_COPY.failedDetail,
        variant: "destructive",
      });
    }
    onDone();
  }

  function whose(row: ComingUpReviewRow): string | null {
    if (!row.assigneeId || row.assigneeId === viewerId) return null;
    return names.nameFor(row.assigneeId) ?? null;
  }

  return (
    <Dialog
      open={rows !== null}
      onOpenChange={(next) => !next && !track.isPending && onDone()}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{COMING_UP_REVIEW_COPY.title}</DialogTitle>
          <DialogDescription>
            {COMING_UP_REVIEW_COPY.description}
          </DialogDescription>
        </DialogHeader>
        <ul
          role="list"
          aria-label={COMING_UP_REVIEW_COPY.title}
          className="grid max-h-80 gap-0.5 overflow-y-auto"
        >
          {(rows ?? []).map((row) =>
            row.kind === "task" ? (
              <li key={row.index}>
                <label
                  htmlFor={`${ids}-${row.index}`}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-2 hover:bg-card-hover"
                >
                  <input
                    id={`${ids}-${row.index}`}
                    type="checkbox"
                    checked={ticked.has(row.index)}
                    disabled={track.isPending}
                    onChange={() =>
                      setTicked((current) => {
                        const next = new Set(current);
                        if (next.has(row.index)) next.delete(row.index);
                        else next.add(row.index);
                        return next;
                      })
                    }
                    className={`mt-0.5 ${dashboardTableCheckboxClassName}`}
                  />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="text-sm font-medium">
                      {COMING_UP_REVIEW_COPY.taskFor(whose(row))}
                    </span>
                    <span className="break-words text-caption text-muted-foreground">
                      {COMING_UP_REVIEW_COPY.due(row.title, row.date)}
                    </span>
                  </span>
                </label>
              </li>
            ) : (
              <li
                key={row.index}
                className="grid gap-0.5 px-2 py-2 pl-[2.125rem]"
              >
                <span className="text-sm font-medium text-muted-foreground">
                  {COMING_UP_REVIEW_COPY.onCalendar}
                </span>
                <span className="break-words text-caption text-muted-foreground">
                  {COMING_UP_REVIEW_COPY.onCalendarDetail(row.title, row.date)}
                </span>
              </li>
            ),
          )}
        </ul>
        <DialogFooter>
          <Button variant="ghost" disabled={track.isPending} onClick={onDone}>
            {COMING_UP_REVIEW_COPY.skip}
          </Button>
          <Button
            disabled={track.isPending || chosen.length === 0}
            onClick={() => void save()}
          >
            {COMING_UP_REVIEW_COPY.track(chosen.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
