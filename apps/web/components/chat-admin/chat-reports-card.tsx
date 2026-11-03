"use client";

import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import {
  memberFallbackLabel,
  removalOutcomeUnknown,
  resolveAuthorLabel,
  useChatReportAttachments,
  useChatReports,
  useMemberDisplayNames,
  useNow,
  useRemoveReportedMessage,
  useResolveChatReport,
} from "@repo/hooks";
import type { ChatReport, ChatReportStatus } from "@repo/hooks";
import { serverMessageOf, statusOf } from "@repo/api-sdk";
import { isViewableImage } from "@repo/chat-core/attachments";
import { formatBytes, formatLocaleDateTime } from "@repo/formatting";
import { CHAT_REPORT_QUEUE_PERMISSIONS } from "@repo/validation";
import { Can } from "@/components/shared/can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EYEBROW } from "@/components/ui/typography";
import { denseListClassName } from "@/components/shared/table-controls";
import { StaleReadNotice } from "@/components/shared/stale-read-notice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  readIsOffline,
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
import { useToast } from "@/lib/hooks/use-toast";
import { AttachGlyph } from "@/components/chat/chat-glyphs";
import { FOCUS_RING } from "@/components/ui/focus";
import { cn } from "@/lib/utils";
import { reportedMessageTimeline } from "@/lib/chat/reported-message-reads";
import {
  CHAT_REPORT_REASON_LABEL,
  CHAT_REPORT_TABS,
  chatReportActionLabel,
  chatReportCopy as copy,
  reportAge,
  reportDistinction,
  reportDistinctions,
  reportedMessageSubject,
} from "./chat-report-copy";
import type { ChatReportTab } from "./chat-report-copy";

/**
 * The officer report queue (#2257) and its one destructive action (#2311).
 *
 * Contract: `spec/behavior/chat/README.md` § Report and block. Three rules from
 * it shape this queue more than anything visual:
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
 *   removed" is a success the queue reports as such, never an error that blames
 *   anyone for it. The confirmation says what the sender will see, and that in
 *   a DM they may deduce the reporter — the trade-off the owner accepted with
 *   this removal (`spec/behavior/chat/README.md` § Officer action).
 * - **A failure is described by what the server could have done.** Only a
 *   404 or 409 carries a refusal worth quoting — the API's own authored words,
 *   decided before anything changed. A 5xx or a transport failure is shown in
 *   the queue's own words, never as "Internal server error" or "Failed to
 *   fetch", and says the outcome is unknown, because it is: a removal or a
 *   resolution may have committed before its answer was lost
 *   ({@link removalFailureMessage}, {@link resolutionFailureMessage}).
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
        // Labelled as the queue is when it renders. This sits beside the flush
        // channel sections on the same page, so a card here would draw the
        // same title in a second style for an officer who can manage channels
        // but not review reports.
        <section aria-labelledby="chat-reports-label" className="space-y-1">
          <h2
            id="chat-reports-label"
            className={`${EYEBROW} text-muted-foreground`}
          >
            {copy.title}
          </h2>
          <p className="text-sm text-muted-foreground">
            {copy.deniedDescription}
          </p>
        </section>
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

const UNCONFIRMED_TOAST: Record<Resolution, string> = {
  reviewed: copy.toast.reviewedUnconfirmed,
  dismissed: copy.toast.dismissedUnconfirmed,
  actioned: copy.toast.actionedUnconfirmed,
};

/**
 * The server's own message, but only for the refusals the report routes
 * author: 404 (the report is not one this officer can see) and 409 (it is no
 * longer open, or its message no longer exists). Those are business answers
 * written to be read. Anything else — a 5xx body ("Internal server error"), a
 * guard's 403, a transport `TypeError` ("Failed to fetch") — is not copy, and
 * the caller's own words stand in for it.
 */
function refusalMessage(error: unknown): string | null {
  const status = statusOf(error);
  if (status !== 404 && status !== 409) return null;
  return serverMessageOf(error);
}

