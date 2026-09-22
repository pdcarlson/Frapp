"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  memberFallbackLabel,
  resolveAuthorLabel,
  useChatReports,
  useMemberDisplayNames,
  useNow,
  useRemoveReportedMessage,
  useResolveChatReport,
} from "@repo/hooks";
import type { ChatReport, ChatReportStatus } from "@repo/hooks";
import { serverMessageOf } from "@repo/api-sdk";
import { formatLocaleDateTime } from "@repo/formatting";
import { CHAT_REPORT_QUEUE_PERMISSIONS } from "@repo/validation";
import { Can } from "@/components/shared/can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  anyReadUncached,
  PermissionsOfflineSurface,
} from "@/components/shared/async-states";
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
  NestedOffline,
} from "@/components/shared/nested-states";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/hooks/use-toast";
import {
  CHAT_REPORT_REASON_LABEL,
  CHAT_REPORT_TABS,
  chatReportActionLabel,
  chatReportCopy as copy,
  reportAge,
  reportedMessageSubject,
} from "./chat-report-copy";
import type { ChatReportTab } from "./chat-report-copy";

/**
 * The officer report queue (#2257) and its one destructive action (#2311).
 *
 * Contract: `spec/behavior/chat/README.md` § Report and block. Three rules from
 * it shape this card more than anything visual:
 *
 * - **It shows the evidence, not the conversation.** Each row is the report's
 *   own snapshot (`reported_content`, `reported_sender_id` /
 *   `reported_author_name`), never a read of the message or its channel — a
 *   report about a DM does not open the DM, and nothing here links into one.
 * - **It never names the reporter.** The API strips `reporter_user_id` on every
 *   exit; `details` is the reporter's note, not their identity.
 * - **Remove takes the report, not the message.** `useRemoveReportedMessage`
 *   posts the report id alone, and the control only exists on an open report
 *   whose message is still there; a row whose message is gone offers Mark
 *   actioned instead. The server is idempotent on the message, so "already
 *   removed" is a success the card reports as such, never an error that blames
 *   anyone for it.
 *
 * The gate is `CHAT_REPORT_QUEUE_PERMISSIONS` (`@repo/validation`) —
 * `members:view` **and** `channels:manage`, the route's full requirement
 * (`ChatReportController`: the class floor plus the handler), not just the
 * page's `channels:manage`. A custom role can hold one without the other, and
 * without this gate that officer would get a Retry that can only ever 403.
 *
 * The routes are `@SubscriptionExempt()` (member safety has no billing
 * exception), so the writes here are not subscription-gated — only disabled
 * offline, where a queueless write cannot land.
 */
export function ChatReportsCard() {
  return (
    <Can
      allOf={CHAT_REPORT_QUEUE_PERMISSIONS}
      deniedFallback={
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{copy.title}</CardTitle>
            <CardDescription>{copy.deniedDescription}</CardDescription>
          </CardHeader>
        </Card>
      }
      offlineFallback={(retry) => (
        <PermissionsOfflineSurface
          description="Reconnect to check whether you can review reported messages."
          onRetry={retry}
        />
      )}
    >
      <ChatReportsQueue />
    </Can>
  );
}

type RowAction = "reviewed" | "dismissed" | "actioned" | "remove";
type Resolution = Exclude<RowAction, "remove">;

const FAILED_TOAST: Record<Resolution, string> = {
  reviewed: copy.toast.reviewedFailed,
  dismissed: copy.toast.dismissedFailed,
  actioned: copy.toast.actionedFailed,
};

