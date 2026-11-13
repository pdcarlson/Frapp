"use client";

import { describeLoadFailure } from "@repo/hooks/error-copy";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Download,
  FileArchive,
  FolderUp,
  Filter,
  Loader2,
  Merge,
  MoreHorizontal,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  selectDownloadUrl,
  useBackworkCourses,
  useBackworkResources,
  useDeleteBackworkResource,
  useDepartments,
  useFetchBackworkDownloadUrls,
  useFetchBackworkResource,
  useMyPermissions,
  useProfessors,
} from "@repo/hooks";
import { MAX_BACKWORK_ZIP_LABEL, can } from "@repo/validation";
import { formatDay } from "@repo/formatting";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  NestedError,
  NestedOffline,
} from "@/components/shared/nested-states";
import { RowMenu, type RowMenuEntry } from "@/components/shared/row-menu";
import { FilterChip } from "@/components/shared/filter-chip";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { Can } from "@/components/shared/can";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { BackworkTaxonomyDrawer } from "@/components/backwork/backwork-taxonomy-drawer";
import { useBackworkTaxonomyActions } from "@/components/backwork/backwork-taxonomy-actions";
import { useBackworkCourseDialog } from "@/components/backwork/backwork-course-dialog";
import { BackworkUploadSheet } from "@/components/backwork/backwork-upload-sheet";
import { BulkDropZone } from "@/components/backwork/bulk/drop-zone";
import type { CollectedFiles } from "@/lib/bulk-upload/collect-files";
import { stageBulkUpload } from "@/lib/backwork-bulk/handoff";
import { BackworkRowsSkeleton } from "@/components/backwork/backwork-skeleton";
import {
  CopyLabel,
  Highlighted,
  TypeTag,
} from "@/components/backwork/backwork-row-parts";
import {
  BACKWORK_LIST_CAP,
  NO_FILTERS,
  OPTION_FOR,
  filterOptions,
  liveFilters,
  hasActiveFilters,
  queryLibrary,
  toLibraryRows,
  type BackworkCourse,
  type BackworkDepartment,
  type BackworkProfessor,
  type BackworkResource,
  type LibraryFilters,
  type LibraryRow,
} from "@/components/backwork/backwork-library";
import {
  MAX_BACKWORK_ZIP_FILES,
  ZipTooLargeError,
  buildBackworkZip,
  saveBlob,
  zipEntryNames,
} from "@/lib/backwork-zip";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useNetwork } from "@/lib/providers/network-provider";
import { useToast } from "@/lib/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { SearchGlyph } from "@/components/documents/resources-glyphs";
import {
  compactControlClassName,
  dashboardToolbarSearchClassName,
  dashboardToolbarSearchGlyphClassName,
  denseListClassName,
} from "@/components/shared/table-controls";
import { asArray, cn, getErrorMessage } from "@/lib/utils";
import { InlineNote, InlineNoteAction } from "@/components/shared/inline-note";

/**
 * `/backwork`, rebuilt 2026-11-05 around the files instead of a filter form
 * (proposal: https://claude.ai/artifact/9v4Gv9Mr7UJcbVLNLfDFrX).
 *
 * - **One toolbar row.** Live search plus five filter chips that apply the
 *   moment one is picked; the six full-width selects and the Apply/Clear pair
 *   they needed are gone.
 * - **Search forgives typos** and covers every field a row shows, tags
 *   included, which the old box's placeholder promised and the server never
 *   did (#585). It runs on the client over the library the list endpoint
 *   returns; see `backwork-library.ts` for why, and for its row cap.
 * - **Rows you can tell apart**: a colored type tag, course code, professor,
 *   term, an icon per copy type, the date added, and an icon-only Download.
 * - **Rare tools behind a menu.** Each row's actions open on right-click and
 *   on its ⋯ button (`RowMenu`), where officers also rename or merge that
 *   row's professor or department and delete the file. The full clean-up
 *   drawer moved from a header button into the page's ⋯ menu.
 */

type ChipKey = keyof LibraryFilters;

