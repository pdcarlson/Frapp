"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Upload,
  X,
} from "lucide-react";
import {
  useConfirmBackworkUpload,
  useRequestBackworkUploadUrl,
} from "@repo/hooks";
import {
  MAX_BACKWORK_UPLOAD_BYTES,
  MAX_BACKWORK_UPLOAD_LABEL,
  inspectUploadFile,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PermissionsOfflineSurface } from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import {
  SubscriptionNotice,
  useSubscriptionGate,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useAuthUserId } from "@/lib/auth/use-auth-user-id";
import { useToast } from "@/lib/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  type CollectedFiles,
} from "@/lib/bulk-upload/collect-files";
import type { BoxesByPage } from "@/lib/backwork-bulk/geometry";
import type { PagePreview } from "@/lib/backwork-bulk/pdf";
import type { ItemStatus, QueueItem } from "@/lib/bulk-upload/queue";
import { PdfRedactor } from "./pdf-redactor";
import { BulkDropZone } from "@/components/shared/bulk-drop-zone";
import { BulkFieldsForm } from "./bulk-fields";
import {
  EMPTY_FIELDS,
  type BulkFields,
} from "@/lib/backwork-bulk/fields";
import { mustFlatten } from "@/lib/backwork-bulk/finish";
import {
  documentFields,
  takeStagedBulkUpload,
} from "@/lib/backwork-bulk/handoff";
import { getBulkSession, type Prepared, type Submission } from "@/lib/backwork-bulk/session";
import { InlineNote } from "@/components/shared/inline-note";

/**
 * Backwork bulk upload (#3499): drop PDFs or folders, redact and describe each
 * one, and keep going. The queue (`lib/bulk-upload/queue.ts`) loads the next
 * documents while the person works on the current one, and flattens and
 * uploads finished ones behind them, so nobody waits between documents.
 *
 * Privacy: a Student Copy, or any document with a box on it, is flattened on
 * this device and only the flattened file is uploaded (`flattenPdf`). The
 * original bytes leave the browser only for a Blank Copy or Answer Key with no
 * boxes, which is the same file the single upload sheet already sends.
 */
export function BulkUploadPage() {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  // Keyed on the account too: a batch never carries over to whoever signs in
  // next in this tab (`session.ts`).
  const authUserId = useAuthUserId();
  if (!activeChapterId) {
    return (
      <div className="space-y-6">
        <InlineNote>Pick a chapter to upload backwork to it.</InlineNote>
      </div>
    );
  }
  return (
    <Can
      permission="backwork:upload"
      offlineFallback={(retry) => (
        <PermissionsOfflineSurface
          description="Reconnect to check whether you can upload backwork."
          onRetry={retry}
        />
      )}
      deniedFallback={
        <div className="space-y-6">
          <InlineNote>
            Your role can&apos;t upload backwork. Ask an officer who manages roles.
          </InlineNote>
        </div>
      }
    >
      {/* Waits for the account (a moment after mount) so the workspace mounts once. */}
      {authUserId ? (
        <BulkUploadWorkspace
          key={`${authUserId}:${activeChapterId}`}
          userId={authUserId}
          chapterId={activeChapterId}
        />
      ) : null}
    </Can>
  );
}

