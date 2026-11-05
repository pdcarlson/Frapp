"use client";

import { useState, type ReactElement } from "react";
import { Loader2 } from "lucide-react";
import {
  useConfirmBackworkUpload,
  useRequestBackworkUploadUrl,
  putSignedUpload,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import {
  UPLOAD_FIELD_CLASS,
  UPLOAD_SHEET_BUTTON_CLASS,
  UploadField,
  UploadFileField,
  UploadSheetBody,
  UploadSheetContent,
  UploadSheetFooter,
  UploadSheetTitle,
} from "@/components/shared/upload-sheet";
import {
  useGatedDialog,
  type SubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useToast } from "@/lib/hooks/use-toast";
import { getErrorMessage, guardIntDraft, parseGuardedInt } from "@/lib/utils";
import {
  ASSIGNMENT_TYPES,
  DOCUMENT_VARIANTS,
  MAX_UPLOAD_LABEL,
  SEMESTERS,
  acceptAttribute,
  inspectUploadFile,
  readSignedUpload,
} from "@repo/validation";

/**
 * The one-file upload: any allowed type (Office, text, images, PDF) with its
 * metadata typed in by hand. Moved out of `backwork-page.tsx` unchanged in the
 * 2026-11-05 redesign; the toolbar's Upload button opens it.
 *
 * `children` is the trigger. The caller spreads `gate.controlProps()` on it.
 */

/** The API's `@Min` on a Backwork resource's `year` (`backwork.dto.ts`). */
const BACKWORK_YEAR_MIN = 1900;

/*
  Each string names the verdict, because it no longer has a toast title to do
  that for it. These were toast bodies under "File too large" / "File type not
  allowed"; they are now the whole inline error, and a standalone "Backwork
  accepts files up to 25MB." states a rule without saying the member's file
  broke it. Same change on `/documents`.
*/
function uploadRejectionDescription(reason: "type" | "size"): string {
  if (reason === "size") {
    return `That file is too large. Backwork accepts files up to ${MAX_UPLOAD_LABEL}.`;
  }
  return "That file type is not allowed. Backwork accepts PDF, Office, text/CSV, and common images (no SVG).";
}

/** SHA-256 hex digest for the browser — matches the server's file_hash format. */
async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function BackworkUploadSheet({
  gate,
  children,
}: {
  gate: SubscriptionGate;
  children: ReactElement;
}) {
  const { toast } = useToast();
  const uploadDialog = useGatedDialog(gate);
  const [uploadDraft, setUploadDraft] = useState<{
    title: string;
    department_code: string;
    course_number: string;
    professor_name: string;
    year: string;
    semester: string;
    assignment_type: string;
    assignment_number: string;
    document_variant: string;
    tags: string;
    file: File | null;
  }>({
    title: "",
    department_code: "",
    course_number: "",
    professor_name: "",
    year: "",
    semester: "",
    assignment_type: "",
    assignment_number: "",
    document_variant: "",
    tags: "",
    file: null,
  });
  const [uploading, setUploading] = useState(false);
  /*
    The upload sheet's one inline error. Held here rather than inside
    `UploadFileField` because `handleUpload` is what discovers it: the file is
    inspected on submit against `@repo/validation`'s shared allowlist, and the
    field cannot know the verdict before then.
  */
  const [uploadError, setUploadError] = useState<string | null>(null);
  const requestUpload = useRequestBackworkUploadUrl();
  const confirmUpload = useConfirmBackworkUpload();

  async function handleUpload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    /*
      Inline on the field, not a toast (board `1j`: "errors inline on touched
      fields"). A toast is right for something that happened elsewhere — the
      network, the storage bucket, which is what the failures further down are —
      and wrong for "this control's value is wrong", which the member has to
      read and then act on inside a form the toast is timing out on top of.
    */
    const file = uploadDraft.file;
    if (!file) {
      setUploadError("Choose a file to upload.");
      return;
    }
    const inspected = inspectUploadFile("document", file);
    if (!inspected.ok) {
      setUploadError(uploadRejectionDescription(inspected.reason));
      return;
    }
    setUploadError(null);
    const contentType = inspected.contentType;
    // The floors the API checks on confirm, checked here before the file
    // reaches storage, so a refusal can't leave an orphaned object. This is a
    // toast, not the inline error the comment above prescribes, because a
    // browser never gets here: the inputs' own min stops its submit first,
    // and the metadata fields carry no error slot (`UploadField`). It covers
    // a programmatic submit.
    const year = parseGuardedInt(uploadDraft.year, BACKWORK_YEAR_MIN);
    const assignmentNumber = parseGuardedInt(uploadDraft.assignment_number, 1);
    if (
      (uploadDraft.year !== "" && year === undefined) ||
      (uploadDraft.assignment_number !== "" && assignmentNumber === undefined)
    ) {
      toast({
        title: "Check the year and assignment number",
        description: `The year starts at ${BACKWORK_YEAR_MIN}, and assignment numbers start at 1.`,
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const hash = await sha256Hex(file);
      const signed = await requestUpload.mutateAsync({
        filename: file.name,
        content_type: contentType,
      });
      const { signedUrl, storagePath } = readSignedUpload(signed);

      await putSignedUpload({
        signedUrl,
        body: file,
        contentType,
        upsert: true,
        describeRejection: (status) => `Storage rejected upload (${status}).`,
      });

      await confirmUpload.mutateAsync({
        storage_path: storagePath,
        file_hash: hash,
        title: uploadDraft.title.trim() || file.name,
        department_code: uploadDraft.department_code.trim() || undefined,
        course_number: uploadDraft.course_number.trim() || undefined,
        professor_name: uploadDraft.professor_name.trim() || undefined,
        year,
        semester: uploadDraft.semester
          ? (uploadDraft.semester as (typeof SEMESTERS)[number])
          : undefined,
        assignment_type: uploadDraft.assignment_type
          ? (uploadDraft.assignment_type as (typeof ASSIGNMENT_TYPES)[number])
          : undefined,
        assignment_number: assignmentNumber,
        document_variant: uploadDraft.document_variant
          ? (uploadDraft.document_variant as (typeof DOCUMENT_VARIANTS)[number])
          : undefined,
        tags: uploadDraft.tags
          ? uploadDraft.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : undefined,
        is_redacted: false,
      });
      toast({
        title: "Upload complete",
        description: `${file.name} is now in the backwork library.`,
      });
      uploadDialog.setOpen(false);
      setUploadDraft({
        title: "",
        department_code: "",
        course_number: "",
        professor_name: "",
        year: "",
        semester: "",
        assignment_type: "",
        assignment_number: "",
        document_variant: "",
        tags: "",
        file: null,
      });
    } catch (error) {
      toast({
        title: "Couldn't upload backwork",
        description: getErrorMessage(
          error,
          "Retry the upload. Duplicate files are rejected server-side.",
        ),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
          {/*
              Cleared on OPEN, not on close. Cancel calls
              `uploadDialog.setOpen(false)` and `useGatedDialog`'s revoke
              effect calls its own `setOpenState(false)`; both only change the
              controlled prop, and Radix's `useControllableState` fires
              `onOpenChange` for its own setter alone — so clearing on close
              missed two of the three ways this sheet shuts, and a spent
              rejection survived a Cancel into the next open. Every open is a
              `DialogTrigger` press (nothing calls `setOpen(true)`), which
              does reach the handler. Same reasoning as `/documents`, written
              out there.

              The draft survives on purpose: a half-typed course number is
              worth keeping, a spent error is not.
            */}
          <Dialog
            {...uploadDialog.dialogProps}
            onOpenChange={(next) => {
              if (next) setUploadError(null);
              uploadDialog.dialogProps.onOpenChange(next);
            }}
          >
            <DialogTrigger asChild>{children}</DialogTrigger>
            <UploadSheetContent {...uploadDialog.contentProps}>
              <UploadSheetTitle>Upload backwork</UploadSheetTitle>
              <UploadSheetBody
                id="backwork-upload-form"
                onSubmit={handleUpload}
              >
                <UploadFileField
                  id="bw-file"
                  label="File"
                  hint={`Up to ${MAX_UPLOAD_LABEL}. PDFs, Office files, text, CSV, and common images. No SVGs or executables.`}
                  accept={acceptAttribute("document")}
                  file={uploadDraft.file}
                  error={uploadError}
                  disabled={uploading}
                  onSelect={(file) => {
                    setUploadError(null);
                    setUploadDraft((prev) => ({ ...prev, file }));
                  }}
                />
                {/*
                    The dialog's instructional paragraph is deleted with the
                    rest of the page's narration, and the one fact in it that
                    a member could act on is now field help where it applies:
                    "unknown departments or professors are auto-created" sits
                    under those two fields, not over the whole form. "Every
                    metadata field except the file itself is optional" is what
                    the field labels already say by not being marked required.
                  */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <UploadField id="bw-title" label="Title">
                    <Input
                      id="bw-title"
                      className={UPLOAD_FIELD_CLASS}
                      value={uploadDraft.title}
                      onChange={(event) =>
                        setUploadDraft((prev) => ({
                          ...prev,
                          title: event.target.value,
                        }))
                      }
                      placeholder="CS 3320 Midterm"
                    />
                  </UploadField>
                  <UploadField id="bw-department" label="Department code">
                    <Input
                      id="bw-department"
                      aria-describedby="bw-taxonomy-note"
                      className={UPLOAD_FIELD_CLASS}
                      value={uploadDraft.department_code}
                      onChange={(event) =>
                        setUploadDraft((prev) => ({
                          ...prev,
                          department_code: event.target.value,
                        }))
                      }
                      placeholder="CS, MATH, ECON"
                    />
                  </UploadField>
                  <UploadField id="bw-course" label="Course number">
                    <Input
                      id="bw-course"
                      className={UPLOAD_FIELD_CLASS}
                      value={uploadDraft.course_number}
                      onChange={(event) =>
                        setUploadDraft((prev) => ({
                          ...prev,
                          course_number: event.target.value,
                        }))
                      }
                      placeholder="3320"
                    />
                  </UploadField>
                  <UploadField id="bw-professor" label="Professor">
                    <Input
                      id="bw-professor"
                      aria-describedby="bw-taxonomy-note"
                      className={UPLOAD_FIELD_CLASS}
                      value={uploadDraft.professor_name}
                      onChange={(event) =>
                        setUploadDraft((prev) => ({
                          ...prev,
                          professor_name: event.target.value,
                        }))
                      }
                      placeholder="Dr. Lastname"
                    />
                  </UploadField>
                  <UploadField id="bw-year" label="Year">
                    <Input
                      id="bw-year"
                      type="number"
                      min={2000}
                      max={2100}
                      className={UPLOAD_FIELD_CLASS}
                      value={uploadDraft.year}
                      onChange={(event) => {
                        // Its floor waits for submit: a guard at 1900
                        // would refuse the "2" of "2026".
                        const next = guardIntDraft(event.target.value);
                        if (next === undefined) return;
                        setUploadDraft((prev) => ({ ...prev, year: next }));
                      }}
                    />
                  </UploadField>
                  <UploadField id="bw-semester" label="Semester">
                    <Select
                      value={uploadDraft.semester}
                      onValueChange={(value) =>
                        setUploadDraft((prev) => ({
                          ...prev,
                          semester: value,
                        }))
                      }
                    >
                      {/*
                          "Pick one" is the board's own unset-value copy
                          (`1j`). It replaces a bare em dash, which the
                          greenfield brand lock bans in product copy and which
                          a screen reader announced as nothing at all.
                        */}
                      <SelectTrigger
                        id="bw-semester"
                        className={UPLOAD_FIELD_CLASS}
                      >
                        <SelectValue placeholder="Pick one" />
                      </SelectTrigger>
                      <SelectContent>
                        {SEMESTERS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </UploadField>
                  <UploadField id="bw-assignment-type" label="Assignment type">
                    <Select
                      value={uploadDraft.assignment_type}
                      onValueChange={(value) =>
                        setUploadDraft((prev) => ({
                          ...prev,
                          assignment_type: value,
                        }))
                      }
                    >
                      <SelectTrigger
                        id="bw-assignment-type"
                        className={UPLOAD_FIELD_CLASS}
                      >
                        <SelectValue placeholder="Pick one" />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSIGNMENT_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </UploadField>
                  <UploadField
                    id="bw-assignment-number"
                    label="Assignment number"
                  >
                    <Input
                      id="bw-assignment-number"
                      type="number"
                      min={1}
                      className={UPLOAD_FIELD_CLASS}
                      value={uploadDraft.assignment_number}
                      onChange={(event) => {
                        // Its floor of 1 waits for submit, so deleting
                        // the 1 of "10" isn't refused mid-edit.
                        const next = guardIntDraft(event.target.value);
                        if (next === undefined) return;
                        setUploadDraft((prev) => ({
                          ...prev,
                          assignment_number: next,
                        }));
                      }}
                    />
                  </UploadField>
                  <UploadField id="bw-variant" label="Document variant">
                    <Select
                      value={uploadDraft.document_variant}
                      onValueChange={(value) =>
                        setUploadDraft((prev) => ({
                          ...prev,
                          document_variant: value,
                        }))
                      }
                    >
                      <SelectTrigger
                        id="bw-variant"
                        className={UPLOAD_FIELD_CLASS}
                      >
                        <SelectValue placeholder="Pick one" />
                      </SelectTrigger>
                      <SelectContent>
                        {DOCUMENT_VARIANTS.map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </UploadField>
                </div>
                {/*
                    Carries an id and is referenced by the two fields it is
                    about. Field help that is only positioned near a control
                    reaches sighted users and nobody else — and this sentence
                    is the one fact rescued from the deleted dialog
                    description, where Radix had wired it to the dialog for
                    free.
                  */}
                <p id="bw-taxonomy-note" className="text-caption text-muted">
                  A department code or professor the chapter has not used before
                  is created for this chapter on upload.
                </p>
                <UploadField id="bw-tags" label="Tags (comma-separated)">
                  <Input
                    id="bw-tags"
                    className={UPLOAD_FIELD_CLASS}
                    value={uploadDraft.tags}
                    onChange={(event) =>
                      setUploadDraft((prev) => ({
                        ...prev,
                        tags: event.target.value,
                      }))
                    }
                    placeholder="curved, rubric-provided"
                  />
                </UploadField>
              </UploadSheetBody>
              <UploadSheetFooter>
                {/*
                  Cancel is not gated: it closes the dialog rather than writing,
                  and a revoked subscription must still leave a way out.
                */}
                <Button
                  variant="secondary"
                  className={UPLOAD_SHEET_BUTTON_CLASS}
                  onClick={() => uploadDialog.setOpen(false)}
                  disabled={uploading}
                >
                  Cancel
                </Button>
                {/*
                    Enabled with no file chosen, per the board. The gate still
                    disables it — that is a verdict about the chapter, not
                    about this form.
                  */}
                <Button
                  form="backwork-upload-form"
                  type="submit"
                  className={UPLOAD_SHEET_BUTTON_CLASS}
                  {...gate.controlProps(uploading)}
                >
                  {uploading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Upload
                </Button>
              </UploadSheetFooter>
            </UploadSheetContent>
          </Dialog>
    </>
  );
}
