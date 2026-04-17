"use client";

import { useMemo, useState } from "react";
import { BookOpen, Download, Loader2, Upload } from "lucide-react";
import {
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
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import { useToast } from "@/hooks/use-toast";
import { asArray } from "@/lib/utils";

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

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "txt",
  "csv",
  "jpg",
  "jpeg",
  "png",
  "webp",
]);

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  csv: "text/csv",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const SEMESTERS = ["Spring", "Summer", "Fall", "Winter"] as const;
const ASSIGNMENT_TYPES = [
  "Exam",
  "Midterm",
  "Final Exam",
  "Quiz",
  "Homework",
  "Lab",
  "Project",
  "Study Guide",
  "Notes",
  "Other",
] as const;
const DOCUMENT_VARIANTS = [
  "Student Copy",
  "Blank Copy",
  "Answer Key",
] as const;

// Sentinel used by Radix Select, which rejects empty-string values. Maps to
// "no filter" / "no selection" in local state before we hit the API.
const ANY = "__any__";

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: string }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

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
      const url =
        fresh.data && typeof fresh.data === "object" && "download_url" in fresh.data
          ? (fresh.data as { download_url?: string }).download_url ?? null
          : null;
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
      variant="outline"
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
  const [uploadOpen, setUploadOpen] = useState(false);
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
    const ext = extensionOf(file.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      toast({
        title: "File type not allowed",
        description:
          "Backwork accepts PDF, Office, text/CSV, and common images (no SVG).",
        variant: "destructive",
      });
      return;
    }
    const contentType = CONTENT_TYPE_BY_EXTENSION[ext] ?? file.type;

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
        throw new Error("Upload URL response missing signed URL or storage path.");
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
      setUploadOpen(false);
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
    <div className="space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Backwork</h2>
          <p className="text-sm text-muted-foreground">
            Academic library for the chapter. Browse and download with a signed
            URL, or upload new resources. Duplicate files (matching SHA-256)
            are rejected automatically.
          </p>
        </div>
        <Can permission="backwork:upload">
          <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Upload className="h-4 w-4" /> Upload
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
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
                    accept=".pdf,.docx,.xlsx,.pptx,.txt,.csv,.jpg,.jpeg,.png,.webp"
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
                    <Label htmlFor="bw-assignment-type">Assignment type</Label>
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
                <Button
                  variant="outline"
                  onClick={() => setUploadOpen(false)}
                  disabled={uploading}
                >
                  Cancel
                </Button>
                <Button
                  form="backwork-upload-form"
                  type="submit"
                  disabled={uploading || !uploadDraft.file}
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
      </header>

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
                  setFilters((prev) => ({ ...prev, search: event.target.value }))
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
              <Button type="button" variant="outline" onClick={clearFilters}>
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            Resources
          </CardTitle>
          <CardDescription>
            {resources.length} result{resources.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {resourcesQuery.isPending ? (
            <LoadingState message="Loading backwork..." />
          ) : resourcesQuery.isError ? (
            <ErrorState
              title="Couldn't load backwork"
              description="Confirm your chapter access and retry."
              onRetry={() => void resourcesQuery.refetch()}
            />
          ) : resources.length === 0 ? (
            <EmptyState
              title="No backwork matches this view"
              description="Loosen the filters, or upload the first resource to build the library."
            />
          ) : (
            <ul className="divide-y divide-border/70">
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

