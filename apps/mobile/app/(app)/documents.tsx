import { useDeferredValue, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Alert, StyleSheet, Text, View } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import * as WebBrowser from "expo-web-browser";
import {
  useActiveChapterId,
  useDeleteDocument,
  useDocumentDownloadUrl,
  useDocumentFolders,
  useDocumentLibrary,
  useDocuments,
  useMemberDisplayNames,
  usePermissionList,
  useSemesters,
} from "@repo/hooks";
import {
  DELETE_DOCUMENT_BODY,
  DELETE_DOCUMENT_LABEL,
  DOCUMENT_CAP_NOTICE,
  SORT_OPTIONS,
  deleteDocumentTitle,
  isActiveDateFilter,
  type DocumentSort,
  type FileKind,
} from "@repo/hooks/document-library";
import { errorCopy } from "@repo/hooks/error-copy";
import { SignetTokens } from "@repo/theme/signet";
import { can } from "@repo/validation";
import { ScreenShell } from "@/components/screen-shell";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { BACK_TO_MORE } from "@/components/back-row";
import {
  UploadDocumentSheet,
  type PendingDocumentUpload,
} from "@/components/documents/upload-document-sheet";
import { Chip, FilterChips, SearchField } from "@/components/filter-chips";
import {
  ListRow,
  ListRowSkeleton,
  ListSection,
  SectionHeader,
} from "@/components/list-section";
import { InlineNote } from "@/components/inline-note";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import {
  documentMeta,
  selectDocumentFolders,
  selectDocuments,
  selectDownloadUrl,
} from "@/lib/more/documents";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s12 — Documents (`canvas-screens.dc.html:427`).
 *
 * ## No `NoChapterState` here, unlike its siblings
 *
 * `useDocuments` and `useDocumentFolders` are deliberately not gated on a
 * resolved `chapterId`: the route resolves the chapter from the request header,
 * and `ChapterGuard` auto-resolves a single-membership member server-side. So a
 * member with one chapter gets their real library even when the mobile client
 * has no `active_chapter_id` claim to read (no membership on the token yet,
 * or a hook-off incident — #805 itself is closed). Rendering "no chapter
 * selected" over that would contradict the folder chips sitting above it, and
 * point at a picker that would not change the outcome. A member who genuinely
 * has no resolvable chapter gets a `400` instead, which the error state covers.
 *
 * ## No PINNED section
 *
 * Canvas draws PINNED above RECENT. Nothing on `chapter_documents` marks a
 * document pinned, and promoting "the two newest" into that slot would dress an
 * arbitrary choice up as a chapter decision. Filed.
 *
 * ## Upload, for whoever may
 *
 * The floating create button (Upload document) opens the s21 sheet
 * (`components/documents/upload-document-sheet.tsx`, #3399). Canvas draws an
 * upload glyph at the far end of the `‹ More` row; it moved to the thumb's
 * reach on 2026-11-05 (`spec/ui/mobile/patterns.md` § Create actions). It is
 * drawn only for a viewer who holds `chapter_docs:upload`, the permission both
 * upload routes carry, as web's `<Can permission="chapter_docs:upload">` does:
 * by default that is the President alone (`DEFAULT_SYSTEM_ROLES`), so most
 * members never see a control the server would refuse them. `can` reads the
 * owner's `*` the way the server's guard does. While the permission read is
 * loading the button is absent, which fails closed.
 *
 * Photos only: a PDF needs `expo-document-picker`, a native module that waits
 * for a store build.
 *
 * ## Search, filters and sort, as web's (#3938)
 *
 * The screen reads the chapter's whole library once (`GET /v1/documents`
 * with no `search` or `folder`) and runs web's library logic over it
 * (`@repo/hooks/document-library`, the module `/documents` imports): the
 * folder chip, then a typo-tolerant search over title, description,
 * uploader, folder and type, the Uploaded by and Date added filters, and the
 * order, Name A–Z by default as on web. A File type filter (PDF, Word,
 * Slides, Spreadsheet, Image, Other) reads each file's declared type or its
 * stored extension, and search finds those words too. All of it is local, so a keystroke or
 * a chip re-ranks what is in hand, offline too. The filters and the order sit
 * behind one "Sort & filter" chip that opens a panel of chip rows under it,
 * as Directory's alumni Filters do. Web's custom date range is not offered: a
 * phone date picker is a native module that waits for a store build.
 *
 * ## Delete, for whoever may
 *
 * A viewer holding `chapter_docs:manage` (the guard on `DELETE
 * /v1/documents/{id}`) deletes a document by long-pressing its row, or
 * through the row's named screen-reader action, then confirming in a system
 * alert, as Invited's Revoke and chat's channel actions do. The row shows
 * its spinner while the request runs and takes no second press.
 *
 * ## Opening a document
 *
 * There is no separate download endpoint: `GET /v1/documents/{id}` returns the
 * document with a freshly signed `downloadUrl`. That read runs through a
 * *mutation* (`useDocumentDownloadUrl`) rather than a query, so a tap that
 * failed once reaches the network again on the next tap instead of replaying a
 * cached error — and the expiring URL never enters the cache. Note the key is
 * **`downloadUrl`**: there is no case-transforming interceptor anywhere in the
 * stack, and reading `download_url` is what left the two web call sites opening
 * `undefined` until #1040. `selectDownloadUrl` (`@repo/hooks`) accepts both
 * spellings and is the only place either appears *for a document download*.
 * Chat attachments are a different endpoint whose key genuinely is
 * `download_url` — do not converge them.
 */
export default function DocumentsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const [folder, setFolder] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  // The upload the sheet closed on, drawn as the list's first row until the
  // filed document arrives in the list's order (`UploadDocumentSheet` §
  // "Upload closes the sheet at once").
  // Held with the chapter it was sent from, so a chapter switch (which mounts
  // a new sheet) doesn't show the last chapter's upload in this one's list.
  const [pendingFor, setPendingFor] = useState<{
    chapterId: string | null;
    upload: PendingDocumentUpload | null;
  }>({ chapterId: null, upload: null });
  const uploadSheetRef = useRef<BottomSheetModal>(null);
  const canUpload = can("chapter_docs:upload", usePermissionList());
  const chapterId = useActiveChapterId();
  const pendingUpload =
    pendingFor.chapterId === (chapterId ?? null) ? pendingFor.upload : null;
  const setPendingUpload = (
    next:
      | PendingDocumentUpload
      | null
      | ((
          current: PendingDocumentUpload | null,
        ) => PendingDocumentUpload | null),
  ) =>
    setPendingFor((prev) => {
      const current =
        prev.chapterId === (chapterId ?? null) ? prev.upload : null;
      return {
        chapterId: chapterId ?? null,
        upload: typeof next === "function" ? next(current) : next,
      };
    });

  // Deferred, so a long library re-ranks behind the keystroke rather than
  // ahead of it, as web's does.
  const deferredSearch = useDeferredValue(search.trim());
  const [sort, setSort] = useState<DocumentSort>("name");
  const [pickedUploader, setPickedUploader] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<"semester" | "30d" | null>(null);
  const [kind, setKind] = useState<FileKind | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Deleted here and gone from the list at once: `useDeleteDocument`'s
  // invalidation re-reads the library without the mutation awaiting it, so
  // the row would otherwise sit there, pressable, until the re-read lands.
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Held with the chapter it failed in, as `pendingFor` is.
  const [deleteFailure, setDeleteFailure] = useState<{
    chapterId: string | null;
    message: string;
  } | null>(null);
  const canManage = can("chapter_docs:manage", usePermissionList());

  const foldersQuery = useDocumentFolders();
  const documentsQuery = useDocuments();
  const openDocument = useDocumentDownloadUrl();
  const deleteDocument = useDeleteDocument();
  const refresh = useRefetchAll([foldersQuery, documentsQuery]);

  const folders = useMemo(
    () => selectDocumentFolders(foldersQuery.data),
    [foldersQuery.data],
  );
  const documents = useMemo(
    () =>
      selectDocuments(documentsQuery.data).filter(
        (doc) => !removedIds.has(doc.id),
      ),
    [documentsQuery.data, removedIds],
  );
  const filters = useMemo(
    () => ({
      uploader: pickedUploader,
      date: datePreset === null ? null : { preset: datePreset },
      kind,
    }),
    [pickedUploader, datePreset, kind],
  );
  // Web's own hook (#3938): uploader names and the kept-pick rule, the
  // semester window, the ticking clock, the folder, then search, filters and
  // order.
  const {
    visible,
    uploaders,
    kinds,
    filters: applied,
    semesterKnown,
    filtering,
    truncated,
  } = useDocumentLibrary({
    documents,
    folder,
    search: deferredSearch,
    filters,
    sort,
    namesById: useMemberDisplayNames().byId,
    semesters: useSemesters().data,
  });
  const uploader = applied.uploader;
  const dateActive = isActiveDateFilter(applied.date, semesterKnown);
  const filterCount =
    (uploader !== null ? 1 : 0) +
    (dateActive ? 1 : 0) +
    (kind !== null ? 1 : 0) +
    (sort !== "name" ? 1 : 0);
  const deleteFailed =
    deleteFailure && deleteFailure.chapterId === (chapterId ?? null)
      ? deleteFailure.message
      : null;

  function clearFilters() {
    setSearch("");
    setPickedUploader(null);
    setDatePreset(null);
    setKind(null);
  }

  // The latest tap's number, and whether a browser is already on its way up.
  const latestOpen = useRef(0);
  const presenting = useRef(false);

  async function open(id: string) {
    // One browser at a time: iOS rejects a second presentation while one is
    // showing, which is a rejection worth not provoking rather than reporting.
    if (presenting.current) return;
    // Before that, the latest tap wins. A tap on another row while one is
    // still fetching its signed URL moves the spinner to that row, and the
    // earlier row's URL is dropped when it lands rather than opened over the
    // document the member asked for since.
    const tap = ++latestOpen.current;
    const isLatest = () => tap === latestOpen.current;
    setOpenFailed(false);
    setOpeningId(id);
    try {
      const url = selectDownloadUrl(await openDocument.mutateAsync(id));
      if (!isLatest()) return;
      if (!url) {
        setOpenFailed(true);
        return;
      }
      presenting.current = true;
      try {
        await WebBrowser.openBrowserAsync(url);
      } finally {
        presenting.current = false;
      }
    } catch {
      if (isLatest()) setOpenFailed(true);
    } finally {
      if (isLatest()) setOpeningId(null);
    }
  }

  // Filed: the pending row holds until the list has re-read, so the document
  // arrives as the row goes instead of a beat later. A later upload's row is left alone.
  function uploaded(title: string) {
    AccessibilityInfo.announceForAccessibility(`“${title}” is in the library.`);
    const filed = pendingUpload;
    void documentsQuery.refetch().finally(() => {
      setPendingUpload((current) =>
        current === filed || current?.title === title ? null : current,
      );
    });
  }

  function confirmDelete(id: string, title: string) {
    Alert.alert(
      deleteDocumentTitle(title),
      DELETE_DOCUMENT_BODY,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: DELETE_DOCUMENT_LABEL,
          style: "destructive",
          onPress: () => void remove(id, title),
        },
      ],
      { cancelable: true },
    );
  }

  async function remove(id: string, title: string) {
    setDeleteFailure(null);
    setDeletingIds((current) => new Set(current).add(id));
    try {
      await deleteDocument.mutateAsync(id);
      setRemovedIds((current) => new Set(current).add(id));
      AccessibilityInfo.announceForAccessibility(`“${title}” was deleted.`);
    } catch (caught) {
      // A refusal that names its reason (a read-only chapter, a file already
      // gone) says it; anything else is worth another try.
      setDeleteFailure({
        chapterId: chapterId ?? null,
        message: errorCopy(
          caught,
          `Couldn't delete “${title}”. Try again in a moment.`,
        ),
      });
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  // The upload in flight, or the one that failed, heading the list. Same two
  // lines as a document row; when it files, the row goes and the document
  // takes its place in the chosen order (Name A–Z by default, so usually not
  // the top). "Uploading…" is the quiet caption, no spinner. A failure says
  // so in the destructive hue and reopens the sheet, which kept the draft.
  const pendingRow = pendingUpload ? (
    <ListRow
      key="pending-upload"
      label={pendingUpload.title}
      description={
        pendingUpload.failed ? "Didn't upload. Tap to try again." : "Uploading…"
      }
      descriptionTone={pendingUpload.failed ? "destructive" : "default"}
      accessibilityHint={pendingUpload.failed ?? undefined}
      onPress={
        pendingUpload.failed
          ? () => uploadSheetRef.current?.present()
          : undefined
      }
    />
  ) : null;

  function renderList() {
    if (documentsQuery.isPending) {
      // Document rows in the list's own section: a title and its meta line.
      return (
        <SkeletonRegion label="Loading chapter documents">
          <ListSection>
            {Array.from({ length: 4 }, (_, index) => (
              <ListRowSkeleton key={index} index={index} description />
            ))}
          </ListSection>
        </SkeletonRegion>
      );
    }
    if (documentsQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load documents"
          body="If you belong to more than one chapter, pick one from More → Switch chapter first."
          onRetry={() => void documentsQuery.refetch()}
          isRetrying={documentsQuery.isFetching}
        />
      );
    }
    if (visible.length === 0 && !pendingRow) {
      // Empty-states plan rule 7: one line where the rows would be. A search
      // or filter that matched nothing says so and offers the way out: inside
      // a folder chip, widening to every folder (the search and filters
      // stay); otherwise clearing them, as web's Clear filters does.
      // Uploading lives on the screen's + (writing.md § Chapter Documents).
      if (filtering) {
        const what = deferredSearch ? `“${deferredSearch}”` : "these filters";
        return folder ? (
          <InlineNote
            action={{
              label: "Search all files",
              onPress: () => setFolder(null),
            }}
          >
            {`Nothing in ${folder} matches ${what}.`}
          </InlineNote>
        ) : (
          <InlineNote
            action={{
              label:
                deferredSearch &&
                uploader === null &&
                !dateActive &&
                kind === null
                  ? "Clear search"
                  : "Clear filters",
              onPress: clearFilters,
            }}
          >
            {`No documents match ${what}.`}
          </InlineNote>
        );
      }
      return (
        <InlineNote>
          {folder ? `Nothing in ${folder} yet.` : "No documents yet."}
          {canUpload ? " Tap + to upload one." : null}
        </InlineNote>
      );
    }
    return (
      <ListSection>
        {pendingRow}
        {visible.map((row) => (
          <ListRow
            key={row.doc.id}
            label={row.doc.title}
            description={documentMeta(row)}
            accessibilityHint="Opens in your browser."
            // Only the row being opened, or deleted, shows it. The others
            // stay as they are and take a tap, which moves the spinner to
            // them (`open`).
            busy={row.doc.id === openingId || deletingIds.has(row.doc.id)}
            onPress={() => void open(row.doc.id)}
            onLongPress={
              canManage
                ? () => confirmDelete(row.doc.id, row.doc.title)
                : undefined
            }
            longPressLabel={canManage ? "Delete document" : undefined}
          />
        ))}
      </ListSection>
    );
  }

  const filtersChip = (
    <Chip
      accessibilityRole="button"
      accessibilityState={{ expanded: panelOpen }}
      accessibilityLabel={
        filterCount > 0
          ? `Sort and filter, ${filterCount} set`
          : "Sort and filter"
      }
      label={
        filterCount > 0 ? `Sort & filter · ${filterCount}` : "Sort & filter"
      }
      on={panelOpen}
      onPress={() => setPanelOpen((open) => !open)}
    />
  );

  return (
    <ScreenShell
      back={BACK_TO_MORE}
      refresh={refresh}
      createAction={
        canUpload
          ? {
              label: "Upload document",
              hint: "Opens a sheet to upload a photo to the library.",
              onPress: () => uploadSheetRef.current?.present(),
            }
          : undefined
      }
      title="Documents"
    >
      <SearchField
        value={search}
        onChangeText={setSearch}
        placeholder="Search documents"
        accessibilityLabel="Search documents"
      />

      {folders.length > 0 ? (
        <FilterChips
          accessibilityLabel="Filter by folder"
          scroll
          selected={folder}
          onSelect={setFolder}
          chips={[
            { value: null, label: "All" },
            ...folders.map((entry) => ({
              value: entry.name,
              label: entry.name,
            })),
          ]}
          trailing={filtersChip}
        />
      ) : (
        <View style={styles.chipAlone}>{filtersChip}</View>
      )}

      {panelOpen ? (
        <View style={styles.panel}>
          <Text style={styles.panelLabel}>Sort</Text>
          <FilterChips
            accessibilityLabel="Sort documents"
            scroll
            selected={sort}
            onSelect={(value) =>
              setSort((value as DocumentSort | null) ?? "name")
            }
            chips={SORT_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
          />
          {uploaders.length > 0 ? (
            <>
              <Text style={styles.panelLabel}>Uploaded by</Text>
              <FilterChips
                accessibilityLabel="Filter by uploader"
                scroll
                selected={uploader}
                onSelect={setPickedUploader}
                chips={[{ value: null, label: "Anyone" }, ...uploaders]}
              />
            </>
          ) : null}
          <Text style={styles.panelLabel}>Date added</Text>
          <FilterChips
            accessibilityLabel="Filter by date added"
            scroll
            selected={datePreset}
            onSelect={(value) =>
              setDatePreset(value as "semester" | "30d" | null)
            }
            chips={[
              { value: null, label: "Any time" },
              // Offered once the archives have loaded, as on web.
              ...(semesterKnown
                ? [{ value: "semester", label: "This semester" }]
                : []),
              { value: "30d", label: "Last 30 days" },
            ]}
          />
          {kinds.length > 0 ? (
            <>
              <Text style={styles.panelLabel}>File type</Text>
              <FilterChips
                accessibilityLabel="Filter by file type"
                scroll
                selected={kind}
                onSelect={(value) => setKind(value as FileKind | null)}
                chips={[{ value: null, label: "Any type" }, ...kinds]}
              />
            </>
          ) : null}
        </View>
      ) : null}

      {openFailed ? (
        <Text style={styles.errorNote}>
          That document couldn&apos;t be opened. Try again in a moment.
        </Text>
      ) : null}
      {deleteFailed ? (
        <Text accessibilityLiveRegion="polite" style={styles.errorNote}>
          {deleteFailed}
        </Text>
      ) : null}
      {truncated && !documentsQuery.isError ? (
        <InlineNote>{DOCUMENT_CAP_NOTICE}</InlineNote>
      ) : null}

      <SectionHeader>
        {documentsQuery.isSuccess
          ? `${visible.length} ${visible.length === 1 ? "document" : "documents"}`
          : "Documents"}
      </SectionHeader>
      {renderList()}

      {canUpload ? (
        <UploadDocumentSheet
          // A new sheet per chapter: a kept draft belongs to the chapter it
          // was started in, and a retry the sheet holds after a failed
          // confirm names a path minted under the chapter it was sent from.
          key={chapterId ?? "no-chapter"}
          ref={uploadSheetRef}
          folders={folders}
          initialFolder={folder}
          onUploaded={uploaded}
          onPending={setPendingUpload}
        />
      ) : null}
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    chipAlone: {
      flexDirection: "row",
    },
    panel: {
      gap: tokens.spacing.xs,
    },
    panelLabel: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      paddingHorizontal: tokens.spacing.xs,
    },
    errorNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      paddingHorizontal: tokens.spacing.xs,
    },
  });
}
