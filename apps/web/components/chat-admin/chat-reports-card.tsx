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
import { serverMessageOf, statusOf } from "@repo/api-sdk";
import { formatLocaleDateTime } from "@repo/formatting";
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
  chatReportCopy as copy,
  reportAge,
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
 *   whose message is still there.
 *
 * The gate is `members:view` **and** `channels:manage` — the route's full
 * requirement (`ChatReportController`: the class floor plus the handler), not
 * just the page's `channels:manage`. A custom role can hold one without the
 * other, and without this gate that officer would get a Retry that can only
 * ever 403.
 *
 * The routes are `@SubscriptionExempt()` (member safety has no billing
 * exception), so the writes here are not subscription-gated — only disabled
 * offline, where a queueless write cannot land.
 */
export function ChatReportsCard() {
  return (
    <Can
      allOf={["members:view", "channels:manage"]}
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

function ChatReportsQueue() {
  const [status, setStatus] = useState<ChatReportStatus>("open");
  const { confirm, confirmDialog } = useConfirmDialog();
  // Reports whose removal the server refused with 409 while the report stayed
  // open: the sender had already deleted the message. The row still carries a
  // `message_id`, so without this the control would come back live and refuse
  // again on every click. Keyed off the status and the report's own state
  // after the refetch, never off the error's wording — and held here rather
  // than in the list so a tab switch, which unmounts the list, keeps it.
  const [alreadyDeleted, setAlreadyDeleted] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const markAlreadyDeleted = (id: string) =>
    setAlreadyDeleted((current) => new Set(current).add(id));

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
                confirm={confirm}
                alreadyDeleted={alreadyDeleted}
                onAlreadyDeleted={markAlreadyDeleted}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

type Confirm = ReturnType<typeof useConfirmDialog>["confirm"];
type RowAction = "reviewed" | "dismissed" | "remove";

function ReportList({
  tab,
  confirm,
  alreadyDeleted,
  onAlreadyDeleted,
}: {
  tab: ChatReportTab;
  confirm: Confirm;
  alreadyDeleted: ReadonlySet<string>;
  onAlreadyDeleted: (reportId: string) => void;
}) {
  const query = useChatReports(tab.status);
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const { nameFor } = useMemberDisplayNames();
  const now = useNow();
  const resolve = useResolveChatReport();
  const remove = useRemoveReportedMessage();

  // Per row, so acting on one report leaves the others live. The shared
  // mutation's own `isPending` / `variables` describe only the latest call.
  const [busy, setBusy] = useState<Record<string, RowAction>>({});

  function markBusy(id: string, action: RowAction | null) {
    setBusy((current) => {
      const next = { ...current };
      if (action) next[id] = action;
      else delete next[id];
      return next;
    });
  }

  async function handleResolve(
    report: ChatReport,
    next: "reviewed" | "dismissed",
  ) {
    markBusy(report.id, next);
    try {
      await resolve.mutateAsync({ id: report.id, status: next });
      toast({ description: copy.toast[next] });
    } catch (error) {
      toast({
        variant: "destructive",
        description:
          serverMessageOf(error) ??
          (next === "reviewed"
            ? copy.toast.reviewedFailed
            : copy.toast.dismissedFailed),
      });
    } finally {
      markBusy(report.id, null);
    }
  }

  async function handleRemove(report: ChatReport) {
    const confirmed = await confirm({
      title: copy.removeConfirm.title,
      description: copy.removeConfirm.description,
      confirmLabel: copy.removeConfirm.confirmLabel,
    });
    if (!confirmed) return;
    markBusy(report.id, "remove");
    try {
      await remove.mutateAsync(report.id);
      toast({ description: copy.toast.removed });
    } catch (error) {
      if (statusOf(error) === 409) onAlreadyDeleted(report.id);
      toast({
        variant: "destructive",
        description: serverMessageOf(error) ?? copy.toast.removeFailed,
      });
    } finally {
      markBusy(report.id, null);
    }
  }

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
            messageAlreadyDeleted={alreadyDeleted.has(report.id)}
            onResolve={(next) => void handleResolve(report, next)}
            onRemove={() => void handleRemove(report)}
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
  messageAlreadyDeleted,
  onResolve,
  onRemove,
}: {
  report: ChatReport;
  tab: ChatReportTab;
  now: number;
  nameFor: (userId: string) => string | null;
  busy: RowAction | null;
  offline: boolean;
  messageAlreadyDeleted: boolean;
  onResolve: (next: "reviewed" | "dismissed") => void;
  onRemove: () => void;
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
  const messageGone = report.message_id === null;
  const canRemove = isOpen && !messageGone && !messageAlreadyDeleted;
  const disabled = busy !== null || offline;
  const disabledTitle = offline ? copy.offlineWrite : undefined;
  const content = report.reported_content?.trim();

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
          {messageGone || messageAlreadyDeleted ? (
            <p className="text-xs text-muted-foreground">
              {messageGone ? copy.messageGone : copy.messageAlreadyDeleted}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              title={disabledTitle}
              onClick={() => onResolve("reviewed")}
            >
              {busy === "reviewed" ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              Mark reviewed
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              title={disabledTitle}
              onClick={() => onResolve("dismissed")}
            >
              {busy === "dismissed" ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : null}
              Dismiss
            </Button>
            {canRemove ? (
              <Button
                variant="destructive"
                size="sm"
                disabled={disabled}
                title={disabledTitle}
                onClick={onRemove}
              >
                {busy === "remove" ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : null}
                Remove message
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}
