"use client";

import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  putSignedUpload,
  type useConfirmBackworkUpload,
  type useRequestBackworkUploadUrl,
} from "@repo/hooks";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
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
 * after a link click, and coming back to Bulk upload shows the same list, so
 * a document that failed in the background can still be retried from its row
 * without redacting it again. While anything in a batch would be lost, the
 * tab asks before it closes or reloads.
 *
 * A batch belongs to one account and one chapter, and ends with them: a
 * chapter switch or sign-out (the chapter store moving; the switcher and the
 * account menu ask first when something would be lost), or another account
 * signing in in this tab (`FrappProvider`, and `getBulkSession` itself). An
 * ended batch frees its documents, stops uploading, and never warns or
 * toasts again, so the next account never sees the last one's files.
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
  /** True once the batch has ended (see above). */
  ended: () => boolean;
  end: () => void;
  /** The account the batch was made under. */
  userId: string;
};

/** pdf.js and the flattener, loaded on first use and shared by every batch. */
let pdfModule: Promise<typeof import("./pdf")> | undefined;
function loadPdfModule() {
  pdfModule ??= import("./pdf").catch((error: unknown) => {
    pdfModule = undefined;
    throw error;
  });
  return pdfModule;
}

function releasePrepared(prepared: Prepared) {
  for (const preview of prepared.previews.values()) {
    preview.then((p) => URL.revokeObjectURL(p.url)).catch(() => undefined);
  }
  // pdf.js 6 tears a document down through its loading task.
  void prepared.doc.loadingTask.destroy();
}

function statusOf(error: unknown): number | undefined {
  return error && typeof error === "object" && "statusCode" in error
    ? (error as { statusCode?: number }).statusCode
    : undefined;
}

/** The signed-in account right now: the one the API client's token is for. */
async function liveUserId(): Promise<string | null> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  return data.session?.user?.id ?? null;
}

function createSession(userId: string, chapterId: string): BulkSession {
  let mutations: Mutations | null = null;
  let onScreen = false;
  let ended = false;
  // Original hash -> the item holding it, for the in-batch duplicate check.
  const seenHashes = new Map<string, string>();

  const queue = new BulkUploadQueue<Prepared, Submission>({
    prepare: async (file, id) => {
      const { loadPdf, renderPagePreview } = await loadPdfModule();
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
        // Policy, not plumbing: the bound mutations would still send this
        // batch's chapter, but a batch never files anything once its chapter
        // is no longer the active one, nor under any account but its own.
        // The account is read live, so a sign-in elsewhere stops the next
        // request even before the batch is ended.
        const assertChapter = async () => {
          const stale = () =>
            ended || useChapterStore.getState().activeChapterId !== chapterId;
          if (stale() || (await liveUserId()) !== userId || stale()) {
            throw new Error("You switched chapters or accounts, so this one wasn't uploaded.");
          }
        };
        const { flattenPdf } = await loadPdfModule();
        await finishUpload(job, {
          assertChapter,
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
        if (!onScreen && !ended) {
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
    // A 409 means the file is already in the library: nothing to save.
    isFinal: (error) => statusOf(error) === 409,
    describeError: (error, stage) => {
      if (statusOf(error) === 409) return "Already in the library.";
      return getErrorMessage(
        error,
        stage === "prepare" ? "This PDF couldn't be loaded." : "The upload failed. Retry it.",
      );
    },
  });

  // Ask before the tab closes or reloads while anything in the batch would be
  // lost, whether or not the page is open.
  let guarding = false;
  const warn = (event: BeforeUnloadEvent) => event.preventDefault();
  const guard = (on: boolean) => {
    if (on === guarding || typeof window === "undefined") return;
    guarding = on;
    if (on) window.addEventListener("beforeunload", warn);
    else window.removeEventListener("beforeunload", warn);
  };
  queue.subscribe(() => guard(!ended && queue.unsaved() > 0));

  return {
    queue,
    bind: (next) => {
      mutations = next;
    },
    setOnScreen: (next) => {
      onScreen = next;
    },
    userId,
    ended: () => ended,
    end: () => {
      if (ended) return;
      ended = true;
      // Discarding publishes, and the guard listener above then lets go.
      queue.discard();
    },
  };
}

const sessions = new Map<string, BulkSession>();
let watchingChapter = false;

/**
 * The batch for this account and chapter, made on first use. Making one ends
 * any batch another account left in this tab, so the page never shows it.
 */
export function getBulkSession(userId: string, chapterId: string): BulkSession {
  // A chapter change ends every batch the moment the store moves: the
  // switcher and sign-out have already asked (`confirmDropBulkUploads`), and
  // their reload mustn't stop on a second, browser leave prompt.
  if (!watchingChapter) {
    watchingChapter = true;
    useChapterStore.subscribe((state, previous) => {
      if (previous.activeChapterId && state.activeChapterId !== previous.activeChapterId) {
        endBulkSessions();
      }
    });
  }
  endBulkSessions({ except: userId });
  const key = `${userId}:${chapterId}`;
  let session = sessions.get(key);
  if (!session || session.ended()) {
    session = createSession(userId, chapterId);
    sessions.set(key, session);
  }
  return session;
}

/**
 * Ends batches in this tab: every one on a chapter switch or sign-out, or
 * every one but the signed-in account's on an account change.
 */
export function endBulkSessions({ except }: { except?: string | null } = {}): void {
  for (const [key, session] of sessions) {
    if (except && session.userId === except) continue;
    session.end();
    sessions.delete(key);
  }
}

/** Documents in this tab's batches that aren't uploaded yet. */
export function unsavedBulkUploads(): number {
  let count = 0;
  for (const session of sessions.values()) count += session.queue.unsaved();
  return count;
}

/**
 * Asks before a chapter switch or sign-out drops documents that aren't
 * uploaded yet. True when there is nothing to lose or the person agrees.
 */
export function confirmDropBulkUploads(action: "switch" | "sign-out"): boolean {
  const count = unsavedBulkUploads();
  if (count === 0 || typeof window === "undefined") return true;
  const docs = count === 1 ? "1 document that isn't" : `${count} documents that aren't`;
  return window.confirm(
    `Bulk upload has ${docs} uploaded yet. ${
      action === "switch" ? "Switching chapters" : "Signing out"
    } drops ${count === 1 ? "it" : "them"}.`,
  );
}
