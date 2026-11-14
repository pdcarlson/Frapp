"use client";

import { AlarmClock, AlarmClockOff } from "lucide-react";
import {
  activityRowSnoozable,
  activitySnoozeOptions,
  useActivitySnooze,
  type ActivityRow,
} from "@repo/hooks";
import type { RowMenuEntry } from "@/components/shared/row-menu";
import { ToastAction } from "@/components/ui/toast";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";

/** What a row's menu needs to snooze it, or wake it from Snoozed. */
export interface ActivitySnoozeActions {
  /**
   * The menu entries that snooze `row`, one per time (`activitySnoozeOptions`);
   * none for a row in Waiting on others.
   */
  entriesFor: (row: ActivityRow) => RowMenuEntry[];
  /** The entry that brings a snoozed row back now. */
  wakeEntry: (row: ActivityRow) => RowMenuEntry;
}

/**
 * Snooze on `/activity` (#4982, `spec/behavior/activity.md` § Snooze): each
 * row's menu offers Gmail's fixed times, and the row leaves the list at once
 * with "Snoozed until … · Undo", as Gmail's toast does. Called by the page,
 * not the row, for the reason `useActivityLinkActions` gives: the row
 * unmounts as it leaves, and its toast must come from something that stays.
 */
export function useActivitySnoozeActions(): ActivitySnoozeActions {
  const { toast } = useToast();
  const { snooze, unsnooze } = useActivitySnooze();

  const failed = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive",
      title,
      description: getErrorMessage(error, "Try again in a moment."),
    });

  return {
    entriesFor: (row) => {
      // Waiting on others waits on someone else: nothing to put off.
      if (!activityRowSnoozable(row)) return [];
      // Built on each render, which the page's 30-second clock drives, so
      // "Later today" leaves the menu once the evening is under an hour off.
      const options = activitySnoozeOptions(new Date());
      return [
        { type: "label", key: "snooze-label", label: "Snooze until" },
        ...options.map((option): RowMenuEntry => ({
          type: "item",
          key: `snooze-${option.id}`,
          label: option.menuLabel,
          icon: AlarmClock,
          onSelect: () =>
            void snooze(row.readRef, option.until).then(
              () =>
                toast({
                  title: `Snoozed until ${option.hint}`,
                  description: row.title,
                  action: (
                    <ToastAction
                      altText="Undo snooze"
                      onClick={() =>
                        void unsnooze(row.readRef).catch(
                          failed("Couldn't undo"),
                        )
                      }
                    >
                      Undo
                    </ToastAction>
                  ),
                }),
              failed("Couldn't snooze it"),
            ),
        })),
      ];
    },
    wakeEntry: (row) => ({
      type: "item",
      key: "unsnooze",
      label: "Unsnooze",
      icon: AlarmClockOff,
      onSelect: () =>
        void unsnooze(row.readRef).catch(failed("Couldn't unsnooze it")),
    }),
  };
}
