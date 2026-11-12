"use client";

import { useMemo, useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  useBackworkCourses,
  useBackworkResources,
  useConfirmBackworkUpload,
  useDepartments,
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
import { asArray, getErrorMessage, guardIntDraft, parseGuardedInt } from "@/lib/utils";
import type {
  BackworkCourse,
  BackworkDepartment,
  BackworkResource,
} from "@/components/backwork/backwork-library";
import {
  ASSIGNMENT_TYPES,
  DOCUMENT_VARIANTS,
  MAX_BACKWORK_UPLOAD_BYTES,
  MAX_BACKWORK_UPLOAD_LABEL,
  MAX_COURSE_NAME_LENGTH,
  acceptAttribute,
  findDepartmentByCode,
  inspectUploadFile,
  readSignedUpload,
  SEMESTERS,
} from "@repo/validation";
import { isPdfFile } from "@/lib/backwork-bulk/collect-files";
import {
  BACKWORK_YEAR_MIN,
  confirmFields,
  sha256Hex,
} from "@/lib/backwork-bulk/finish";
import type { BulkFields } from "@/lib/backwork-bulk/fields";
import { stageBulkUpload } from "@/lib/backwork-bulk/handoff";

/**
 * The one-file upload: any allowed type (Office, text, images, PDF) with its
 * metadata typed in by hand. Moved out of `backwork-page.tsx` unchanged in the
 * 2026-11-05 redesign; the toolbar's Upload button opens it.
 *
 * A Student Copy never uploads from here (#3509): its original can carry a
 * student's name, and only bulk upload flattens it on the device first
 * (`finishUpload`). A Student Copy PDF is handed to bulk upload with the
 * fields typed so far; any other file type is refused, since only a PDF can
 * be flattened in the browser.
 *
 * `children` is the trigger. The caller spreads `gate.controlProps()` on it.
 */

const STUDENT_COPY = "Student Copy";

/** The draft's metadata, in the shape bulk upload and `confirmFields` read. */
function draftFields(draft: BulkFields & { file: File | null }): BulkFields {
  const { file, ...fields } = draft;
  void file;
  return fields;
}

/*
  Each string names the verdict, because it no longer has a toast title to do
  that for it. These were toast bodies under "File too large" / "File type not
  allowed"; they are now the whole inline error, and a standalone "Backwork
  accepts files up to 25MB." states a rule without saying the member's file
  broke it. Same change on `/documents`.
*/
function uploadRejectionDescription(reason: "type" | "size"): string {
  if (reason === "size") {
    return `That file is too large. Backwork accepts files up to ${MAX_BACKWORK_UPLOAD_LABEL}.`;
  }
  return "That file type is not allowed. Backwork accepts PDF, Office, text/CSV, and common images (no SVG).";
}

export function BackworkUploadSheet({
  gate,
  children,
}: {
  gate: SubscriptionGate;
  children: ReactElement;
}) {
  const { toast } = useToast();
  const router = useRouter();
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
  // Already loaded by the page: these read its cache.
  const departmentsQuery = useDepartments();
  const coursesQuery = useBackworkCourses();
  const resourcesQuery = useBackworkResources();
  const [courseName, setCourseName] = useState("");
  const courseState = useMemo(
    () =>
      describeCourse(
        uploadDraft.department_code,
        uploadDraft.course_number,
        asArray<BackworkDepartment>(departmentsQuery.data),
        asArray<BackworkCourse>(coursesQuery.data),
        asArray<BackworkResource>(resourcesQuery.data),
      ),
    [
      uploadDraft.department_code,
      uploadDraft.course_number,
      departmentsQuery.data,
      coursesQuery.data,
      resourcesQuery.data,
    ],
  );

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
    const inspected = inspectUploadFile("document", file, MAX_BACKWORK_UPLOAD_BYTES);
    if (!inspected.ok) {
      setUploadError(uploadRejectionDescription(inspected.reason));
      return;
    }
    // Required, unlike the other fields: a variant left blank could be an
    // unmarked Student Copy, uploaded here unredacted (#3509).
    if (!uploadDraft.document_variant) {
      setUploadError(
        "Pick a document variant first. A Student Copy is redacted before it uploads.",
      );
      return;
    }
    if (uploadDraft.document_variant === STUDENT_COPY) {
      if (!isPdfFile(file)) {
        setUploadError(
          "A Student Copy has to be a PDF, so names can be blacked out on your device before it uploads. Export or scan it as a PDF.",
        );
        return;
      }
      stageBulkUpload({ files: [file], skipped: 0, fields: draftFields(uploadDraft) });
      uploadDialog.setOpen(false);
      router.push("/backwork/upload");
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
      const hash = await sha256Hex(new Uint8Array(await file.arrayBuffer()));
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
        describeRejection: () => "The file didn't upload.",
      });

      await confirmUpload.mutateAsync({
        storage_path: storagePath,
        file_hash: hash,
        // The same body bulk upload confirms with (`finish.ts`), so a DTO
        // change can't reach one surface and miss the other.
        ...confirmFields(draftFields(uploadDraft), file.name),
        // Only for a course no file has yet; the API saves it only when the
        // course has no name, so an upload never renames one.
        ...(courseState.kind === "new" && courseName.trim()
          ? { course_name: courseName.trim() }
          : {}),
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
      setCourseName("");
    } catch (error) {
      toast({
        title: "Couldn't upload backwork",
        description: getErrorMessage(error, "Try the upload again."),
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
                  hint={`Up to ${MAX_BACKWORK_UPLOAD_LABEL}. PDFs, Office files, text, CSV, and common images. No SVGs or executables.`}
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
                      aria-describedby={
                        courseState.kind === "named" ? "bw-course-caption" : undefined
                      }
                    />
                    {courseState.kind === "named" ? (
                      <p id="bw-course-caption" className="text-caption text-muted-foreground">
                        {courseState.label} ·{" "}
                        <span className="font-semibold text-foreground">
                          {courseState.name}
                        </span>
                      </p>
                    ) : null}
                  </UploadField>
                  {courseState.kind === "new" ? (
                    <UploadField
                      id="bw-course-name"
                      label="Course name (optional)"
                      className="sm:col-span-2"
                    >
                      <Input
                        id="bw-course-name"
                        className={UPLOAD_FIELD_CLASS}
                        aria-describedby="bw-course-name-note"
                        value={courseName}
                        maxLength={MAX_COURSE_NAME_LENGTH}
                        onChange={(event) => setCourseName(event.target.value)}
                        placeholder="Calculus I"
                      />
                      <p id="bw-course-name-note" className="text-caption text-muted">
                        New course. Name it once and everyone can find it by name.
                      </p>
                    </UploadField>
                  ) : null}
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
                {uploadDraft.document_variant === STUDENT_COPY ? (
                  <p id="bw-student-copy-note" className="text-caption text-muted">
                    A Student Copy opens in bulk upload, where you black out
                    names on your device before anything uploads.
                  </p>
                ) : null}
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
                  {uploadDraft.document_variant === STUDENT_COPY
                    ? "Redact and upload"
                    : "Upload"}
                </Button>
              </UploadSheetFooter>
            </UploadSheetContent>
          </Dialog>
    </>
  );
}

type CourseState =
  | { kind: "none" }
  | { kind: "named"; label: string; name: string }
  | { kind: "new" };

/**
 * What the sheet knows about the course typed so far (#3848): a course with a
 * name shows it under Course number; a course no file has yet offers a name
 * field; anything else shows nothing (an unnamed course with files is named
 * from a row's menu). The department matches as the API resolves it on
 * upload (`findDepartmentByCode`: trimmed, any case, #3918); the number
 * trimmed and case-insensitively. The label keeps the department's stored
 * spelling.
 */
function describeCourse(
  departmentCode: string,
  courseNumber: string,
  departments: readonly BackworkDepartment[],
  courses: readonly BackworkCourse[],
  resources: readonly BackworkResource[],
): CourseState {
  const code = departmentCode.trim();
  const number = courseNumber.trim();
  if (!code || !number) return { kind: "none" };
  const key = number.toLowerCase();
  const department = findDepartmentByCode(departments, code);
  if (!department) return { kind: "new" };
  const course = courses.find((c) => c.department_id === department.id && c.course_key === key);
  if (course?.name) {
    return { kind: "named", label: `${department.code.trim()} ${number}`, name: course.name };
  }
  if (course) return { kind: "none" };
  const hasFiles = resources.some(
    (r) => r.department_id === department.id && r.course_number?.trim().toLowerCase() === key,
  );
  return hasFiles ? { kind: "none" } : { kind: "new" };
}
