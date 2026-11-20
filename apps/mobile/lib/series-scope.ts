import { openItemMenu } from "@/components/item-actions-menu";

/**
 * Calendar's question for a repeating item, in the glass menu every other
 * choice opens (owner, 2026-11-20: one menu system): "This event only" / "All
 * upcoming events" on an event (#3662), "This task only" / "All upcoming
 * tasks" on a copy of a repeating task (#5119), in the words
 * `@repo/validation` keeps for both apps (`SERIES_SCOPE_COPY`,
 * `TASK_SERIES_SCOPE_COPY`). Resolves `null` on a dismiss.
 */
export function askSeriesScope(copy: {
  title: string;
  message: string;
  /** The one-item answer's label. */
  thisOne: string;
  /** The every-upcoming answer's label. */
  allUpcoming: string;
  /** Red answers, for a delete: both remove something. */
  destructive?: boolean;
  /** Only the every-upcoming answer red (an event's delete). */
  seriesDestructive?: boolean;
}): Promise<"instance" | "series" | null> {
  return new Promise((resolve) => {
    openItemMenu({
      title: copy.title,
      message: copy.message,
      actions: [
        {
          key: "instance",
          label: copy.thisOne,
          destructive: copy.destructive === true,
          run: () => resolve("instance"),
        },
        {
          key: "series",
          label: copy.allUpcoming,
          destructive:
            copy.destructive === true || copy.seriesDestructive === true,
          run: () => resolve("series"),
        },
      ],
      onDismiss: () => resolve(null),
    });
  });
}