const CHIPS: { key: ChipKey; label: string; anyLabel: string }[] = [
  { key: "course", label: "Course", anyLabel: "Any course" },
  { key: "professorId", label: "Professor", anyLabel: "Any professor" },
  { key: "term", label: "Term", anyLabel: "Any term" },
  { key: "type", label: "Type", anyLabel: "Any type" },
  { key: "variant", label: "Copy", anyLabel: "Any copy" },
];

/*
 * Columns from a 896px page (`@4xl`; the page root is a container, #4022,
 * and the fixed columns alone take ~700px). Below it a row stacks: title and course, then one
 * wrapping line of tag, professor, term, copy and date, with the actions on
 * the right. The meta wrapper is `@4xl:contents`, so there its children become
 * grid cells and `@4xl:order-*` puts the type tag in the first column.
 */
const ROW_GRID =
  "@4xl:grid-cols-[112px_minmax(0,1fr)_140px_104px_128px_64px_76px]";


/**
 * A search for the joined course form ("cogs2120") hits that one word, which
 * the course column spells as two; light both up.
 */
function courseHits(row: LibraryRow, hits: readonly string[]): readonly string[] {
  const code = row.department?.code.toLowerCase();
  const number = row.resource.course_number?.toLowerCase();
  if (!code || !number || !hits.includes(`${code}${number}`)) return hits;
  return [...hits, code, number];
}

