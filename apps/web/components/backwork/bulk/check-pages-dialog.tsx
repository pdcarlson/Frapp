"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  putSignedUpload,
  useCheckBackworkDraft,
  useFetchBackworkDraftFileUrl,
  useRequestBackworkUploadUrl,
  type BackworkDraft,
} from "@repo/hooks";
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
import { getErrorMessage } from "@/lib/utils";
import { sha256Hex } from "@/lib/bulk-upload/hash";
import { countBoxes, type BoxesByPage } from "@/lib/backwork-bulk/geometry";
import type { PagePreview } from "@/lib/backwork-bulk/pdf";
import { draftLabel } from "@/lib/backwork-bulk/drafts";
import {
  flattenWithinCap,
  flattenedFileName,
  storePdf,
} from "@/lib/backwork-bulk/finish";
import { PdfRedactor } from "./pdf-redactor";

type Loaded =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "ready"; doc: PDFDocumentProxy };

/**
 * "Check pages" for a draft saved by "Save the rest" (#5252): the stored file
 * as the chapter would get it, in the same editor as the queue, so the
 * uploader can page through it and box anything the suggestions missed (a
 * handwritten name with no label, a name in a margin). "Looks right" marks
 * the draft checked; with a box added, the file is flattened again on this
 * device first and the new copy replaces the stored one. Until then the AI
 * fill doesn't read it and it can't be published.
 *
 * Comparables: Google Photos' and Lightroom's import review (a batch comes in
 * on its own and each item is looked at before it is shared), and Adobe
 * Acrobat's redaction review, where suggested marks are checked page by page
 * before they are applied.
 */
export function CheckPagesDialog({
  draft,
  onClose,
}: {
  /** The draft to check; the dialog is open while there is one. */
  draft: BackworkDraft | null;
  onClose: () => void;
}) {
  // Closing mid-save would tear down the document while it is flattened and
  // leave an uploaded copy no draft points at, so the dialog stays until the
  // save answers.
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open={!!draft} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        {draft ? (
          <CheckPages
            key={draft.id}
            draft={draft}
            saving={saving}
            onSaving={setSaving}
            onDone={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CheckPages({
  draft,
  saving,
  onSaving,
  onDone,
}: {
  draft: BackworkDraft;
  saving: boolean;
  onSaving: (saving: boolean) => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const fetchFileUrl = useFetchBackworkDraftFileUrl();
  const requestUpload = useRequestBackworkUploadUrl();
  const check = useCheckBackworkDraft();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [boxes, setBoxes] = useState<BoxesByPage>({});
  const previews = useRef(new Map<number, Promise<PagePreview>>());

  useEffect(() => {
    const abort = new AbortController();
    let doc: PDFDocumentProxy | null = null;
    const pdf = import("@/lib/backwork-bulk/pdf");
    void (async () => {
      try {
        const url = await fetchFileUrl(draft.id, abort.signal);
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw new Error(`Download failed (${response.status})`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const { loadPdf, destroyPdf } = await pdf;
        doc = await loadPdf(bytes);
        if (abort.signal.aborted) {
          void destroyPdf(doc);
          return;
        }
        setLoaded({ status: "ready", doc });
      } catch (error) {
        if (abort.signal.aborted) return;
        setLoaded({
          status: "failed",
          message: getErrorMessage(error, "Couldn't open this draft's file. Close this and try again."),
        });
      }
    })();
    const shown = previews.current;
    return () => {
      abort.abort();
      for (const preview of shown.values()) {
        preview.then((p) => URL.revokeObjectURL(p.url)).catch(() => undefined);
      }
      shown.clear();
      if (doc) {
        const opened = doc;
        void pdf.then(({ destroyPdf }) => destroyPdf(opened));
      }
    };
  }, [draft.id, fetchFileUrl]);

  const doc = loaded.status === "ready" ? loaded.doc : null;
  const loadPreview = useCallback(
    async (page: number) => {
      if (!doc) throw new Error("Not loaded yet.");
      let preview = previews.current.get(page);
      if (!preview) {
        const { renderPagePreview } = await import("@/lib/backwork-bulk/pdf");
        const rendering = renderPagePreview(doc, page);
        previews.current.set(page, rendering);
        // A failed render isn't kept, so coming back to the page tries again.
        rendering.catch(() => {
          if (previews.current.get(page) === rendering) previews.current.delete(page);
        });
        preview = rendering;
      }
      return preview;
    },
    [doc],
  );

  const added = countBoxes(boxes);

  async function looksRight() {
    if (!doc || saving) return;
    onSaving(true);
    try {
      if (added === 0) {
        await check.mutateAsync({ id: draft.id });
      } else {
        const { flattenPdf } = await import("@/lib/backwork-bulk/pdf");
        const body = await flattenWithinCap(doc, boxes, flattenPdf);
        const storagePath = await storePdf(body, flattenedFileName(draftLabel(draft)), {
          requestUpload: (request) => requestUpload.mutateAsync(request),
          put: ({ signedUrl, body: blob, signal }) =>
            putSignedUpload({
              signedUrl,
              body: blob,
              signal,
              contentType: "application/pdf",
              upsert: true,
              describeRejection: () => "The file didn't upload.",
            }),
        });
        await check.mutateAsync({
          id: draft.id,
          replacement: { storage_path: storagePath, file_hash: await sha256Hex(body) },
        });
      }
      onSaving(false);
      onDone();
    } catch (error) {
      toast({
        title: "Couldn't save the check",
        description: getErrorMessage(error, "Check your connection and try again."),
        variant: "destructive",
      });
      onSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Check pages: {draftLabel(draft)}</DialogTitle>
        <DialogDescription>
          {draft.is_redacted
            ? "This is the file as your chapter would get it, with the suggested boxes already burned in."
            : "No names or IDs were found to box, so this is your original file."}{" "}
          Page through it and draw a box over any name, ID or signature that still shows.
        </DialogDescription>
      </DialogHeader>
      {loaded.status === "ready" ? (
        <PdfRedactor
          pageCount={loaded.doc.numPages}
          loadPreview={loadPreview}
          boxes={boxes}
          onChange={setBoxes}
        />
      ) : loaded.status === "failed" ? (
        <p role="alert" className="text-caption text-destructive-text">
          {loaded.message}
        </p>
      ) : (
        <div className="flex aspect-[8.5/11] w-full items-center justify-center rounded-lg border border-border bg-surface-1">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading the pages" />
        </div>
      )}
      <DialogFooter className="items-center gap-2 sm:justify-between">
        <p className="text-caption text-muted-foreground" aria-live="polite">
          {added === 0
            ? draft.is_redacted
              ? "Nothing to add? It's ready for the AI fill and to publish."
              : "Nothing to add? It's ready to publish as it is."
            : `${added} new ${added === 1 ? "box" : "boxes"}. The file is flattened again on this device before it's saved.`}
        </p>
        <Button type="button" onClick={looksRight} disabled={!doc || saving} aria-busy={saving}>
          {added === 0 ? "Looks right" : "Save boxes"}
        </Button>
      </DialogFooter>
    </>
  );
}
