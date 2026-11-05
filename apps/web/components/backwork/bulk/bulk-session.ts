"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  putSignedUpload,
  type useConfirmBackworkUpload,
  type useRequestBackworkUploadUrl,
} from "@repo/hooks";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { toast } from "@/lib/hooks/use-toast";
import { getErrorMessage } from "@/lib/utils";
import type { BulkFields } from "@/lib/backwork-bulk/fields";
import { finishUpload, sha256Hex } from "@/lib/backwork-bulk/finish";
import type { BoxesByPage } from "@/lib/backwork-bulk/geometry";
import type { PagePreview } from "@/lib/backwork-bulk/pdf";
import { BulkUploadQueue } from "@/lib/backwork-bulk/queue";

/**
 * One bulk upload batch per chapter, kept for the life of the tab (#3499).
 *
 * The batch outlives the page on purpose. Submitted documents keep uploading
 * after a link click or a chapter switch, and coming back to Bulk upload shows
 * the same list, so a document that failed in the background can still be
 * retried from its row. Only a reload ends a batch, and while uploads are in
 * flight the tab asks before it closes.
 *
 * The page hands the session its current mutation hooks on every render
 * (`bind`); after the page unmounts the session keeps using the last ones,
 * which TanStack still runs.
 */
export type Prepared = {
  bytes: Uint8Array;
  hash: string;
  doc: PDFDocumentProxy;
  pageCount: number;
  previews: Map<number, Promise<PagePreview>>;
};

export type Submission = {
  fields: BulkFields;
  boxes: BoxesByPage;
  flatten: boolean;
};

type Mutations = {
  requestUpload: ReturnType<typeof useRequestBackworkUploadUrl>;
  confirmUpload: ReturnType<typeof useConfirmBackworkUpload>;
};

export type BulkSession = {
  queue: BulkUploadQueue<Prepared, Submission>;
  bind: (mutations: Mutations) => void;
  /** Whether the page is showing this batch; off it, failures become toasts. */
  setOnScreen: (onScreen: boolean) => void;
};

function releasePrepared(prepared: Prepared) {
  for (const preview of prepared.previews.values()) {
    preview.then((p) => URL.revokeObjectURL(p.url)).catch(() => undefined);
  }
  // pdf.js 6 tears a document down through its loading task.
  void prepared.doc.loadingTask.destroy();
}

function createSession(chapterId: string): BulkSession {
  let mutations: Mutations | null = null;
  let onScreen = false;
  // Original hash -> the item holding it, for the in-batch duplicate check.
  const seenHashes = new Map<string, string>();

  const queue = new BulkUploadQueue<Prepared, Submission>({
    prepare: async (file, id) => {
      const { loadPdf, renderPagePreview } = await import("@/lib/backwork-bulk/pdf");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = await sha256Hex(bytes);
      // A duplicate only while the other copy is still in the batch: a
      // removed item, or this item on a retry, doesn't count.
      const owner = seenHashes.get(hash);
      if (owner && owner !== id && queue.has(owner)) {
        throw new Error("This file is already in this batch.");
      }
      seenHashes.set(hash, id);
      let doc: PDFDocumentProxy;
      try {
        doc = await loadPdf(bytes);
      } catch {
        throw new Error("This PDF couldn't be opened. It may be damaged or password-protected.");
      }
      const previews = new Map<number, Promise<PagePreview>>();
      const first = renderPagePreview(doc, 1);
      previews.set(1, first);
      try {
        await first;
      } catch (error) {
        void doc.loadingTask.destroy();
        throw error;
      }
      return { bytes, hash, doc, pageCount: doc.numPages, previews } satisfies Prepared;
    },
    finish: async (job) => {
      try {
        const bound = mutations;
        if (!bound) throw new Error("Bulk upload isn't ready yet. Retry this one.");
        const { flattenPdf } = await import("@/lib/backwork-bulk/pdf");
        await finishUpload(job, {
          // The API client sends whichever chapter is active now, so a batch
          // only uploads while its own chapter is the active one.
          assertChapter: () => {
            if (useChapterStore.getState().activeChapterId !== chapterId) {
              throw new Error("You switched chapters. Switch back to retry this one.");
            }
          },
          flatten: flattenPdf,
          requestUpload: (body) => bound.requestUpload.mutateAsync(body),
          put: ({ signedUrl, body }) =>
            putSignedUpload({
              signedUrl,
              body,
              contentType: "application/pdf",
              upsert: true,
              describeRejection: (status) => `Storage rejected the upload (${status}).`,
            }),
          confirm: (body) => bound.confirmUpload.mutateAsync(body),
        });
      } catch (error) {
        if (!onScreen) {
          toast({
            variant: "destructive",
            title: "A backwork upload failed",
            description: "Open Bulk upload to see which one and retry it.",
          });
        }
        throw error;
      }
    },
    release: releasePrepared,
    describeError: (error, stage) => {
      const status =
        error && typeof error === "object" && "statusCode" in error
          ? (error as { statusCode?: number }).statusCode
          : undefined;
      if (status === 409) return "Already in the library.";
      return getErrorMessage(
        error,
        stage === "prepare" ? "This PDF couldn't be loaded." : "The upload failed. Retry it.",
      );
    },
  });

  // Ask before the tab closes while anything submitted is still uploading,
  // whether or not the page is open.
  let guarding = false;
  const warn = (event: BeforeUnloadEvent) => event.preventDefault();
  queue.subscribe(() => {
    const pending = queue.pendingUploads() > 0;
    if (pending === guarding || typeof window === "undefined") return;
    guarding = pending;
    if (pending) window.addEventListener("beforeunload", warn);
    else window.removeEventListener("beforeunload", warn);
  });

  return {
    queue,
    bind: (next) => {
      mutations = next;
    },
    setOnScreen: (next) => {
      onScreen = next;
    },
  };
}

const sessions = new Map<string, BulkSession>();

export function getBulkSession(chapterId: string): BulkSession {
  let session = sessions.get(chapterId);
  if (!session) {
    session = createSession(chapterId);
    sessions.set(chapterId, session);
  }
  return session;
}
