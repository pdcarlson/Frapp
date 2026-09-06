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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

function uploadRejectionDescription(reason: "type" | "size"): string {
  if (reason === "size") {
    return `Backwork accepts files up to ${MAX_UPLOAD_LABEL}.`;
  }
  return "Backwork accepts PDF, Office, text/CSV, and common images (no SVG).";
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

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={handle}
      disabled={isFetching}
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
    const file = uploadDraft.file;
    if (!file) {
      toast({
        title: "Attach a file first",
        description: "Drag in a file or use Browse.",
        variant: "destructive",
      });
      return;
    }
    const inspected = inspectUploadFile("document", file);
    if (!inspected.ok) {
      toast({
        title:
          inspected.reason === "size"
            ? "File too large"
            : "File type not allowed",
        description: uploadRejectionDescription(inspected.reason),
        variant: "destructive",
      });
      return;
    }
    const contentType = inspected.contentType;

    setUploading(true);
    try {
      const hash = await sha256Hex(file);
      const signed = await requestUpload.mutateAsync({
        filename: file.name,
        content_type: contentType,
      });
      const signedUrl =
        signed && typeof signed === "object" && "upload_url" in signed
          ? (signed as { upload_url?: string }).upload_url
          : null;
      const storagePath =
        signed && typeof signed === "object" && "storage_path" in signed
          ? (signed as { storage_path?: string }).storage_path
          : null;
      if (!signedUrl || !storagePath) {
        throw new Error(
          "Upload URL response missing signed URL or storage path.",
        );
      }

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
        <header>
          <h2 className="text-2xl font-semibold tracking-tight">Backwork</h2>
          <p className="text-sm text-muted-foreground">
            Shared coursework archive.
          </p>
        </header>
        <EmptyState
          title="No chapter selected"
          description="Pick a chapter from the switcher to browse its backwork."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Backwork</h2>
          <p className="text-sm text-muted-foreground">
            Academic library for the chapter. Browse and download with a signed
            URL, or upload new resources. Duplicate files (matching SHA-256) are
            rejected automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <Can permission="backwork:admin">
            <BackworkTaxonomyDrawer />
          </Can>
          <Can permission="backwork:upload">
            <Dialog {...uploadDialog.dialogProps}>
              <DialogTrigger asChild>
                <Button className="gap-2" {...gate.controlProps()}>
                  <Upload className="h-4 w-4" /> Upload
                </Button>
              </DialogTrigger>
              <DialogContent
                className="max-h-[80vh] overflow-y-auto sm:max-w-xl"
                {...uploadDialog.contentProps}
              >
                <DialogHeader>
                  <DialogTitle>Upload backwork</DialogTitle>
                  <DialogDescription>
                    Every metadata field except the file itself is optional.
                    Unknown departments or professors are auto-created per
                    chapter.
                  </DialogDescription>
                </DialogHeader>
                <form
                  id="backwork-upload-form"
                  onSubmit={handleUpload}
                  className="space-y-4"
                >
                  <div className="grid gap-1">
                    <Label htmlFor="bw-file">File</Label>
                    <Input
                      id="bw-file"
                      type="file"
                      accept={acceptAttribute("document")}
                      onChange={(event) =>
                        setUploadDraft((prev) => ({
                          ...prev,
                          file: event.target.files?.[0] ?? null,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1">
                      <Label htmlFor="bw-title">Title</Label>
                      <Input
                        id="bw-title"
                        value={uploadDraft.title}
                        onChange={(event) =>
                          setUploadDraft((prev) => ({
                            ...prev,
                            title: event.target.value,
                          }))
                        }
                        placeholder="CS 3320 Midterm"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="bw-department">Department code</Label>
                      <Input
                        id="bw-department"
                        value={uploadDraft.department_code}
                        onChange={(event) =>
                          setUploadDraft((prev) => ({
                            ...prev,
                            department_code: event.target.value,
                          }))
                        }
                        placeholder="CS, MATH, ECON"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="bw-course">Course number</Label>
                      <Input
                        id="bw-course"
                        value={uploadDraft.course_number}
                        onChange={(event) =>
                          setUploadDraft((prev) => ({
                            ...prev,
                            course_number: event.target.value,
                          }))
                        }
                        placeholder="3320"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="bw-professor">Professor</Label>
                      <Input
                        id="bw-professor"
                        value={uploadDraft.professor_name}
                        onChange={(event) =>
                          setUploadDraft((prev) => ({
                            ...prev,
                            professor_name: event.target.value,
                          }))
                        }
                        placeholder="Dr. Lastname"
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="bw-year">Year</Label>
                      <Input
                        id="bw-year"
                        type="number"
                        min={2000}
                        max={2100}
                        value={uploadDraft.year}
                        onChange={(event) =>
                          setUploadDraft((prev) => ({
                            ...prev,
                            year: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="bw-semester">Semester</Label>
                      <Select
                        value={uploadDraft.semester}
                        onValueChange={(value) =>
                          setUploadDraft((prev) => ({
                            ...prev,
                            semester: value,
                          }))
                        }
                      >
                        <SelectTrigger id="bw-semester">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {SEMESTERS.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="bw-assignment-type">
                        Assignment type
                      </Label>
                      <Select
                        value={uploadDraft.assignment_type}
                        onValueChange={(value) =>
                          setUploadDraft((prev) => ({
                            ...prev,
                            assignment_type: value,
                          }))
                        }
                      >
                        <SelectTrigger id="bw-assignment-type">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {ASSIGNMENT_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="bw-assignment-number">
                        Assignment number
                      </Label>
                      <Input
                        id="bw-assignment-number"
                        type="number"
                        min={0}
                        value={uploadDraft.assignment_number}
                        onChange={(event) =>
                          setUploadDraft((prev) => ({
                            ...prev,
                            assignment_number: event.target.value,
                          }))
                        }
                      />
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="bw-variant">Document variant</Label>
                      <Select
                        value={uploadDraft.document_variant}
                        onValueChange={(value) =>
                          setUploadDraft((prev) => ({
                            ...prev,
                            document_variant: value,
                          }))
                        }
                      >
                        <SelectTrigger id="bw-variant">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          {DOCUMENT_VARIANTS.map((v) => (
                            <SelectItem key={v} value={v}>
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="bw-tags">Tags (comma-separated)</Label>
                    <Input
                      id="bw-tags"
                      value={uploadDraft.tags}
                      onChange={(event) =>
                        setUploadDraft((prev) => ({
                          ...prev,
                          tags: event.target.value,
                        }))
                      }
                      placeholder="curved, rubric-provided"
                    />
                  </div>
                </form>
                <DialogFooter>
                  {/*
                  Cancel is not gated: it closes the dialog rather than writing,
                  and a revoked subscription must still leave a way out.
                */}
                  <Button
                    variant="secondary"
                    onClick={() => uploadDialog.setOpen(false)}
                    disabled={uploading}
                  >
                    Cancel
                  </Button>
                  <Button
                    form="backwork-upload-form"
                    type="submit"
                    {...gate.controlProps(uploading || !uploadDraft.file)}
                  >
                    {uploading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Upload
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Can>
        </div>
      </header>

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

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
          <CardDescription>
            Combine search and filters; all fields are optional.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
            <div className="flex items-end gap-2 md:col-span-3">
              <Button type="submit">Apply filters</Button>
              <Button type="button" variant="secondary" onClick={clearFilters}>
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BackworkGlyph className="h-4 w-4 text-muted-foreground" />
            Resources
          </CardTitle>
          <CardDescription>
            {resources.length} result{resources.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/*
            Same trap as `/polls` (#872 / #873): `useBackworkResources` is
            `enabled: !!chapterId`, and a disabled query stays `isPending`
            with `fetchStatus: "idle"`. `isLoading` is a fetch in flight;
            `paused` is offline with no data — not an empty library.

            The nested variants, not the whole-screen ones: these render
            inside a `<CardContent>`, where a `bg-card` state on a `bg-card`
            card is exactly 1.00:1 and the region disappears (§10). And the
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
            <ul className="divide-y divide-border">
              {resources.map((row) => {
                const department = row.department_id
                  ? departmentById.get(row.department_id)
                  : null;
                const professor = row.professor_id
                  ? professorById.get(row.professor_id)
                  : null;
                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {row.title ??
                          `${row.assignment_type ?? "Resource"} · ${row.course_number ?? ""}`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {[
                          department?.code,
                          row.course_number,
                          professor?.name,
                          row.semester,
                          row.year,
                          row.assignment_type,
                          row.document_variant,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No metadata"}
                      </p>
                      {row.tags && row.tags.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {row.tags.map((tag) => (
                            <Badge key={tag} variant="outline">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
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
        </CardContent>
      </Card>
    </div>
  );
}
