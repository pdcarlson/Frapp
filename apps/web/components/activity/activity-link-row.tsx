"use client";

import { useRouter } from "next/navigation";
import {
  Check,
  EyeOff,
  ExternalLink,
  MessageSquare,
  Trash2,
} from "lucide-react";
import {
  useClearActivityLinkState,
  useRemoveActivityLink,
  useRestoreActivityLink,
  useSetActivityLinkState,
  type ActivityRow,
} from "@repo/hooks";
import { RowMenu, type RowMenuEntry } from "@/components/shared/row-menu";
import { IconButton } from "@/components/ui/icon-button";
import { ToastAction } from "@/components/ui/toast";
import { chatDeepLink } from "@/lib/chat/chat-links";
import { useToast } from "@/lib/hooks/use-toast";
import { cn, getErrorMessage } from "@/lib/utils";

type LinkRow = Extract<ActivityRow, { kind: "link" }>;

/**
 * Where "Open in chat" goes: the message the link was posted in. A thread
 * reply isn't on the channel's timeline, so it goes to the thread's first
 * message, where the thread opens from.
 */
export function linkChatHref(row: LinkRow): string {
  return chatDeepLink({
    channelId: row.link.channel_id,
    messageId: row.link.thread_root_id ?? row.link.message_id,
  });
}

/**
 * A sign-up link on `/activity` (#3897, `spec/behavior/activity.md` § Links).
 *
 * The row is the link itself: it opens the form in a new tab, the way a link
 * in chat does. Done sits on the row, as GitHub's notifications and Slack's
 * Later put their check, because it is what a member does after filling one
 * in. The rest is in the row's menu (⋯, or a right-click off the link): Hide
 * ("Not chapter business"), Open in chat, and for an officer
 * (`channels:manage`) Remove, which takes it off everyone's Activity. Each
 * takes the row away at once and offers Undo, since none of them can be seen
 * again from this page.
 */
export interface ActivityLinkActions {
  done: (row: LinkRow) => void;
  hide: (row: LinkRow) => void;
  remove: (row: LinkRow) => void;
}

/**
 * The link writes with their toasts. Called by the page, not the row: each
 * write takes the row off the list at once (optimistically), which unmounts
 * it, and a write's callbacks die with the component that started it, so
 * the "Marked done · Undo" toast has to come from something that stays.
 */
export function useActivityLinkActions(): ActivityLinkActions {
  const { toast } = useToast();
  const markDone = useSetActivityLinkState("done");
  const hide = useSetActivityLinkState("hidden");
  const clearState = useClearActivityLinkState();
  const remove = useRemoveActivityLink();
  const restore = useRestoreActivityLink();

  const failed = (title: string) => (error: unknown) =>
    toast({
      variant: "destructive",
      title,
      description: getErrorMessage(error, "Try again in a moment."),
    });

  const act = (
    write: {
      mutate: (
        id: string,
        options: { onSuccess: () => void; onError: (error: unknown) => void },
      ) => void;
    },
    row: LinkRow,
    title: string,
    undo: {
      mutate: (
        id: string,
        options: { onError: (error: unknown) => void },
      ) => void;
    },
    failure: string,
  ) =>
    write.mutate(row.link.id, {
      onSuccess: () =>
        toast({
          title,
          description: row.title,
          action: (
            <ToastAction
              altText={`Undo: ${title}`}
              onClick={() =>
                undo.mutate(row.link.id, { onError: failed("Couldn't undo") })
              }
            >
              Undo
            </ToastAction>
          ),
        }),
      onError: failed(failure),
    });

  return {
    done: (row) =>
      act(
        markDone,
        row,
        "Marked done",
        clearState,
        "Couldn't mark the link done",
      ),
    hide: (row) =>
      act(hide, row, "Hidden", clearState, "Couldn't hide the link"),
    remove: (row) =>
      act(
        remove,
        row,
        "Removed from everyone's Activity",
        restore,
        "Couldn't remove the link",
      ),
  };
}

export function ActivityLinkRow({
  row,
  rowClassName,
  canRemove,
  actions,
}: {
  row: LinkRow;
  rowClassName: string;
  canRemove: boolean;
  actions: ActivityLinkActions;
}) {
  const router = useRouter();
  const { link } = row;

  const entries: RowMenuEntry[] = [
    {
      type: "item",
      key: "hide",
      label: "Hide: not chapter business",
      icon: EyeOff,
      onSelect: () => actions.hide(row),
    },
    {
      type: "item",
      key: "chat",
      label: "Open in chat",
      icon: MessageSquare,
      onSelect: () => router.push(linkChatHref(row)),
    },
    ...(canRemove
      ? ([
          { type: "separator", key: "officer" },
          {
            type: "item",
            key: "remove",
            label: "Remove for everyone",
            icon: Trash2,
            destructive: true,
            onSelect: () => actions.remove(row),
          },
        ] satisfies RowMenuEntry[])
      : []),
  ];

  return (
    <RowMenu entries={entries} label={`More for ${row.title}`}>
      {(menuButton) => (
        <li className="group flex items-center gap-1">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            title={link.url}
            className={cn(rowClassName, "min-w-0 flex-1")}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">
                {row.title}
                <span className="sr-only"> (opens in a new tab)</span>
              </span>
              {row.detail ? (
                <span className="block truncate text-caption text-muted-foreground">
                  {row.detail}
                </span>
              ) : null}
            </span>
            <ExternalLink
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </a>
          <IconButton
            label={`Done: ${row.title}`}
            title="I filled it in"
            onClick={() => actions.done(row)}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
          </IconButton>
          {menuButton}
        </li>
      )}
    </RowMenu>
  );
}
