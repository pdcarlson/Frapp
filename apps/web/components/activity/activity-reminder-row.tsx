"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, MessageSquare } from "lucide-react";
import {
  MESSAGE_REMINDER_PRESETS,
  messageReminderPresetTime,
  useClearMessageReminder,
  useSetMessageReminder,
  type ActivityRow,
  type MessageReminderPresetId,
} from "@repo/hooks";
import { Badge } from "@/components/ui/badge";
import { RowMenu, type RowMenuEntry } from "@/components/shared/row-menu";
import { IconButton } from "@/components/ui/icon-button";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { reminderSetDescription } from "@/lib/chat/reminder-copy";
import { useToast } from "@/lib/hooks/use-toast";
import { cn, getErrorMessage } from "@/lib/utils";
import { ActivityRowDetail, ActivityRowLead } from "./activity-row-lead";

type ReminderRow = Extract<ActivityRow, { kind: "reminder" }>;

/**
 * Where the row goes: the message in chat. A thread reply isn't on the
 * channel's timeline, so it goes to the thread's first message, as a link
 * row's "Open in chat" does. A message the member can no longer read (gone,
 * or its channel left) goes nowhere.
 */
export function reminderChatHref(row: ReminderRow): string | null {
  const { reminder } = row;
  if (!reminder.message_available) return null;
  return chatDeepLink({
    channelId: reminder.channel_id,
    messageId: reminder.thread_root_id ?? reminder.message_id,
  });
}

export interface ActivityReminderActions {
  snooze: (
    row: ReminderRow,
    preset: MessageReminderPresetId,
  ) => Promise<unknown>;
  done: (row: ReminderRow) => Promise<unknown>;
}

/**
 * The reminder writes with their toasts. Called by the page, not the row, as
 * the link writes are: Done takes the row off the list at once, which
 * unmounts it, and its toast has to come from something that stays.
 */
export function useActivityReminderActions(): ActivityReminderActions {
  const { toast } = useToast();
  const setReminder = useSetMessageReminder();
  const clearReminder = useClearMessageReminder();
  const failed = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive",
      title,
      description: getErrorMessage(error, "Try again in a moment."),
    });
  return {
    snooze: (row, preset) => {
      const remindAt = messageReminderPresetTime(preset);
      return setReminder
        .mutateAsync({ messageId: row.reminder.message_id, remindAt })
        .then(
          () =>
            toast({
              title: "Snoozed",
              description: reminderSetDescription(remindAt),
            }),
          failed("Couldn't snooze the reminder"),
        );
    },
    done: (row) =>
      clearReminder
        .mutateAsync(row.reminder.message_id)
        .then(
          () => toast({ title: "Marked done", description: row.title }),
          failed("Couldn't clear the reminder"),
        ),
  };
}

/**
 * A reminder the member set on a chat message (#4957, `spec/behavior/activity.md`),
 * Slack's Later list on web. The row opens the message in chat. Done sits on
 * the row, as on a link row and in Slack's Later; Snooze's presets and Open
 * in chat are in the row's menu (⋯, or a right-click).
 */
export function ActivityReminderRow({
  row,
  rowClassName,
  actions,
}: {
  row: ReminderRow;
  rowClassName: string;
  actions: ActivityReminderActions;
}) {
  const router = useRouter();
  const href = reminderChatHref(row);

  const entries: RowMenuEntry[] = [
    { type: "label", key: "snooze-label", label: "Snooze" },
    ...MESSAGE_REMINDER_PRESETS.map((preset): RowMenuEntry => ({
      type: "item",
      key: `snooze-${preset.id}`,
      label: preset.label,
      onSelect: () => void actions.snooze(row, preset.id),
    })),
    ...(href
      ? ([
          { type: "separator", key: "chat-separator" },
          {
            type: "item",
            key: "chat",
            label: "Open in chat",
            icon: MessageSquare,
            onSelect: () => router.push(href),
          },
        ] satisfies RowMenuEntry[])
      : []),
  ];

  const content = (
    <>
      <ActivityRowLead row={row} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {row.title}
        </span>
        <ActivityRowDetail row={row} />
      </span>
      {row.badge ? (
        <Badge variant={row.badge.variant} className="shrink-0">
          {row.badge.label}
        </Badge>
      ) : null}
    </>
  );

  return (
    <RowMenu entries={entries} label={`More for ${row.title}`}>
      {(menuButton) => (
        <li className="group flex items-center gap-1">
          {href ? (
            <Link href={href} className={cn(rowClassName, "min-w-0 flex-1")}>
              {content}
            </Link>
          ) : (
            // Not a link: the message is gone or out of reach, so the row
            // only says what it was, and Done clears it.
            <div
              className={cn(
                rowClassName,
                "min-w-0 flex-1 cursor-default hover:bg-transparent",
              )}
            >
              {content}
            </div>
          )}
          <IconButton
            label={`Done: ${row.title}`}
            title="Done"
            onClick={() => void actions.done(row)}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          {menuButton}
        </li>
      )}
    </RowMenu>
  );
}