export function BackworkPage() {
  const { toast } = useToast();
  // `POST /v1/backwork/upload-url` and `POST /v1/backwork` carry no `@FreeTier`,
  // so the upload flow is paid-ops and its trigger has to mirror the
  // subscription gate (#841). Browsing, searching, and the signed download
  // link are reads — `enforceSubscription` returns early for GET, so they
  // stay live.
  const gate = useSubscriptionGate();
  // Read after an await (the delete confirm), when the render's `gate` may be
  // stale: the chapter can lapse while the dialog is open.
  const gateRef = useRef(gate);
  useEffect(() => {
    gateRef.current = gate;
  });
  const { isOffline } = useNetwork();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);

  const [query, setQuery] = useState("");
  // Typing stays responsive on a big library: the ranking re-runs at a lower
  // priority than the keystroke that asked for it.
  const deferredQuery = useDeferredValue(query);
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  // A set, not one slot: two downloads in flight must not clear each other's
  // spinner.
  const [downloading, setDownloading] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // Unfiltered on purpose: the library comes back in one unpaginated response
  // and every filter and search below runs on it in memory. Past
  // `BACKWORK_LIST_CAP` rows the response is truncated, which the page says
  // (#3525).
  const resourcesQuery = useBackworkResources();
  const departmentsQuery = useDepartments();
  const professorsQuery = useProfessors();
  // Course names are extra: a failed read leaves rows on their department
  // name rather than failing the page.
  const coursesQuery = useBackworkCourses();
  const fetchResource = useFetchBackworkResource();
  const fetchDownloadUrls = useFetchBackworkDownloadUrls();
  // Files fetched so far while a zip builds; null when none is building.
  const [zipping, setZipping] = useState<{ done: number; total: number } | null>(
    null,
  );
  const zipAbort = useRef<AbortController | null>(null);
  // Leaving the page stops a zip mid-way rather than saving it later.
  useEffect(() => () => zipAbort.current?.abort(), []);
  const deleteResource = useDeleteBackworkResource();
  const { data: permissionsPayload } = useMyPermissions();
  const isAdmin = can("backwork:admin", permissionsPayload?.permissions);
  const canUpload = can("backwork:upload", permissionsPayload?.permissions);
  const taxonomy = useBackworkTaxonomyActions(gate);
  const courseDialog = useBackworkCourseDialog(gate, isAdmin);
  const { confirm, confirmDialog } = useConfirmDialog();
  const router = useRouter();

  function sendToBulkUpload(collected: CollectedFiles) {
    if (collected.files.length === 0) {
      const { skipped, unreadable = 0 } = collected;
      toast({
        title: "No PDFs added",
        description:
          unreadable > 0
            ? "Your device didn't let the browser read what you dropped. Try choosing the files instead."
            : skipped > 0
              ? "Bulk upload takes PDFs. Use Upload for other file types."
              : "There were no files in what you dropped.",
      });
      return;
    }
    stageBulkUpload(collected);
    router.push("/backwork/upload");
  }

  const rows = useMemo(
    () =>
      toLibraryRows(
        asArray<BackworkResource>(resourcesQuery.data),
        asArray<BackworkDepartment>(departmentsQuery.data),
        asArray<BackworkProfessor>(professorsQuery.data),
        asArray<BackworkCourse>(coursesQuery.data),
      ),
    [resourcesQuery.data, departmentsQuery.data, professorsQuery.data, coursesQuery.data],
  );
  const options = useMemo(() => filterOptions(rows), [rows]);
  // A filter whose value no row has any more (a merge from a row menu deleted
  // the professor it named) drops out instead of emptying the list.
  const applied = useMemo(
    () => liveFilters(filters, options),
    [filters, options],
  );
  const results = useMemo(
    () => queryLibrary(rows, deferredQuery, applied),
    [rows, deferredQuery, applied],
  );
  // Write the pruned value back, so the dropped filter stays dropped instead
  // of returning on its own when a file with that value comes back later.
  // Set during render (React's "adjusting state when a prop changes"), so the
  // stale value never paints.
  if (applied !== filters && rows.length > 0) setFilters(applied);
  const narrowed = deferredQuery.trim() !== "" || hasActiveFilters(applied);
  const truncated = rows.length >= BACKWORK_LIST_CAP;

  function setFilter(key: ChipKey, value: string | null) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function clearAll() {
    setFilters(NO_FILTERS);
    setQuery("");
  }

  async function download(row: LibraryRow) {
    const id = row.resource.id;
    setDownloading((prev) => new Set(prev).add(id));
    try {
      const url = selectDownloadUrl(await fetchResource(row.resource.id));
      if (!url) throw new Error("No download URL returned.");
      // A new tab, not this one: the link forces a download (#3867), but a
      // server from before it signs an inline link, and a storage error
      // answers with a page of its own. Either would replace the library.
      window.open(url, "_blank", "noopener");
    } catch (error) {
      toast({
        title: "Couldn't fetch download link",
        description: getErrorMessage(
          error,
          "Try again in a moment.",
        ),
        variant: "destructive",
      });
    } finally {
      setDownloading((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  /**
   * Zips what the search and filters narrowed the list to (`backwork-zip.ts`
   * has the caps and why the size one is checked here).
   */
  async function downloadZip(zipRows: readonly LibraryRow[]) {
    const controller = new AbortController();
    zipAbort.current = controller;
    setZipping({ done: 0, total: zipRows.length });
    try {
      const names = zipEntryNames(
        zipRows.map((row) => ({
          title: row.title,
          storagePath: row.resource.storage_path,
        })),
      );
      const signed = await fetchDownloadUrls(
        zipRows.map((row) => row.resource.id),
      );
      const urlById = new Map(signed.map((file) => [file.id, file.download_url]));
      const result = await buildBackworkZip(
        zipRows.map((row, index) => ({
          name: names[index] ?? row.title,
          url: urlById.get(row.resource.id) ?? null,
        })),
        {
          signal: controller.signal,
          onProgress: (done, total) => setZipping({ done, total }),
        },
      );
      saveBlob(result.blob, `backwork-${new Date().toISOString().slice(0, 10)}.zip`);
      if (result.missed > 0) {
        toast({
          title: `Zipped ${result.added} of ${zipRows.length} files`,
          description: `${result.missed} couldn't be downloaded. Try them one at a time.`,
        });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      toast({
        title: "Couldn't make the zip",
        description:
          error instanceof ZipTooLargeError
            ? `These files add up to more than ${MAX_BACKWORK_ZIP_LABEL}. Narrow the search, or download them one at a time.`
            : getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    } finally {
      if (zipAbort.current === controller) {
        zipAbort.current = null;
        setZipping(null);
      }
    }
  }

  async function removeFile(row: LibraryRow) {
    const ok = await confirm({
      title: `Delete "${row.title}"?`,
      description:
        "The file is removed from the library for everyone in the chapter. This cannot be undone.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    if (!gateRef.current.allowed) {
      toast({
        title: "Couldn't delete the file",
        description: gateRef.current.isOffline
          ? "You're offline. Reconnect, then try again."
          : "This chapter can't make changes right now. The notice above says why.",
        variant: "destructive",
      });
      return;
    }
    try {
      await deleteResource.mutateAsync(row.resource.id);
      toast({ title: `Deleted "${row.title}"` });
    } catch (error) {
      toast({
        title: "Couldn't delete the file",
        description: getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    }
  }

  function rowEntries(row: LibraryRow): RowMenuEntry[] {
    const { course, professor, department } = row;
    // Rename, merge and delete are paid-ops writes like upload, so they go
    // dark with it on a lapsed chapter; the notice under the toolbar says why.
    const writeBlocked = !gate.allowed;
    const describedBy = gate.controlProps()["aria-describedby"];
    const entries: RowMenuEntry[] = [
      {
        type: "item",
        key: "download",
        label: "Download",
        icon: Download,
        disabled: downloading.has(row.resource.id),
        onSelect: () => void download(row),
      },
    ];
    if (course) {
      entries.push({
        type: "item",
        key: "only-course",
        label: `Show only ${course}`,
        icon: Filter,
        onSelect: () => setFilter("course", course),
      });
    }
    if (professor) {
      entries.push({
        type: "item",
        key: "only-professor",
        label: `Show only ${professor.name}`,
        icon: Filter,
        onSelect: () => setFilter("professorId", professor.id),
      });
    }
    let nameCourse: RowMenuEntry | null = null;
    // Uploaders name an unnamed course and add nicknames to a named one; an
    // admin may also rename (#3848; the rule is the API's
    // `courseEditRefusal`, and the dialog shows a member a set name
    // read-only).
    const courseNumber = row.resource.course_number?.trim();
    const courseName = row.courseEntry?.name;
    // Not until the course list has loaded: before then a named course looks
    // unnamed, and the entry and its dialog would offer the wrong thing.
    if (
      courseDialog.ready &&
      department &&
      course &&
      courseNumber &&
      (isAdmin || canUpload)
    ) {
      nameCourse = {
        type: "item",
        key: "name-course",
        disabled: writeBlocked,
        describedBy,
        label: !courseName
          ? `Name the ${course} course…`
          : isAdmin
            ? `Rename the ${course} course…`
            : `Add a nickname for ${course}…`,
        icon: Pencil,
        onSelect: () =>
          courseDialog.requestCourseName({
            departmentId: department.id,
            courseNumber,
            label: course,
          }),
      };
    }
    if (!isAdmin) {
      if (nameCourse) {
        entries.push({ type: "separator", key: "officer-sep" }, nameCourse);
      }
      return entries;
    }

    const officer: RowMenuEntry[] = [];

    if (professor) {
      officer.push(
        {
          type: "item",
          key: "rename-professor",
          disabled: writeBlocked,
          describedBy,
          label: `Rename ${professor.name}…`,
          icon: Pencil,
          onSelect: () =>
            taxonomy.requestRename({
              entity: "professor",
              id: professor.id,
              label: professor.name,
              current: professor.name,
            }),
        },
        {
          type: "item",
          key: "merge-professor",
          disabled: writeBlocked,
          describedBy,
          label: `Merge ${professor.name} into…`,
          icon: Merge,
          onSelect: () =>
            taxonomy.requestMerge({
              entity: "professor",
              id: professor.id,
              label: professor.name,
            }),
        },
      );
    }
    if (nameCourse) officer.push(nameCourse);
    if (department) {
      officer.push(
        {
          type: "item",
          key: "rename-department",
          disabled: writeBlocked,
          describedBy,
          label: `Name the ${department.code} department…`,
          icon: Pencil,
          onSelect: () =>
            taxonomy.requestRename({
              entity: "department",
              id: department.id,
              label: department.code,
              current: department.name ?? "",
            }),
        },
        {
          type: "item",
          key: "merge-department",
          disabled: writeBlocked,
          describedBy,
          label: `Merge ${department.code} into…`,
          icon: Merge,
          onSelect: () =>
            taxonomy.requestMerge({
              entity: "department",
              id: department.id,
              label: department.code,
            }),
        },
      );
    }
    if (officer.length) {
      entries.push({ type: "separator", key: "officer-sep" }, ...officer);
    }
    entries.push(
      { type: "separator", key: "delete-sep" },
      {
        type: "item",
        key: "delete",
        label: "Delete file…",
        icon: Trash2,
        destructive: true,
        disabled: writeBlocked,
        describedBy,
        onSelect: () => void removeFile(row),
      },
    );
    return entries;
  }

  // `useBackworkResources` is `enabled: !!chapterId`, and a disabled TanStack
  // query stays `pending` forever rather than resolving. Without this the
  // spinner below never stops for a member with no active chapter — it is not
  // loading, it is waiting for something that will never arrive. Every hook
  // above must run before this return, hence its position (#873).
  if (!activeChapterId) {
    return (
      <div className="space-y-6">
        <InlineNote>Pick a chapter to browse its backwork.</InlineNote>
      </div>
    );
  }

  const count = results.length;
  // No count before the read answers: "0 files" over the loading rows is a
  // claim about the archive.
  const countLabel =
    resourcesQuery.data === undefined
      ? null
      : narrowed
        ? `${count} of ${rows.length} file${rows.length === 1 ? "" : "s"}`
        : `${count} file${count === 1 ? "" : "s"}`;

  return (
    // A container (#4022): beside chat (#3779) the page is narrow while the
    // window is wide, so the table counts the page's own width.
    <div className="@container space-y-3">
      <section
        aria-label="Search and filter backwork"
        className="flex flex-wrap items-center gap-2"
      >
        {/* The shared toolbar search recipe, as on `/documents`. */}
        <div className="relative min-w-[220px] flex-[1_1_280px]">
          <SearchGlyph className={dashboardToolbarSearchGlyphClassName} />
          <Input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
            aria-label="Search backwork"
            placeholder="Search titles, courses, professors, tags"
            autoComplete="off"
            spellCheck={false}
            className={cn(dashboardToolbarSearchClassName, query && "pr-10")}
          />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => setQuery("")}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {CHIPS.map((chip) => (
            <FilterChip
              key={chip.key}
              label={chip.label}
              anyLabel={chip.anyLabel}
              options={options[OPTION_FOR[chip.key]]}
              value={applied[chip.key]}
              onChange={(value) => setFilter(chip.key, value)}
            />
          ))}
          {narrowed ? (
            <Button
              type="button"
              variant="ghost"
              size="toolbar"
              onClick={clearAll}
            >
              Clear
            </Button>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span
            className="whitespace-nowrap text-caption tabular-nums text-muted-foreground"
            aria-live="polite"
          >
            {countLabel}
          </span>
          {/*
            The zip shows only once a search or filter has narrowed the list,
            so nobody pulls the whole archive (`backwork-zip.ts`).
          */}
          {narrowed && count > 0 ? (
            <IconButton
              type="button"
              variant="secondary"
              // The reason it's off goes in the label, not only the hover
              // title, so a touch or screen-reader member hears it too.
              label={
                zipping
                  ? `Zipping ${zipping.done} of ${zipping.total} files`
                  : count > MAX_BACKWORK_ZIP_FILES
                    ? `Narrow the list to ${MAX_BACKWORK_ZIP_FILES} files or fewer to download a zip`
                    : `Download ${count} file${count === 1 ? "" : "s"} as a zip`
              }
              disabled={zipping !== null || count > MAX_BACKWORK_ZIP_FILES}
              onClick={() => void downloadZip(results.map((result) => result.item))}
            >
              {zipping ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <FileArchive className="h-4 w-4" aria-hidden="true" />
              )}
            </IconButton>
          ) : null}
          <Can permission="backwork:admin">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="toolbar"
                  className="w-9 px-0 pointer-coarse:w-11"
                  aria-label="More backwork options"
                  title="More"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[260px]">
                <DropdownMenuItem
                  disabled={!gate.allowed}
                  aria-describedby={gate.controlProps()["aria-describedby"]}
                  onSelect={() => setCleanupOpen(true)}
                >
                  <Pencil aria-hidden="true" />
                  Clean up professors and departments
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Portaled, so it can live beside the menu that opens it. */}
            <BackworkTaxonomyDrawer
              open={cleanupOpen}
              onOpenChange={setCleanupOpen}
              gate={gate}
            />
          </Can>
          <Can permission="backwork:upload">
            <Button asChild size="toolbar" variant="secondary" className="gap-2">
              <Link href="/backwork/upload">
                <FolderUp className="h-4 w-4" aria-hidden="true" /> Bulk upload
              </Link>
            </Button>
          </Can>
          <Can permission="backwork:upload">
            <BackworkUploadSheet gate={gate}>
              <Button
                type="button"
                size="toolbar"
                className="gap-2"
                {...gate.controlProps()}
              >
                Upload
              </Button>
            </BackworkUploadSheet>
          </Can>
        </div>
      </section>

      {/*
        Disable, don't hide (§5 rule 4): the library stays browsable and
        downloadable on a lapsed chapter, so only its writes go dark, and they
        explain themselves here. Silent offline on purpose: this explains a
        disabled control and has nothing of its own to retry
        (`can-fallback.spec.tsx`). Officers see it too: their row-menu rename,
        merge and delete are paid-ops writes that go dark with upload.
      */}
      <Can
        anyOf={["backwork:upload", "backwork:admin"]}
        offlineFallback={null}
      >
        <SubscriptionNotice gate={gate} feature="uploading or changing backwork" />
      </Can>

      {/*
        The drop strip: PDFs dropped or picked here go to bulk upload, where
        each is described and, for a Student Copy, blacked out on the device
        before it uploads (`handoff.ts`).
      */}
      <Can permission="backwork:upload">
        <BulkDropZone
          variant="strip"
          onFiles={sendToBulkUpload}
          disabled={!gate.allowed}
          describedBy={gate.controlProps()["aria-describedby"]}
          onRefusedDrop={() =>
            toast({
              title: "Couldn't add those files",
              description: gate.isOffline
                ? "You're offline. Reconnect, then try again."
                : "This chapter can't upload right now. The notice above says why.",
            })
          }
        />
      </Can>

      {truncated ? (
        <p className="text-caption text-muted-foreground" role="status">
          Showing the newest {BACKWORK_LIST_CAP.toLocaleString("en-US")} files.
          Search and filters look only at these for now.
        </p>
      ) : null}

      <section aria-label="Backwork files">
        {/*
          The offline branch comes first, because a paused query is
          `isPending` and would otherwise spin behind an offline member
          indefinitely (README §4 item 4), but only when there is nothing
          loaded: §10 keeps stale content in place on a refetch. `isPending &&
          paused` is README §4's "offline, no cached data"; a paused
          background refetch keeps its rows (#872 / #873).
        */}
        {isOffline && rows.length === 0 ? (
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
            resourcesQuery.fetchStatus === "paused") ||
          // Rows join departments and professors on the client; without them
          // a course reads as a bare number and search misses "cogs". Course
          // names are not waited on: rows show the department's name until
          // they arrive.
          (rows.length > 0 && (departmentsQuery.isLoading || professorsQuery.isLoading)) ? (
          <BackworkRowsSkeleton />
        ) : resourcesQuery.isError ||
          departmentsQuery.isError ||
          professorsQuery.isError ? (
          <NestedError
            sole
            title="Couldn't load backwork"
            description={describeLoadFailure(
              resourcesQuery.error ??
                departmentsQuery.error ??
                professorsQuery.error,
            )}
            onRetry={() => {
              void resourcesQuery.refetch();
              void departmentsQuery.refetch();
              void professorsQuery.refetch();
            }}
          />
        ) : rows.length === 0 ? (
          <InlineNote>No backwork yet.</InlineNote>
        ) : count === 0 ? (
          <InlineNote>
            No files match.{" "}
            <InlineNoteAction onClick={clearAll}>
              Clear search and filters
            </InlineNoteAction>
          </InlineNote>
        ) : (
          <>
            <div
              aria-hidden="true"
              className={cn(
                "hidden gap-3 px-2 pb-1.5 text-caption font-semibold uppercase tracking-[0.06em] text-muted @4xl:grid",
                ROW_GRID,
              )}
            >
              <span>Type</span>
              <span>Title and course</span>
              <span>Professor</span>
              <span>Term</span>
              <span>Copy</span>
              <span>Added</span>
              <span />
            </div>
            <ul className={denseListClassName}>
              {/* eslint-disable-next-line react-hooks/refs -- `rowEntries` closes over `removeFile`, which reads `gateRef` after its confirm resolves, not during render */}
              {results.map(({ item: row, hits, nickname, courseHits: nameHits }) => (
                <RowMenu
                  key={row.resource.id}
                  entries={rowEntries(row)}
                  label={`More for ${row.title}`}
                >
                  {(menuButton) => (
                    <li
                      className={cn(
                        "group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-2 py-2 hover:bg-card data-[state=open]:bg-card",
                        "@4xl:min-h-12",
                        ROW_GRID,
                      )}
                    >
                      <div className="min-w-0 @4xl:order-2">
                        <p className="truncate text-sm font-semibold">
                          <Highlighted text={row.title} hits={hits} />
                        </p>
                        <p className="truncate text-caption text-muted-foreground">
                          {row.course ? (
                            <Highlighted
                              text={row.course}
                              hits={courseHits(row, hits)}
                              className="font-mono text-caption tracking-[0.02em] text-foreground"
                            />
                          ) : null}
                          {row.courseLabel ? (
                            <>
                              {row.course ? " · " : null}
                              <Highlighted
                                text={row.courseLabel}
                                hits={[...hits, ...nameHits]}
                              />
                            </>
                          ) : null}
                          {nickname ? (
                            <span className="text-muted">
                              {" ("}
                              <Highlighted
                                text={nickname}
                                hits={nameHits}
                              />
                              {")"}
                            </span>
                          ) : null}
                          {row.resource.tags?.length ? (
                            <>
                              {row.course || row.courseLabel
                                ? " · "
                                : null}
                              <Highlighted
                                text={row.resource.tags.join(", ")}
                                hits={hits}
                              />
                            </>
                          ) : null}
                        </p>
                      </div>
                      <div className="col-start-1 row-start-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground @4xl:contents">
                        <span className="@4xl:order-1 @4xl:min-w-0">
                          <TypeTag type={row.resource.assignment_type} />
                        </span>
                        {row.professor ? (
                          <span className="truncate @4xl:order-3 @4xl:text-sm">
                            <Highlighted
                              text={row.professor.name}
                              hits={hits}
                            />
                          </span>
                        ) : (
                          <span className="hidden @4xl:order-3 @4xl:block" />
                        )}
                        <span className="whitespace-nowrap tabular-nums text-foreground @4xl:order-4 @4xl:text-sm">
                          {row.term ? (
                            <Highlighted text={row.term} hits={hits} />
                          ) : null}
                        </span>
                        <span className="@4xl:order-5">
                          <CopyLabel
                            variant={row.resource.document_variant}
                            redacted={row.resource.is_redacted}
                          />
                        </span>
                        <span className="whitespace-nowrap tabular-nums @4xl:order-6">
                          <span className="@4xl:hidden">Added </span>
                          {formatDay(row.resource.created_at) ?? ""}
                        </span>
                      </div>
                      <div className="col-start-2 row-span-2 row-start-1 flex items-center justify-end gap-0.5 @4xl:order-7 @4xl:col-start-auto @4xl:row-span-1 @4xl:row-start-auto">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className={compactControlClassName}
                          aria-label={`Download ${row.title}`}
                          title="Download"
                          disabled={downloading.has(row.resource.id)}
                          onClick={() => void download(row)}
                        >
                          {downloading.has(row.resource.id) ? (
                            <Loader2
                              className="h-4 w-4 animate-spin"
                              aria-hidden="true"
                            />
                          ) : (
                            <Download className="h-4 w-4" aria-hidden="true" />
                          )}
                        </Button>
                        {menuButton}
                      </div>
                    </li>
                  )}
                </RowMenu>
              ))}
            </ul>
          </>
        )}
      </section>

      {taxonomy.dialogs}
      {courseDialog.dialog}
      {confirmDialog}
    </div>
  );
}
