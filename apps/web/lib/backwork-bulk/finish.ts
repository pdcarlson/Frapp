import type { useConfirmBackworkUpload } from "@repo/hooks";
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

const BACKWORK_YEAR_MIN = 1900;

/** A Student Copy is always flattened, and so is anything with a box on it. */
export function mustFlatten(fields: BulkFields, boxes: BoxesByPage): boolean {
  return fields.document_variant === "Student Copy" || countBoxes(boxes) > 0;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

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
  const flatten = submission.flatten || mustFlatten(submission.fields, submission.boxes);
  let body = prepared.bytes;
  if (flatten) {
    body = await deps.flatten(prepared.doc, submission.boxes);
    if (body.byteLength > MAX_BACKWORK_UPLOAD_BYTES) {
      body = await deps.flatten(prepared.doc, submission.boxes, SMALLER);
    }
  }
  if (body.byteLength > MAX_BACKWORK_UPLOAD_BYTES) {
    throw new Error(
      flatten
        ? `This file is over ${MAX_BACKWORK_UPLOAD_LABEL} once flattened. Split the PDF and try again.`
        : `This file is over ${MAX_BACKWORK_UPLOAD_LABEL}.`,
    );
  }
  const fileHash = flatten ? await sha256Hex(body) : prepared.hash;
  const signed = await deps.requestUpload({
    filename: file.name,
    content_type: "application/pdf",
    size_bytes: body.byteLength,
  });
  const { signedUrl, storagePath } = readSignedUpload(signed);
  await deps.put({
    signedUrl,
    body: new Blob([body as BlobPart], { type: "application/pdf" }),
  });
  await deps.confirm({
    storage_path: storagePath,
    file_hash: fileHash,
    ...confirmFields(submission.fields, file.name),
    is_redacted: flatten,
  });
}
