"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FolderOpen,
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
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, PermissionsOfflineSurface } from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useToast } from "@/lib/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  collectFromDrop,
  collectFromList,
  type CollectedFiles,
} from "@/lib/backwork-bulk/collect-files";
import type { BoxesByPage } from "@/lib/backwork-bulk/geometry";
import type { PagePreview } from "@/lib/backwork-bulk/pdf";
import type { ItemStatus, QueueItem } from "@/lib/backwork-bulk/queue";
import { PdfRedactor } from "./pdf-redactor";
import { BulkFieldsForm } from "./bulk-fields";
import {
  EMPTY_FIELDS,
  nextDocumentFields,
  type BulkFields,
} from "@/lib/backwork-bulk/fields";
import { mustFlatten } from "@/lib/backwork-bulk/finish";
import { getBulkSession, type Prepared, type Submission } from "./bulk-session";

/**
 * Backwork bulk upload (#3499): drop PDFs or folders, redact and describe each
 * one, and keep going. The queue (`lib/backwork-bulk/queue.ts`) loads the next
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
  if (!activeChapterId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Bulk upload" />
        <EmptyState
          title="No chapter selected"
          description="Pick a chapter from the switcher to upload backwork to it."
        />
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
          <PageHeader title="Bulk upload" />
          <EmptyState
            title="You can't upload backwork"
            description="Uploading backwork needs the backwork upload permission. Ask an officer who manages roles."
          />
        </div>
      }
    >
      <BulkUploadWorkspace key={activeChapterId} chapterId={activeChapterId} />
    </Can>
  );
}

function BulkUploadWorkspace({ chapterId }: { chapterId: string }) {
  const { toast } = useToast();
  const gate = useSubscriptionGate();
  const requestUpload = useRequestBackworkUploadUrl();
  const confirmUpload = useConfirmBackworkUpload();
  // The batch belongs to the chapter, not to this mount (`bulk-session.ts`):
  // leaving and coming back shows the same list.
  const [session] = useState(() => getBulkSession(chapterId));
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
      if (pendingCount > 0) {
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
    setFields(nextDocumentFields(sticky, current.file.name));
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
      }
    },
    [queue, toast],
  );

  const loadPreview = useCallback(
    async (page: number) => {
      const prepared = current?.prepared;
      if (!prepared) throw new Error("Not loaded yet.");
      let preview = prepared.previews.get(page);
      if (!preview) {
        const { renderPagePreview } = await import("@/lib/backwork-bulk/pdf");
        preview = renderPagePreview(prepared.doc, page);
        prepared.previews.set(page, preview);
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
    <div className="space-y-4">
      <PageHeader
        title="Bulk upload"
        actions={
          <Button asChild variant="quiet" size="toolbar" className="gap-1.5">
            <Link href="/backwork">
              <ArrowLeft className="h-4 w-4" /> Backwork
            </Link>
          </Button>
        }
      />
      <SubscriptionNotice gate={gate} feature="uploading backwork" />

      {snapshot.items.length === 0 ? (
        <DropZone onFiles={addCollected} large />
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[240px_minmax(0,1fr)_320px]">
          <aside className="order-3 min-w-0 space-y-3 lg:order-1">
            <p className="text-caption font-semibold text-muted-foreground tabular-nums" aria-live="polite">
              {counts.done} of {counts.total} uploaded
              {counts.failed > 0 ? `, ${counts.failed} need attention` : ""}
            </p>
            <QueueList
              items={snapshot.items}
              currentId={snapshot.currentId}
              onRetry={(id) => queue.retry(id)}
              onRemove={(id) => queue.remove(id)}
            />
            <DropZone onFiles={addCollected} />
            {counts.done > 0 ? (
              <Button type="button" variant="quiet" size="toolbar" onClick={() => queue.clearDone()}>
                Clear uploaded
              </Button>
            ) : null}
          </aside>

          <section className="order-1 min-w-0 lg:order-2" aria-label="Redact">
            {current ? (
              <CurrentDocument item={current} boxes={boxes} onBoxes={setBoxes} loadPreview={loadPreview} onRetry={() => queue.retry(current.id)} onRemove={() => queue.remove(current.id)} />
            ) : (
              <AllCaughtUp finishing={pending} />
            )}
          </section>

          <section className="order-2 min-w-0 space-y-4 lg:order-3" aria-label="Details">
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
        <Button type="button" variant="quiet" size="toolbar" onClick={onRemove} className="gap-1.5">
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
  onRemove,
}: {
  items: readonly QueueItem<Prepared, Submission>[];
  currentId: string | null;
  onRetry: (id: string) => void;
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
            <button type="button" className="shrink-0 font-semibold text-accent-text hover:underline" onClick={() => onRetry(item.id)}>
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

function DropZone({
  onFiles,
  large = false,
}: {
  onFiles: (collected: CollectedFiles) => void;
  large?: boolean;
}) {
  const [over, setOver] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // `webkitdirectory` isn't in React's attribute types.
    folderInput.current?.setAttribute("webkitdirectory", "");
  }, []);

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setOver(false);
    void collectFromDrop(event.dataTransfer.items).then(onFiles, () =>
      onFiles({ files: [], skipped: 0, unreadable: 1 }),
    );
  }

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    if (event.target.files) onFiles(collectFromList(Array.from(event.target.files)));
    event.target.value = "";
  }

  return (
    <div
      data-testid="bulk-drop-zone"
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center transition-colors",
        large ? "min-h-[360px] p-10" : "p-4",
        over ? "border-accent-border bg-accent-subtle" : "border-input bg-surface-1",
      )}
    >
      {large ? (
        <>
          <Upload className="h-8 w-8 text-muted-foreground" />
          <p className="text-label font-semibold text-foreground">Drop PDFs or folders of PDFs</p>
          <p className="max-w-sm text-caption text-muted-foreground">
            Up to {MAX_BACKWORK_UPLOAD_LABEL} each. You&apos;ll redact and describe each one, and the next one loads while you work.
          </p>
        </>
      ) : (
        <p className="text-caption text-muted-foreground">Drop more here</p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Button type="button" variant="secondary" size="toolbar" onClick={() => filesInput.current?.click()} className="gap-1.5">
          <Upload className="h-4 w-4" /> Choose PDFs
        </Button>
        <Button type="button" variant="secondary" size="toolbar" onClick={() => folderInput.current?.click()} className="gap-1.5">
          <FolderOpen className="h-4 w-4" /> Choose a folder
        </Button>
      </div>
      <input ref={filesInput} type="file" accept=".pdf,application/pdf" multiple hidden onChange={onPick} data-testid="bulk-file-input" />
      <input ref={folderInput} type="file" multiple hidden onChange={onPick} data-testid="bulk-folder-input" />
    </div>
  );
}
