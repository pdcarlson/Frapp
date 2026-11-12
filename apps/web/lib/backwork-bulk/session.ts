"use client";

import { MemberFacingError } from "@repo/hooks/error-copy";
import { statusOf } from "@repo/api-sdk";
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
import { clearStagedBulkUpload } from "./handoff";

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
 * chapter switch or sign-out (the chapter store moving; every switch and
 * sign-out control asks first when something would be lost, through
 * `useConfirmDropBulkUploads`), or another account
 * signing in in this tab (`FrappProvider`, and `getBulkSession` itself). An
 * ended batch frees its documents, stops uploading, says once how many it
 * dropped (never which), and never warns or toasts again, so the next account
 * never sees the last one's files.
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
  // A prepared document means the module has loaded, so this resolves at once.
  void loadPdfModule().then(({ destroyPdf }) => destroyPdf(prepared.doc));
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
  // The tail of the claim line: each prepare checks and claims its hash only
  // after every prepare started before it has (#3665).
  let claimLine: Promise<unknown> = Promise.resolve();

  const queue = new BulkUploadQueue<Prepared, Submission>({
    prepare: async (file, id) => {
      // Files read and hash side by side, but claim their hash one at a time
      // in the order the queue started them. The queue starts the files it
      // loads together in batch order, so of two copies loaded together the
      // later one is refused, whichever hash finishes first. A retry starts
      // afresh, so a copy retried after a failed read finds the other copy
      // already holding the hash.
      const pdfLib = loadPdfModule();
      const hashing = file.arrayBuffer().then(async (buffer) => {
        const bytes = new Uint8Array(buffer);
        return { bytes, hash: await sha256Hex(bytes) };
      });
      // Both are awaited below; this only stops a failure that lands before
      // they are from being reported as unhandled meanwhile.
      pdfLib.catch(() => undefined);
      hashing.catch(() => undefined);
      const claimed = claimLine.then(async () => {
        const read = await hashing;
        // A duplicate only while the other copy is still in the batch: a
        // removed item, or this item on a retry, doesn't count.
        const owner = seenHashes.get(read.hash);
        if (owner && owner !== id && queue.has(owner)) {
          throw new MemberFacingError("This file is already in this batch.");
        }
        seenHashes.set(read.hash, id);
        return read;
      });
      // Settles to nothing either way, so the line never holds a file's bytes.
      claimLine = claimed.then(
        () => undefined,
        () => undefined,
      );
      const { bytes, hash } = await claimed;
      const { loadPdf, renderPagePreview, destroyPdf } = await pdfLib;
      let doc: PDFDocumentProxy;
      try {
        doc = await loadPdf(bytes);
      } catch {
        throw new MemberFacingError("This PDF couldn't be opened. It may be damaged or password-protected.");
      }
      const previews = new Map<number, Promise<PagePreview>>();
      const first = renderPagePreview(doc, 1);
      previews.set(1, first);
      try {
        await first;
      } catch (error) {
        void destroyPdf(doc);
        throw error;
      }
      return { bytes, hash, doc, pageCount: doc.numPages, previews } satisfies Prepared;
    },
    finish: async (job) => {
      try {
        const bound = mutations;
        if (!bound) throw new MemberFacingError("Bulk upload isn't ready yet. Retry this one.");
        // Policy, not plumbing: the bound mutations would still send this
        // batch's chapter, but a batch never files anything once its chapter
        // is no longer the active one, nor under any account but its own.
        // The account is read live, so a sign-in elsewhere stops the next
        // request even before the batch is ended.
        const assertChapter = async () => {
          const stale = () =>
            ended || useChapterStore.getState().activeChapterId !== chapterId;
          if (stale() || (await liveUserId()) !== userId || stale()) {
            throw new MemberFacingError("You switched chapters or accounts, so this one wasn't uploaded.");
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
              describeRejection: () => "The file didn't upload.",
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
      // Said here because a store move can come from somewhere that never
      // asked, such as another tab or device switching chapters. After a
      // switch or sign-out that asked, the reload hides it.
      const lost = queue.unsaved();
      if (lost > 0) {
        toast({
          variant: "destructive",
          title: "Bulk upload stopped",
          description: `You switched chapters or accounts, so ${
            lost === 1 ? "1 document that wasn't uploaded was" : `${lost} documents that weren't uploaded were`
          } dropped.`,
        });
      }
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
  // switcher and sign-out have already asked (`useConfirmDropBulkUploads`), and
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
  // Staged files belong to whoever staged them, which the hand-off doesn't
  // record, so any batch ending drops them.
  clearStagedBulkUpload();
  for (const [key, session] of sessions) {
    if (except && session.userId === except) continue;
    session.end();
    sessions.delete(key);
  }
}

/** Documents in this tab's batches that aren't uploaded yet. */
function unsavedBulkUploads(): number {
  let count = 0;
  for (const session of sessions.values()) count += session.queue.unsaved();
  return count;
}

export type BulkDropAction = "switch" | "sign-out" | "delete-account";

/**
 * What a chapter switch, sign-out or account deletion would drop from Bulk
 * upload, as a sentence for its confirm dialog; null when nothing would be
 * lost. `useConfirmDropBulkUploads` asks with it.
 */
export function bulkDropNotice(action: BulkDropAction): string | null {
  const count = unsavedBulkUploads();
  if (count === 0) return null;
  const docs = count === 1 ? "1 document that isn't" : `${count} documents that aren't`;
  const doing = {
    switch: "Switching chapters",
    "sign-out": "Signing out",
    "delete-account": "Deleting your account",
  }[action];
  return `Bulk upload has ${docs} uploaded yet. ${doing} drops ${count === 1 ? "it" : "them"}.`;
}