/**
 * What a failed removal tells the officer. A refusal in the server's words; an
 * unknown outcome (5xx, or no response at all) as exactly that, since the
 * removal may have landed; anything else as a plain failure.
 */
function removalFailureMessage(error: unknown): string {
  const refusal = refusalMessage(error);
  if (refusal) return refusal;
  return removalOutcomeUnknown(error)
    ? copy.toast.removeUnconfirmed
    : copy.toast.removeFailed;
}

/**
 * The same three outcomes for Mark reviewed / Dismiss / Mark actioned. The
 * PATCH is a conditional update, so a 5xx or a lost response may follow a
 * commit exactly as a removal's may; the classification is
 * `removalOutcomeUnknown`'s (a 4xx is decided before the write), which says
 * nothing specific to removal.
 */
function resolutionFailureMessage(error: unknown, next: Resolution): string {
  const refusal = refusalMessage(error);
  if (refusal) return refusal;
  return removalOutcomeUnknown(error)
    ? UNCONFIRMED_TOAST[next]
    : FAILED_TOAST[next];
}

function ChatReportsQueue() {
  const [status, setStatus] = useState<ChatReportStatus>("open");
  const { confirm, confirmDialog } = useConfirmDialog();
  const { toast } = useToast();
  const resolve = useResolveChatReport();
  const remove = useRemoveReportedMessage(reportedMessageTimeline);

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
        description: resolutionFailureMessage(error, next),
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
      const result = await remove.mutateAsync(report);
      toast({
        description: result.message_already_deleted
          ? copy.toast.alreadyRemoved
          : copy.toast.removed,
      });
    } catch (error) {
      // A 409 means the report changed since it loaded (another officer
      // resolved it, or its message was hard-deleted), in the server's words;
      // the queue refetches either way. No status is translated into a claim
      // about who did what.
      toast({
        variant: "destructive",
        description: removalFailureMessage(error),
      });
    } finally {
      markBusy(report.id, null);
    }
  }

  return (
    // Flush, not carded: the route's other sections sit on the page surface,
    // and this one is labelled the same way. The heading survives as the
    // section label; the line under it is kept, because it is not the queue
    // describing itself but the two facts a row cannot show — that its text is
    // the snapshot taken at report time, and that the reporter is never named.
    <section aria-labelledby="chat-reports-label" className="space-y-3">
      {confirmDialog}
      <div className="space-y-1">
        <h2
          id="chat-reports-label"
          className={`${EYEBROW} text-muted-foreground`}
        >
          {copy.title}
        </h2>
        <p className="text-caption text-muted">{copy.description}</p>
      </div>
      <Tabs
        value={status}
        onValueChange={(next) => setStatus(next as ChatReportStatus)}
      >
        {/*
            Four labels plus the primitive's 24px gaps run past a 375px page,
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
    </section>
  );
}

interface ReportListProps {
  tab: ChatReportTab;
  busy: Readonly<Record<string, RowAction>>;
  onResolve: (report: ChatReport, next: Resolution) => void;
  onRemove: (report: ChatReport, author: string) => void;
}

function ReportList(props: ReportListProps) {
  const query = useChatReports(props.tab.status);
  // Above every branch the read can switch between, so the notice's live
  // region is already mounted when a refetch fails, and an empty tab says it
  // is stale as plainly as a full one: "No open reports" from a failed read
  // reads as a queue with nothing waiting.
  return (
    <div className="space-y-3">
      <StaleReadNotice
        stale={query.isError && query.data !== undefined}
        message={copy.stale}
        onRetry={() => void query.refetch()}
      />
      <ReportListBody {...props} query={query} />
    </div>
  );
}

function ReportListBody({
  tab,
  busy,
  onResolve,
  onRemove,
  query,
}: ReportListProps & { query: ReturnType<typeof useChatReports> }) {
  const { isOffline } = useNetwork();
  const { nameFor } = useMemberDisplayNames();
  const now = useNow();

  if (readIsOffline(isOffline, query)) {
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

  // Named here rather than per row, because a control's name has to be unique
  // across the list: two reports that still match on message, reason, time
  // and note are numbered (`reportDistinctions`).
  const rows = reports.map((report) => {
    const author = resolveAuthorLabel(
      {
        sender_id: report.reported_sender_id,
        author_name: report.reported_author_name,
      },
      nameFor,
      null,
    );
    return {
      report,
      author,
      subject: reportedMessageSubject(author, report.reported_content),
      distinction: reportDistinction({
        reason: report.reason,
        createdAt: report.created_at,
        hasNote: Boolean(report.details?.trim()),
      }),
    };
  });
  const distinctions = reportDistinctions(rows);

  return (
    <div className="space-y-3">
      {tab.status === "open" ? (
        <p className="text-xs text-muted-foreground">{copy.openHint}</p>
      ) : null}
      {/*
        A flush list, as on every other flushed route: the list's own dividers
        rather than a bordered box per report, which was the same per-row card
        /discord-import dropped in the same change (#2500).
      */}
      <ul className={denseListClassName} aria-label={`${tab.label} reports`}>
        {rows.map(({ report, author, subject }, index) => (
          <ReportRow
            key={report.id}
            report={report}
            author={author}
            subject={subject}
            details={distinctions[index] ?? ""}
            tab={tab}
            now={now}
            nameFor={nameFor}
            busy={busy[report.id] ?? null}
            offline={isOffline}
            onResolve={(next) => onResolve(report, next)}
            onRemove={() => onRemove(report, author)}
          />
        ))}
      </ul>
    </div>
  );
}

