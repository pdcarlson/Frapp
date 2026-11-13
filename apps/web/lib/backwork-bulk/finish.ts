import { statusOf } from "@repo/api-sdk";
import { sha256Hex } from "@/lib/bulk-upload/hash";
import type { useConfirmBackworkUpload } from "@repo/hooks";
import { MemberFacingError } from "@repo/hooks/error-copy";
import {
  ASSIGNMENT_TYPES,
  DOCUMENT_VARIANTS,
  MAX_BACKWORK_UPLOAD_BYTES,
  MAX_BACKWORK_UPLOAD_LABEL,
  SEMESTERS,
  readSignedUpload,
} from "@repo/validation";
import { parseGuardedInt } from "@/lib/utils";
import type { BulkFields } from "./fields";
import { countBoxes, type BoxesByPage } from "./geometry";
import type { FlattenOptions } from "./pdf";

/**
 * The background finish step of a bulk upload (#3499): flatten when the
 * document needs it, upload, confirm. Kept apart from the page so the one
 * rule that matters most here is tested on its own: for a Student Copy, or
 * any document with a box, only the flattened bytes ever leave the browser.
 */
export type ConfirmBody = Parameters<
  ReturnType<typeof useConfirmBackworkUpload>["mutateAsync"]
>[0];

export type FinishDeps<Doc> = {
  /** Throws (or rejects) when the batch's chapter or account is no longer the one in use. */
  assertChapter?: () => void | Promise<void>;
  /** For the rate-limit backoff; tests pass one that resolves at once. */
  sleep?: (ms: number) => Promise<void>;
  flatten: (doc: Doc, boxes: BoxesByPage, options?: FlattenOptions) => Promise<Uint8Array>;
  requestUpload: (body: {
    filename: string;
    content_type: string;
    size_bytes: number;
  }) => Promise<unknown>;
  put: (input: { signedUrl: string; body: Blob }) => Promise<void>;
  confirm: (body: ConfirmBody) => Promise<unknown>;
};

export type FinishJob<Doc> = {
  file: File;
  prepared: { bytes: Uint8Array; hash: string; doc: Doc };
  submission: { fields: BulkFields; boxes: BoxesByPage; flatten: boolean };
};

/** Second try when a flattened file comes out over the cap. */
const SMALLER: FlattenOptions = { dpi: 110, quality: 0.7 };

/** The API's `@Min` on a Backwork resource's `year` (`backwork.dto.ts`). */
export const BACKWORK_YEAR_MIN = 1900;

/**
 * `POST /v1/backwork/upload-url` allows 10 a minute per member. A fast run
 * through a folder of Blank Copies can pass that, so a 429 waits and tries
 * again instead of failing the document.
 */
const RATE_LIMIT_WAITS_MS = [15_000, 30_000, 45_000];

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The object name a flattened file is stored under. Never the original
 * filename, which for a Student Copy is often the student's own name
 * ("smithj_12345_Midterm.pdf"); the title is what the person confirmed.
 */
export function flattenedFileName(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9 ._-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80)
    .replace(/^[.-]+|[.-]+$/g, "");
  return `${base || "backwork"}.pdf`;
}

/** A Student Copy is always flattened, and so is anything with a box on it. */
export function mustFlatten(fields: BulkFields, boxes: BoxesByPage): boolean {
  return fields.document_variant === "Student Copy" || countBoxes(boxes) > 0;
}

export { sha256Hex };

function tagsOf(raw: string): string[] | undefined {
  const tags = raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  return tags.length > 0 ? tags : undefined;
}

function oneOf<T extends string>(list: readonly T[], value: string): T | undefined {
  return (list as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function confirmFields(fields: BulkFields, fallbackTitle: string) {
  return {
    title: fields.title.trim() || fallbackTitle,
    department_code: fields.department_code.trim() || undefined,
    course_number: fields.course_number.trim() || undefined,
    professor_name: fields.professor_name.trim() || undefined,
    year: parseGuardedInt(fields.year, BACKWORK_YEAR_MIN),
    semester: oneOf(SEMESTERS, fields.semester),
    assignment_type: oneOf(ASSIGNMENT_TYPES, fields.assignment_type),
    assignment_number: parseGuardedInt(fields.assignment_number, 1),
    document_variant: oneOf(DOCUMENT_VARIANTS, fields.document_variant),
    tags: tagsOf(fields.tags),
  };
}

export async function finishUpload<Doc>(
  { file, prepared, submission }: FinishJob<Doc>,
  deps: FinishDeps<Doc>,
): Promise<void> {
  // Decided again here rather than trusted from the submission alone, so a
  // Student Copy can't reach the upload unflattened through a stale flag.
  // Checked before the flatten too, so a batch whose chapter is gone doesn't
  // render every page only to be refused.
  await deps.assertChapter?.();
  const flatten = submission.flatten || mustFlatten(submission.fields, submission.boxes);
  let body = prepared.bytes;
  if (flatten) {
    body = await deps.flatten(prepared.doc, submission.boxes);
    if (body.byteLength > MAX_BACKWORK_UPLOAD_BYTES) {
      body = await deps.flatten(prepared.doc, submission.boxes, SMALLER);
    }
  }
  if (body.byteLength > MAX_BACKWORK_UPLOAD_BYTES) {
    throw new MemberFacingError(
      flatten
        ? `This file is over ${MAX_BACKWORK_UPLOAD_LABEL} once flattened. Split the PDF and try again.`
        : `This file is over ${MAX_BACKWORK_UPLOAD_LABEL}.`,
    );
  }
  const fileHash = flatten ? await sha256Hex(body) : prepared.hash;
  const sleep = deps.sleep ?? realSleep;
  const request = {
    filename: flatten ? flattenedFileName(submission.fields.title) : file.name,
    content_type: "application/pdf",
    size_bytes: body.byteLength,
  };
  let signed: unknown;
  for (let attempt = 0; ; attempt += 1) {
    await deps.assertChapter?.();
    try {
      signed = await deps.requestUpload(request);
      break;
    } catch (error) {
      const wait = RATE_LIMIT_WAITS_MS[attempt];
      if (statusOf(error) !== 429 || wait === undefined) throw error;
      await sleep(wait);
    }
  }
  const { signedUrl, storagePath } = readSignedUpload(signed);
  await deps.put({
    signedUrl,
    body: new Blob([body as BlobPart], { type: "application/pdf" }),
  });
  await deps.assertChapter?.();
  await deps.confirm({
    storage_path: storagePath,
    file_hash: fileHash,
    ...confirmFields(submission.fields, flatten ? "Redacted backwork" : file.name),
    is_redacted: flatten,
  });
}