function ChatReportsQueue() {
  const [status, setStatus] = useState<ChatReportStatus>("open");
  const { confirm, confirmDialog } = useConfirmDialog();
  const { toast } = useToast();
  const resolve = useResolveChatReport();
  const remove = useRemoveReportedMessage();

  // Per row, so acting on one report leaves the others live; the shared
  // mutation's own `isPending` / `variables` describe only the latest call.
  // **Held here, above the tabs, and so are the handlers that set it.** Radix
  // unmounts an inactive panel, so state kept in the list would be dropped by a
  // tab switch mid-write and the row would come back with live buttons while
  // its write was still in flight — a second click on a write the first has
  // not finished.
  const [busy, setBusy] = useState<Readonly<Record<string, RowAction>>>({});

  function markBusy(id: string, action: RowAction | null) {
    setBusy((current) => {
      const next = { ...current };
      if (action) next[id] = action;
      else delete next[id];
      return next;
    });
  }

  async function handleResolve(report: ChatReport, next: Resolution) {
    markBusy(report.id, next);
    try {
      await resolve.mutateAsync({ id: report.id, status: next });
      toast({ description: copy.toast[next] });
    } catch (error) {
      toast({
        variant: "destructive",
        description: serverMessageOf(error) ?? FAILED_TOAST[next],
      });
    } finally {
      markBusy(report.id, null);
    }
  }

  async function handleRemove(report: ChatReport, author: string) {
    const confirmed = await confirm({
      title: copy.removeConfirm.title(author),
      description: copy.removeConfirm.description(report.reported_content),
      confirmLabel: copy.removeConfirm.confirmLabel,
    });
    if (!confirmed) return;
    markBusy(report.id, "remove");
    try {
      const result = await remove.mutateAsync(report.id);
      toast({
        description: result.message_already_deleted
          ? copy.toast.alreadyRemoved
          : copy.toast.removed,
      });
    } catch (error) {
      // Whatever the server says, in its words — a 409 here means the report
      // changed since it loaded (another officer resolved it, or its message
      // was hard-deleted), and the queue refetches either way. No status is
      // translated into a claim about who did what.
      toast({
        variant: "destructive",
        description: serverMessageOf(error) ?? copy.toast.removeFailed,
      });
    } finally {
      markBusy(report.id, null);
    }
  }

  return (
    <Card>
      {confirmDialog}
      <CardHeader>
        <CardTitle className="text-lg">{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs
          value={status}
          onValueChange={(next) => setStatus(next as ChatReportStatus)}
        >
          {/*
            Four labels plus the primitive's 24px gaps run past a 375px card,
            so the rail scrolls in its own box rather than pushing the page
            (the `test:floor` rule). The wrapper scrolls, not the list: the
            active underline sits on the list's own hairline, and a scrolling
            list would clip it.
          */}
          <div className="overflow-x-auto">
            <TabsList className="min-w-max" aria-label="Report status">
              {CHAT_REPORT_TABS.map((tab) => (
                <TabsTrigger key={tab.status} value={tab.status}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {CHAT_REPORT_TABS.map((tab) => (
            <TabsContent key={tab.status} value={tab.status}>
              {/* Radix unmounts inactive panels, so one slice is read at a time. */}
              <ReportList
                tab={tab}
                busy={busy}
                onResolve={(report, next) => void handleResolve(report, next)}
                onRemove={(report, author) => void handleRemove(report, author)}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function ReportList({
  tab,
  busy,
  onResolve,
  onRemove,
}: {
  tab: ChatReportTab;
  busy: Readonly<Record<string, RowAction>>;
  onResolve: (report: ChatReport, next: Resolution) => void;
  onRemove: (report: ChatReport, author: string) => void;
}) {
  const query = useChatReports(tab.status);
  const { isOffline } = useNetwork();
  const { nameFor } = useMemberDisplayNames();
  const now = useNow();

  const paused = query.isPending && query.fetchStatus === "paused";
  if ((isOffline && anyReadUncached(query)) || paused) {
    return (
      <NestedOffline
        title={copy.offlineTitle}
        description={copy.offlineDescription}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (query.isLoading) {
    return <NestedLoading message={copy.loading} />;
  }
  // `data === undefined`, not `isError` alone: a failed *background* refetch
  // keeps the rows v5 already holds, and a queue an officer is mid-way through
  // should not vanish behind an error over a stale-while-revalidate miss.
  if (query.isError && query.data === undefined) {
    return (
      <NestedError
        title={copy.errorTitle}
        description={copy.errorDescription}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (query.isPending) {
    // Disabled, not loading (design-system README §4): no chapter to read.
    return (
      <NestedEmpty
        title={copy.noChapterTitle}
        description={copy.noChapterDescription}
      />
    );
  }

  const reports = query.data ?? [];
  if (reports.length === 0) {
    return (
      <NestedEmpty title={tab.emptyTitle} description={tab.emptyDescription} />
    );
  }

  return (
    <div className="space-y-3">
      {tab.status === "open" ? (
        <p className="text-xs text-muted-foreground">{copy.openHint}</p>
      ) : null}
      <ul className="space-y-3" aria-label={`${tab.label} reports`}>
        {reports.map((report) => (
          <ReportRow
            key={report.id}
            report={report}
            tab={tab}
            now={now}
            nameFor={nameFor}
            busy={busy[report.id] ?? null}
            offline={isOffline}
            onResolve={(next) => onResolve(report, next)}
            onRemove={(author) => onRemove(report, author)}
          />
        ))}
      </ul>
    </div>
  );
}

function ReportRow({
  report,
  tab,
  now,
  nameFor,
  busy,
  offline,
  onResolve,
  onRemove,
}: {
  report: ChatReport;
  tab: ChatReportTab;
  now: number;
  nameFor: (userId: string) => string | null;
  busy: RowAction | null;
  offline: boolean;
  onResolve: (next: Resolution) => void;
  onRemove: (author: string) => void;
}) {
  const author = resolveAuthorLabel(
    {
      sender_id: report.reported_sender_id,
      author_name: report.reported_author_name,
    },
    nameFor,
    null,
  );
  const isOpen = report.status === "open";
  // Hard-deleted (a channel delete, or the import purge): nothing to remove,
  // and the server refuses a removal on it. Mark actioned closes it instead.
  const messageGone = report.message_id === null;
  const disabled = busy !== null || offline;
  const disabledTitle = offline ? copy.offlineWrite : undefined;
  const content = report.reported_content?.trim();
  const subject = reportedMessageSubject(author, report.reported_content);

  return (
    <li
      className="space-y-3 rounded-lg border border-border p-3"
      aria-busy={busy !== null || undefined}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words text-sm font-semibold text-foreground">
          {author}
        </span>
        <Badge variant="outline">
          {CHAT_REPORT_REASON_LABEL[report.reason]}
        </Badge>
        <time
          className="ml-auto text-xs text-muted-foreground"
          dateTime={report.created_at}
          title={formatLocaleDateTime(report.created_at)}
        >
          Reported {reportAge(report.created_at, now)}
        </time>
      </div>

      <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-2 border-border bg-background px-3 py-2 text-sm text-foreground">
        {content ? (
          content
        ) : (
          <span className="text-muted-foreground">{copy.noContent}</span>
        )}
      </blockquote>

      {report.details?.trim() ? (
        <p className="break-words text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {copy.detailsLabel}:
          </span>{" "}
          {report.details.trim()}
        </p>
      ) : null}

      {!isOpen && report.resolved_at ? (
        <p className="text-xs text-muted-foreground">
          {tab.resolvedVerb}
          {report.resolved_by
            ? ` by ${nameFor(report.resolved_by) ?? memberFallbackLabel(report.resolved_by)}`
            : ""}{" "}
          <time
            dateTime={report.resolved_at}
            title={formatLocaleDateTime(report.resolved_at)}
          >
            {reportAge(report.resolved_at, now)}
          </time>
        </p>
      ) : null}

      {isOpen ? (
        <div className="space-y-2">
          {messageGone ? (
            <p className="text-xs text-muted-foreground">{copy.messageGone}</p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <RowButton
              label="Mark reviewed"
              accessibleName={chatReportActionLabel.reviewed(subject)}
              pending={busy === "reviewed"}
              disabled={disabled}
              title={disabledTitle}
              onClick={() => onResolve("reviewed")}
            />
            <RowButton
              label="Dismiss"
              accessibleName={chatReportActionLabel.dismissed(subject)}
              pending={busy === "dismissed"}
              disabled={disabled}
              title={disabledTitle}
              onClick={() => onResolve("dismissed")}
            />
            {messageGone ? (
              <RowButton
                label="Mark actioned"
                accessibleName={chatReportActionLabel.actioned(subject)}
                pending={busy === "actioned"}
                disabled={disabled}
                title={disabledTitle}
                onClick={() => onResolve("actioned")}
              />
            ) : (
              <RowButton
                label="Remove message"
                accessibleName={chatReportActionLabel.remove(subject)}
                variant="destructive"
                pending={busy === "remove"}
                disabled={disabled}
                title={disabledTitle}
                onClick={() => onRemove(author)}
              />
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function RowButton({
  label,
  accessibleName,
  variant = "secondary",
  pending,
  disabled,
  title,
  onClick,
}: {
  label: string;
  /** Starts with `label` (label in name) and says which report it acts on. */
  accessibleName: string;
  variant?: "secondary" | "destructive";
  pending: boolean;
  disabled: boolean;
  title: string | undefined;
  onClick: () => void;
}) {
  return (
    <Button
      variant={variant}
      size="sm"
      disabled={disabled}
      title={title}
      aria-label={accessibleName}
      onClick={onClick}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
      {label}
    </Button>
  );
}