function ReportRow({
  report,
  author,
  subject,
  details,
  tab,
  now,
  nameFor,
  busy,
  offline,
  onResolve,
  onRemove,
}: {
  report: ChatReport;
  author: string;
  /** The message the controls act on ({@link reportedMessageSubject}). */
  subject: string;
  /** What tells this report from the others in the list, for the names. */
  details: string;
  tab: ChatReportTab;
  now: number;
  nameFor: (userId: string) => string | null;
  busy: RowAction | null;
  offline: boolean;
  onResolve: (next: Resolution) => void;
  onRemove: () => void;
}) {
  const isOpen = report.status === "open";
  // Hard-deleted (a channel delete, or the import purge): nothing to remove,
  // and the server refuses a removal on it. Mark actioned closes it instead.
  const messageGone = report.message_id === null;
  const disabled = busy !== null || offline;
  const disabledTitle = offline ? copy.offlineWrite : undefined;
  const content = report.reported_content?.trim();
  const note = report.details?.trim();
  const age = reportAge(report.created_at, now);

  return (
    <li
      className="min-h-11 space-y-3 py-3"
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
          Reported {age}
        </time>
      </div>

      <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-2 border-border bg-background px-3 py-2 text-sm text-foreground">
        {content ? (
          content
        ) : (
          <span className="text-muted-foreground">{copy.noContent}</span>
        )}
      </blockquote>

      {report.reported_attachments.length > 0 ? (
        <ReportAttachments
          report={report}
          isOpen={isOpen}
          subject={subject}
          details={details}
        />
      ) : null}

      {note ? (
        <p className="break-words text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {copy.detailsLabel}:
          </span>{" "}
          {note}
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
              accessibleName={chatReportActionLabel.reviewed(subject, details)}
              pending={busy === "reviewed"}
              disabled={disabled}
              title={disabledTitle}
              onClick={() => onResolve("reviewed")}
            />
            <RowButton
              label="Dismiss"
              accessibleName={chatReportActionLabel.dismissed(subject, details)}
              pending={busy === "dismissed"}
              disabled={disabled}
              title={disabledTitle}
              onClick={() => onResolve("dismissed")}
            />
            {messageGone ? (
              <RowButton
                label="Mark actioned"
                accessibleName={chatReportActionLabel.actioned(
                  subject,
                  details,
                )}
                pending={busy === "actioned"}
                disabled={disabled}
                title={disabledTitle}
                onClick={() => onResolve("actioned")}
              />
            ) : (
              <RowButton
                label="Remove message"
                accessibleName={chatReportActionLabel.remove(subject, details)}
                variant="destructive"
                pending={busy === "remove"}
                disabled={disabled}
                title={disabledTitle}
                onClick={onRemove}
              />
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * What the reported message carried besides its text (#2481).
 *
 * The report keeps these files while it is open, so a photo stays reviewable
 * after its sender deletes the message (`spec/behavior/chat/README.md`
 * § Report). The row names them from the report itself; the files load only
 * when the officer asks, because every load mints fresh signed URLs and a
 * queue of reported photos should not open one nobody chose to look at. A
 * resolved report's files are released, so it lists the names and says so.
 *
 * An image previews inline and links to its URL; any other file is a row that
 * downloads. Both URLs force a download server-side (the chat trust boundary),
 * which an `<img>` ignores.
 */
function ReportAttachments({
  report,
  isOpen,
  subject,
  details,
}: {
  report: ChatReport;
  isOpen: boolean;
  /** The message the row acts on, for the button's accessible name. */
  subject: string;
  /** What tells this report from the others on the same message. */
  details: string;
}) {
  const [shown, setShown] = useState(false);
  const query = useChatReportAttachments(report.id, isOpen && shown);
  const files = report.reported_attachments;

  const rowClass = cn(
    "flex max-w-full items-center gap-2 rounded-md border border-border bg-surface-1 px-2 py-1.5",
    "text-xs hover:bg-accent-subtle hover:text-accent-text",
    FOCUS_RING,
  );

  let body: ReactNode;
  if (!isOpen || !shown) {
    body = (
      <ul className="space-y-1">
        {files.map((file, index) => (
          <li
            // The snapshot has no ids, and two files can share a name.
            key={index}
            className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"
          >
            <AttachGlyph className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {file.filename || copy.attachments.unnamed}
            </span>
            {file.byte_size != null ? (
              <span className="shrink-0">{formatBytes(file.byte_size)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    );
  } else if (query.isPending) {
    body = (
      <p className="text-xs text-muted-foreground">
        {copy.attachments.loading}
      </p>
    );
  } else if (query.isError || !query.data) {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-destructive">{copy.attachments.error}</p>
        <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
          {copy.attachments.retry}
        </Button>
      </div>
    );
  } else {
    const missing = files.length - query.data.length;
    body = (
      <>
        <ul className="flex flex-col items-start gap-1.5">
          {query.data.map((file, index) => (
            <li key={index} className="max-w-full">
              <a
                href={file.download_url}
                target="_blank"
                rel="noreferrer"
                download={file.filename}
                className={rowClass}
              >
                {isViewableImage(file.content_type) ? (
                  /* A plain <img>, as in the chat timeline: the src is a
                     per-request signed Storage URL that /_next/image would
                     strip the signature from. */
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={file.download_url}
                    alt={file.filename}
                    className="max-h-48 max-w-full rounded"
                  />
                ) : (
                  <>
                    <AttachGlyph
                      className="h-4 w-4 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="truncate">
                      {file.filename || copy.attachments.unnamed}
                    </span>
                    {file.byte_size != null ? (
                      <span className="shrink-0 text-muted-foreground">
                        {formatBytes(file.byte_size)}
                      </span>
                    ) : null}
                  </>
                )}
              </a>
            </li>
          ))}
        </ul>
        {missing > 0 ? (
          <p className="text-xs text-destructive">
            {copy.attachments.partial(missing)}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">
          {copy.attachments.label(files.length)}
        </span>{" "}
        {isOpen ? copy.attachments.kept : copy.attachments.released}
      </p>
      {body}
      {isOpen && !shown ? (
        <Button
          variant="secondary"
          size="sm"
          aria-label={chatReportActionLabel.showAttachments(subject, details)}
          onClick={() => setShown(true)}
        >
          {copy.attachments.show}
        </Button>
      ) : null}
    </div>
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
  /**
   * Starts with `label` (label in name), then names the message and the
   * report — reason, time, note, and a number if those still match — so
   * sibling reports on one message differ.
   */
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