function BulkUploadWorkspace({ userId, chapterId }: { userId: string; chapterId: string }) {
  const { toast } = useToast();
  const gate = useSubscriptionGate();
  const requestUpload = useRequestBackworkUploadUrl();
  const confirmUpload = useConfirmBackworkUpload();
  // The batch belongs to the chapter, not to this mount (`session.ts`):
  // leaving and coming back shows the same list.
  const [session] = useState(() => getBulkSession(userId, chapterId));
  const queue = session.queue;
  useEffect(() => {
    session.bind({ requestUpload, confirmUpload });
  });
  useEffect(() => {
    session.setOnScreen(true);
    queue.open();
    return () => {
      session.setOnScreen(false);
      const pendingCount = queue.pendingUploads();
      // An ended batch (chapter switch, sign-out) uploads nothing more.
      if (pendingCount > 0 && !session.ended()) {
        toast({
          title: `Finishing ${pendingCount} ${pendingCount === 1 ? "upload" : "uploads"}`,
          description: "They keep uploading while this tab is open. Come back to Bulk upload to check on them.",
        });
      }
      queue.close();
    };
  }, [session, queue, toast]);

  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const current = snapshot.items.find((it) => it.id === snapshot.currentId) ?? null;

  const [sticky, setSticky] = useState<BulkFields>(EMPTY_FIELDS);
  const [fields, setFields] = useState<BulkFields>(EMPTY_FIELDS);
  const [boxes, setBoxes] = useState<BoxesByPage>({});
  const [formFor, setFormFor] = useState<string | null>(null);
  if (current && formFor !== current.id) {
    setFormFor(current.id);
    // A Student Copy sent from the one-file sheet keeps what was typed there
    // over the batch's sticky fields (`handoff.ts`).
    setFields(documentFields(sticky, current.file));
    setBoxes({});
  }

  const pending = snapshot.items.some((it) =>
    (["queued", "preparing", "ready", "waiting", "finishing"] as ItemStatus[]).includes(it.status),
  );

  const addCollected = useCallback(
    ({ files, skipped, unreadable = 0 }: CollectedFiles) => {
      const accepted: File[] = [];
      let tooLarge = 0;
      let unnamed = 0;
      for (const file of files) {
        const inspected = inspectUploadFile("document", file, MAX_BACKWORK_UPLOAD_BYTES);
        if (inspected.ok) accepted.push(file);
        else if (inspected.reason === "size") tooLarge += 1;
        else unnamed += 1;
      }
      if (accepted.length > 0) queue.add(accepted);
      const notes = [
        skipped > 0 ? `${skipped} non-PDF ${skipped === 1 ? "file" : "files"} skipped` : null,
        tooLarge > 0 ? `${tooLarge} over ${MAX_BACKWORK_UPLOAD_LABEL} skipped` : null,
        unnamed > 0
          ? `${unnamed} ${unnamed === 1 ? "PDF" : "PDFs"} without a .pdf name skipped. Rename and add again`
          : null,
        unreadable > 0 ? `${unreadable} couldn't be read from your device` : null,
      ].filter(Boolean);
      if (notes.length > 0) {
        toast({
          title: accepted.length > 0 ? `Added ${accepted.length} PDFs` : "No PDFs added",
          description: notes.join(". ") + ".",
        });
      } else if (files.length === 0) {
        // Nothing at all, or only the operating system's own files
        // (.DS_Store), which the walk drops without counting.
        toast({ title: "No PDFs added", description: "There were no files in what you dropped." });
      }
    },
    [queue, toast],
  );

  // Files dropped or picked on `/backwork` (`handoff.ts`). Taken once, so a
  // remount (Strict Mode, coming back later) doesn't queue them twice.
  useEffect(() => {
    const staged = takeStagedBulkUpload();
    if (staged) addCollected(staged);
  }, [addCollected]);

  const loadPreview = useCallback(
    async (page: number) => {
      const prepared = current?.prepared;
      if (!prepared) throw new Error("Not loaded yet.");
      let preview = prepared.previews.get(page);
      if (!preview) {
        const { renderPagePreview } = await import("@/lib/backwork-bulk/pdf");
        const rendering = renderPagePreview(prepared.doc, page);
        prepared.previews.set(page, rendering);
        // A failed render isn't kept, so coming back to the page tries again.
        rendering.catch(() => {
          if (prepared.previews.get(page) === rendering) prepared.previews.delete(page);
        });
        preview = rendering;
      }
      return preview;
    },
    [current?.prepared],
  );

  function submitCurrent() {
    if (!current || current.status !== "ready" || !gate.allowed) return;
    const flatten = mustFlatten(fields, boxes);
    queue.submit(current.id, { fields, boxes, flatten });
    // Everything but the per-document fields carries to the next document.
    setSticky({ ...fields, title: "", assignment_number: "" });
  }

  const counts = useMemo(() => {
    const done = snapshot.items.filter((it) => it.status === "done").length;
    const failed = snapshot.items.filter((it) => it.status === "failed").length;
    return { total: snapshot.items.length, done, failed };
  }, [snapshot.items]);

  return (
    // A container (#4022): beside chat (#3779) the page is narrow while the
    // window is wide, so the three columns count the page's own width
    // (`@4xl`, 896px). The back link stays on the viewport's `sm`: it pairs
    // with the top bar, which is the window's.
    <div className="@container space-y-4">
      {/*
        From `sm` the top bar titles this "Backwork › Bulk upload" and its
        crumb links back. Below `sm` the bar hides the crumb, so the way back
        is here.
      */}
      <Button asChild variant="ghost" size="sm" className="-ml-2 sm:hidden">
        <Link href="/backwork">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Backwork
        </Link>
      </Button>
      <SubscriptionNotice gate={gate} feature="uploading backwork" />

      {snapshot.items.length === 0 ? (
        <BulkDropZone onFiles={addCollected} variant="large" />
      ) : (
        <div className="grid min-w-0 gap-4 @4xl:grid-cols-[240px_minmax(0,1fr)_320px]">
          <aside className="order-3 min-w-0 space-y-3 @4xl:order-1">
            <p className="text-caption font-semibold text-muted-foreground tabular-nums" aria-live="polite">
              {counts.done} of {counts.total} uploaded
              {counts.failed > 0 ? `, ${counts.failed} need attention` : ""}
            </p>
            <QueueList
              items={snapshot.items}
              currentId={snapshot.currentId}
              onRetry={(id) => queue.retry(id)}
              retryProps={gate.controlProps()}
              onRemove={(id) => queue.remove(id)}
            />
            <BulkDropZone onFiles={addCollected} />
            {counts.done > 0 ? (
              <Button type="button" variant="ghost" size="toolbar" onClick={() => queue.clearDone()}>
                Clear uploaded
              </Button>
            ) : null}
          </aside>

          <section className="order-1 min-w-0 @4xl:order-2" aria-label="Redact">
            {current ? (
              <CurrentDocument item={current} boxes={boxes} onBoxes={setBoxes} loadPreview={loadPreview} onRetry={() => queue.retry(current.id)} onRemove={() => queue.remove(current.id)} />
            ) : (
              <AllCaughtUp finishing={pending} />
            )}
          </section>

          <section className="order-2 min-w-0 space-y-4 @4xl:order-3" aria-label="Details">
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                submitCurrent();
              }}
            >
              <BulkFieldsForm value={fields} onChange={setFields} disabled={!current} />
              <p className="text-caption text-muted-foreground">
                {mustFlatten(fields, boxes)
                  ? "This copy is flattened on your device with the boxes burned in. Only the flattened file is uploaded, named after the title. The title starts as the file's name, so make sure it doesn't name a student."
                  : "Uploads as-is. Add a box or mark it a Student Copy to flatten it."}
              </p>
              <Button
                type="submit"
                className="w-full gap-2"
                {...gate.controlProps(!current || current.status !== "ready")}
              >
                <Upload className="h-4 w-4" /> Upload and next
              </Button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function CurrentDocument({
  item,
  boxes,
  onBoxes,
  loadPreview,
  onRetry,
  onRemove,
}: {
  item: QueueItem<Prepared, Submission>;
  boxes: BoxesByPage;
  onBoxes: (next: BoxesByPage) => void;
  loadPreview: (page: number) => Promise<PagePreview>;
  onRetry: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-label font-semibold text-foreground" title={item.file.name}>
          {item.file.name}
        </p>
        <Button type="button" variant="ghost" size="toolbar" onClick={onRemove} className="gap-1.5">
          <X className="h-4 w-4" /> Skip
        </Button>
      </div>
      {item.status === "failed" ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/45 bg-destructive-tint p-4 text-caption text-destructive-text">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{item.error}</span>
          <Button type="button" variant="secondary" size="toolbar" onClick={onRetry} className="gap-1.5">
            <RotateCcw className="h-4 w-4" /> Try again
          </Button>
        </div>
      ) : item.prepared ? (
        <PdfRedactor
          key={item.id}
          pageCount={item.prepared.pageCount}
          loadPreview={loadPreview}
          boxes={boxes}
          onChange={onBoxes}
        />
      ) : (
        <div className="flex aspect-[8.5/11] w-full max-w-[860px] items-center justify-center rounded-lg border border-border bg-surface-1">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading the PDF" />
        </div>
      )}
    </div>
  );
}

function AllCaughtUp({ finishing }: { finishing: boolean }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-10 text-center">
      {finishing ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      ) : (
        <CheckCircle2 className="h-6 w-6 text-success" />
      )}
      <p className="text-label font-semibold text-foreground">
        {finishing ? "Finishing the last uploads" : "All caught up"}
      </p>
      <p className="text-caption text-muted-foreground">
        {finishing
          ? "You can add more PDFs while these finish."
          : "Drop more PDFs or folders to keep going."}
      </p>
    </div>
  );
}

