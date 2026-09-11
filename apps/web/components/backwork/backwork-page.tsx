"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import {
  selectDownloadUrl,
  useBackworkResource,
  useBackworkResources,
  useConfirmBackworkUpload,
  useDepartments,
  useProfessors,
  useRequestBackworkUploadUrl,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { EYEBROW } from "@/components/ui/typography";
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
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/async-states";
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
  NestedOffline,
} from "@/components/shared/nested-states";
import { BackworkGlyph } from "@/components/documents/resources-glyphs";
import { BackworkTaxonomyDrawer } from "@/components/backwork/backwork-taxonomy-drawer";
import { Can } from "@/components/shared/can";
import { PageHeader } from "@/components/layout/page-header";
import { readSignedUpload } from "@/lib/signed-upload";
import {
  SubscriptionNotice,
  useGatedDialog,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";
import {
  ASSIGNMENT_TYPES,
  DOCUMENT_VARIANTS,
  MAX_UPLOAD_LABEL,
  SEMESTERS,
  acceptAttribute,
  inspectUploadFile,
} from "@repo/validation";

type Department = { id: string; code: string; name: string | null };
type Professor = { id: string; name: string };
type Resource = {
  id: string;
  title: string | null;
  department_id: string | null;
  course_number: string | null;
  professor_id: string | null;
  year: number | null;
  semester: string | null;
  assignment_type: string | null;
  assignment_number: number | null;
  document_variant: string | null;
  tags: string[] | null;
  is_redacted: boolean;
  created_at: string;
};

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

// Sentinel used by Radix Select, which rejects empty-string values. Maps to
// "no filter" / "no selection" in local state before we hit the API.
const ANY = "__any__";

/** SHA-256 hex digest for the browser — matches the server's file_hash format. */
async function sha256Hex(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function InlineDownloadCell({ id }: { id: string }) {
  const { toast } = useToast();
  const query = useBackworkResource(id);
  const [isFetching, setIsFetching] = useState(false);

  async function handle() {
    setIsFetching(true);
    try {
      const fresh = await query.refetch();
      const url = selectDownloadUrl(fresh.data);
      if (!url) throw new Error("No download URL returned.");
      window.open(url, "_blank", "noopener");
    } catch (error) {
      toast({
        title: "Couldn't fetch download link",
        description: getErrorMessage(
          error,
          "Retry in a moment. Signed links expire quickly.",
        ),
        variant: "destructive",
      });
    } finally {
      setIsFetching(false);
    }
  }

  /*
    A trailing text action rather than the filled Secondary it was, matching
    `/documents`: the board puts a 13px/600 text action at a row's trailing
    edge, and a 44px Secondary set the height of every row in a list this lane
    pulled down to 40. `pointer-coarse` restores the 44px target on touch.
  */
  return (
    <Button
      variant="ghost"
      onClick={handle}
      disabled={isFetching}
      className="h-8 gap-1.5 px-2 text-[13px] font-semibold pointer-coarse:h-11"
    >
      {isFetching ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      Download
    </Button>
  );
}

export function BackworkPage() {
  const { toast } = useToast();
  // `POST /v1/backwork/upload-url` and `POST /v1/backwork` carry no `@FreeTier`,
  // so the upload flow is paid-ops and its trigger has to mirror the
  // subscription gate (#841). Browsing, filtering, and the signed download link
  // are reads — `enforceSubscription` returns early for GET, so they stay live.
  const gate = useSubscriptionGate();
  const { isOffline } = useNetwork();
  const [filters, setFilters] = useState<{
    search: string;
    department_id: string;
    professor_id: string;
    semester: string;
    assignment_type: string;
    document_variant: string;
  }>({
    search: "",
    department_id: "",
    professor_id: "",
    semester: "",
    assignment_type: "",
    document_variant: "",
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);
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
  const activeChapterId = useChapterStore((s) => s.activeChapterId);

  const resourcesQuery = useBackworkResources({
    search: appliedFilters.search || undefined,
    department_id: appliedFilters.department_id || undefined,
    professor_id: appliedFilters.professor_id || undefined,
    semester: appliedFilters.semester || undefined,
    assignment_type: appliedFilters.assignment_type || undefined,
    document_variant: appliedFilters.document_variant || undefined,
  });
  const departmentsQuery = useDepartments();
  const professorsQuery = useProfessors();
  const requestUpload = useRequestBackworkUploadUrl();
  const confirmUpload = useConfirmBackworkUpload();

  const resources = useMemo(
    () => asArray<Resource>(resourcesQuery.data),
    [resourcesQuery.data],
  );
  const departments = useMemo(
    () => asArray<Department>(departmentsQuery.data),
    [departmentsQuery.data],
  );
  const professors = useMemo(
    () => asArray<Professor>(professorsQuery.data),
    [professorsQuery.data],
  );
  const departmentById = useMemo(() => {
    const map = new Map<string, Department>();
    for (const d of departments) map.set(d.id, d);
    return map;
  }, [departments]);
  const professorById = useMemo(() => {
    const map = new Map<string, Professor>();
    for (const p of professors) map.set(p.id, p);
    return map;
  }, [professors]);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAppliedFilters({ ...filters });
  }

  function clearFilters() {
    const empty = {
      search: "",
      department_id: "",
      professor_id: "",
      semester: "",
      assignment_type: "",
      document_variant: "",
    };
    setFilters(empty);
    setAppliedFilters(empty);
  }

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

    setUploading(true);
    try {
      const hash = await sha256Hex(file);
      const signed = await requestUpload.mutateAsync({
        filename: file.name,
        content_type: contentType,
      });
      const { signedUrl, storagePath } = readSignedUpload(signed);

      const response = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: { "content-type": contentType, "x-upsert": "true" },
      });
      if (!response.ok) {
        throw new Error(`Storage rejected upload (${response.status}).`);
      }

      await confirmUpload.mutateAsync({
        storage_path: storagePath,
        file_hash: hash,
        title: uploadDraft.title.trim() || file.name,
        department_code: uploadDraft.department_code.trim() || undefined,
        course_number: uploadDraft.course_number.trim() || undefined,
        professor_name: uploadDraft.professor_name.trim() || undefined,
        year: uploadDraft.year ? Number(uploadDraft.year) : undefined,
        semester: uploadDraft.semester
          ? (uploadDraft.semester as (typeof SEMESTERS)[number])
          : undefined,
        assignment_type: uploadDraft.assignment_type
          ? (uploadDraft.assignment_type as (typeof ASSIGNMENT_TYPES)[number])
          : undefined,
        assignment_number: uploadDraft.assignment_number
          ? Number(uploadDraft.assignment_number)
          : undefined,
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

  // `useBackworkResources` is `enabled: !!chapterId`, and a disabled TanStack
  // query stays `pending` forever rather than resolving. Without this the
  // spinner below never stops for a member with no active chapter — it is not
  // loading, it is waiting for something that will never arrive. Every hook
  // above must run before this return, hence its position (#873).
  if (!activeChapterId) {
    return (
      <div className="space-y-6">
        <PageHeader title="Backwork" />
        <EmptyState
          title="No chapter selected"
          description="Pick a chapter from the switcher to browse its backwork."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backwork"
        actions={
          <>
            <Can permission="backwork:admin">
              <BackworkTaxonomyDrawer />
            </Can>
            <Can permission="backwork:upload">
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
                <DialogTrigger asChild>
                  <Button className="gap-2" {...gate.controlProps()}>
                    <Upload className="h-4 w-4" /> Upload
                  </Button>
                </DialogTrigger>
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
                          onChange={(event) =>
                            setUploadDraft((prev) => ({
                              ...prev,
                              year: event.target.value,
                            }))
                          }
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
                      <UploadField
                        id="bw-assignment-type"
                        label="Assignment type"
                      >
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
                          min={0}
                          className={UPLOAD_FIELD_CLASS}
                          value={uploadDraft.assignment_number}
                          onChange={(event) =>
                            setUploadDraft((prev) => ({
                              ...prev,
                              assignment_number: event.target.value,
                            }))
                          }
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
                    <p id="bw-taxonomy-note" className="text-[12.5px] text-muted">
                      A department code or professor the chapter has not used
                      before is created for this chapter on upload.
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
            </Can>
          </>
        }
      />
      {/*
        The page-narration paragraph that sat here is deleted, not restyled.
        The framework board lists "page-narration paragraphs" under Removed
        outright, and `1f` pin 2 gives a route's main pane one toolbar row with
        "no wrapper card, no description paragraph". The same paragraph on the
        no-chapter path above went with it.

        Nothing in it was load-bearing. "Academic library for the chapter"
        described a library the member is looking at, "browse and download with
        a signed URL" narrated the implementation of a Download button, and the
        SHA-256 duplicate rule is a server behaviour a member meets as a clear
        rejection when it fires — which is where it belongs, rather than as a
        standing warning to everyone who never uploads a duplicate.
      */}

      {/*
        Disable, don't hide (§5 rule 4): the library stays browsable and
        downloadable on a lapsed chapter, so only the upload flow goes dark and
        it explains itself here. Scoped to the same permission as the controls
        it describes — a member who never sees an Upload button has nothing to
        restore, and the sentence would just be noise on their screen.
      */}
      {/*
        Silent on purpose, and the only three gates that are. This wraps a
        `SubscriptionNotice` — an explanation of why *another* control is
        disabled — not an affordance. There is nothing here for a member to act
        on, so a second notice saying we cannot check their access states a
        problem about a sentence rather than about anything they can do, and
        stacks a duplicate of the chip the gated control already shows. §5 rule
        4's "disable, don't hide" is about controls; supplementary copy has
        nothing to disable. `can-fallback.spec.tsx` derives this rather than
        listing it: a lone `SubscriptionNotice` child both may and must be
        `null` here.
      */}
      <Can permission="backwork:upload" offlineFallback={null}>
        <SubscriptionNotice gate={gate} feature="uploading backwork" />
      </Can>

      {/*
        A filter row, not a filter card. The board draws one toolbar row under
        the title with no wrapper (`1f` pin 2), and the deletion list `1t` names
        the Events "filter card" specifically as gone — this is the same card on
        the next route over. Its title said "Filters" above a row of controls
        labelled Search, Department and Professor, and its description said the
        fields were optional, which none of them are marked as requiring.

        The `<h2>` survives the card as the section label §2 draws above a
        group, `sr-only` because the controls below are individually labelled
        and a visible "FILTERS" eyebrow over a row of obvious filters is the
        narration this lane is removing. It stays in the accessibility tree so
        the region is still named for anyone navigating by landmark.
      */}
      <section aria-labelledby="bw-filters-label">
        <h2 id="bw-filters-label" className="sr-only">
          Filters
        </h2>
        <form onSubmit={applyFilters} className="grid gap-3 md:grid-cols-3">
            <div className="grid gap-1 md:col-span-2">
              <Label htmlFor="bw-search">Search</Label>
              <Input
                id="bw-search"
                value={filters.search}
                onChange={(event) =>
                  setFilters((prev) => ({
                    ...prev,
                    search: event.target.value,
                  }))
                }
                placeholder="Title, tag, or course text"
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="filter-department">Department</Label>
              <Select
                value={filters.department_id || ANY}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    department_id: value === ANY ? "" : value,
                  }))
                }
              >
                <SelectTrigger id="filter-department">
                  <SelectValue placeholder="All departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>All departments</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.code}
                      {d.name ? ` · ${d.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="filter-professor">Professor</Label>
              <Select
                value={filters.professor_id || ANY}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    professor_id: value === ANY ? "" : value,
                  }))
                }
              >
                <SelectTrigger id="filter-professor">
                  <SelectValue placeholder="All professors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>All professors</SelectItem>
                  {professors.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="filter-semester">Semester</Label>
              <Select
                value={filters.semester || ANY}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    semester: value === ANY ? "" : value,
                  }))
                }
              >
                <SelectTrigger id="filter-semester">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any semester</SelectItem>
                  {SEMESTERS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="filter-type">Assignment type</Label>
              <Select
                value={filters.assignment_type || ANY}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    assignment_type: value === ANY ? "" : value,
                  }))
                }
              >
                <SelectTrigger id="filter-type">
                  <SelectValue placeholder="Any type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any type</SelectItem>
                  {ASSIGNMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="filter-variant">Variant</Label>
              <Select
                value={filters.document_variant || ANY}
                onValueChange={(value) =>
                  setFilters((prev) => ({
                    ...prev,
                    document_variant: value === ANY ? "" : value,
                  }))
                }
              >
                <SelectTrigger id="filter-variant">
                  <SelectValue placeholder="Any variant" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any variant</SelectItem>
                  {DOCUMENT_VARIANTS.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          <div className="flex flex-wrap items-end gap-2 md:col-span-3">
            <Button type="submit">Apply filters</Button>
            <Button type="button" variant="secondary" onClick={clearFilters}>
              Clear
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="bw-list-label">
        {/*
          One toolbar row: the list's name and its count, on the page surface.
          The glyph stays — it is the route's own mark and the only thing on
          this row that is not a word.
        */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <BackworkGlyph className="h-4 w-4 shrink-0 text-muted" />
          <h2 id="bw-list-label" className={`${EYEBROW} text-muted-foreground`}>
            Resources
          </h2>
          <p className="text-[12.5px] text-muted">
            {resources.length} result{resources.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="pt-2">
          {/*
            Same trap as `/polls` (#872 / #873): `useBackworkResources` is
            `enabled: !!chapterId`, and a disabled query stays `isPending`
            with `fetchStatus: "idle"`. `isLoading` is a fetch in flight;
            `paused` is offline with no data — not an empty library.

            The nested variants, not the whole-screen ones: these render
            still right now that the card is gone: they paint no fill of their
            own, and the page is `--background`, so the whole-screen variants
            would put a `--card` block where nothing else on the page has one
            and rebuild the card this lane deleted (§10 is about the 1.00:1
            composite these were first chosen for). And the
            offline branch comes first, because a paused query is `isPending`
            and would otherwise spin behind an offline member indefinitely
            (README §4 item 4) — but only when there is nothing loaded. README
            §4 scopes it to "offline, **no cached data**" and §10 keeps stale
            content in place on a refetch, so an archive already in hand stays
            readable and the shell's `OfflineBanner` carries the connection
            state, as it does on every route.

            The `paused` branch needs the same qualifier: `isLoading` implies
            no data, but `paused` alone does not — TanStack pauses a background
            refetch while keeping the cached rows, so an unqualified check
            replaced a readable archive with a spinner on the same blip.
            `isPending && paused` is README §4's "offline, no cached data".
          */}
          {isOffline && resources.length === 0 ? (
            <NestedOffline
              sole
              title="Backwork unavailable offline"
              description="Reconnect to browse the coursework archive and download a resource."
              onRetry={() => {
                void resourcesQuery.refetch();
              }}
            />
          ) : resourcesQuery.isLoading ||
            (resourcesQuery.isPending &&
              resourcesQuery.fetchStatus === "paused") ? (
            <NestedLoading message="Loading backwork..." sole />
          ) : resourcesQuery.isError ? (
            <NestedError
              sole
              title="Couldn't load backwork"
              description="Confirm your chapter access and retry."
              onRetry={() => void resourcesQuery.refetch()}
            />
          ) : resources.length === 0 ? (
            <NestedEmpty
              sole
              title="No backwork matches this view"
              description="Loosen the filters, or upload the first resource to build the library."
            />
          ) : (
            /*
              The board's list grammar (`4d`): a hairline between rows and
              nothing else — no card, no zebra, no per-row fill. `border-t` on
              the block adds the rule above the first row, so the list reads as
              a set rather than as rows that happen to be adjacent.
            */
            <ul className="divide-y divide-border border-t border-border">
              {resources.map((row) => {
                const department = row.department_id
                  ? departmentById.get(row.department_id)
                  : null;
                const professor = row.professor_id
                  ? professorById.get(row.professor_id)
                  : null;
                return (
                  /*
                    Two lines and 8px of padding, down from three and 12. The
                    tags used to take a third line of `Badge`s under the meta;
                    they now sit inline at the end of the meta line, which is
                    where a comma-separated list of short strings reads fine and
                    costs the row ~24px less. `Redacted` stays a `Badge`,
                    because it is a status rather than a label — §5's Semantic
                    kind, and the one thing on the row a member must not miss.
                  */
                  <li
                    key={row.id}
                    className="flex min-h-11 flex-col gap-1 py-2 md:flex-row md:items-center md:gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {row.title ??
                          `${row.assignment_type ?? "Resource"} · ${row.course_number ?? ""}`}
                      </p>
                      <p className="truncate text-[12.5px] text-muted">
                        {[
                          department?.code,
                          row.course_number,
                          professor?.name,
                          row.semester,
                          row.year,
                          row.assignment_type,
                          row.document_variant,
                          ...(row.tags ?? []),
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No metadata"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 md:ml-auto">
                      {row.is_redacted ? (
                        <Badge variant="outline">Redacted</Badge>
                      ) : null}
                      <InlineDownloadCell id={row.id} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