const STATUS_LABEL: Record<ItemStatus, string> = {
  queued: "Queued",
  preparing: "Loading",
  ready: "Ready",
  waiting: "Waiting",
  finishing: "Uploading",
  done: "Uploaded",
  failed: "Failed",
};

function QueueList({
  items,
  currentId,
  onRetry,
  retryProps,
  onRemove,
}: {
  items: readonly QueueItem<Prepared, Submission>[];
  currentId: string | null;
  onRetry: (id: string) => void;
  /** A finish retry is an upload, so the subscription gate covers it. */
  retryProps: ReturnType<SubscriptionGate["controlProps"]>;
  onRemove: (id: string) => void;
}) {
  return (
    <ol className="max-h-[50vh] space-y-1 overflow-y-auto pr-1" aria-label="Upload queue">
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-caption",
            item.id === currentId ? "bg-accent-subtle text-foreground" : "text-muted-foreground",
          )}
        >
          <span className="min-w-0 flex-1 truncate" title={item.error ?? item.file.name}>
            {item.file.name}
          </span>
          <Badge
            variant={item.status === "failed" ? "destructive" : item.status === "done" ? "success" : "outline"}
            className="shrink-0"
          >
            {STATUS_LABEL[item.status]}
          </Badge>
          {item.status === "failed" && item.failedStage === "finish" ? (
            <button
              type="button"
              {...retryProps}
              className="shrink-0 font-semibold text-accent-text hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline"
              onClick={() => onRetry(item.id)}
            >
              Retry
            </button>
          ) : null}
          {item.status !== "finishing" && item.status !== "done" ? (
            <button
              type="button"
              aria-label={`Remove ${item.file.name}`}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => onRemove(item.id)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

