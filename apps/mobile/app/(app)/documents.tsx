import { useDeferredValue, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text } from "react-native";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import * as WebBrowser from "expo-web-browser";
import {
  useActiveChapterId,
  useDocumentDownloadUrl,
  useDocumentFolders,
  useDocuments,
  usePermissionList,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { can } from "@repo/validation";
import { ScreenShell } from "@/components/screen-shell";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { BACK_TO_MORE } from "@/components/back-row";
import {
  UploadDocumentSheet,
  type PendingDocumentUpload,
} from "@/components/documents/upload-document-sheet";
import { FilterChips, SearchField } from "@/components/filter-chips";
import {
  ListRow,
  ListRowSkeleton,
  ListSection,
  SectionHeader,
} from "@/components/list-section";
import { InlineNote } from "@/components/inline-note";
import { ErrorState, SkeletonRegion } from "@/components/state-block";
import {
  selectDocumentFolders,
  selectDocumentRows,
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
  // filed document takes its place (`UploadDocumentSheet` § "Upload closes
  // the sheet at once").
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

  // Deferred, like s13's: `search` is in the query key, so feeding raw
  // keystrokes would mint a cache entry and fire a request per character, and
  // blank the list to a skeleton each time.
  const deferredSearch = useDeferredValue(search.trim());

  const foldersQuery = useDocumentFolders();
  const documentsQuery = useDocuments({
    folder: folder ?? undefined,
    search: deferredSearch || undefined,
  });
  const openDocument = useDocumentDownloadUrl();
  const refresh = useRefetchAll([foldersQuery, documentsQuery]);

  const folders = useMemo(
    () => selectDocumentFolders(foldersQuery.data),
    [foldersQuery.data],
  );
  const rows = useMemo(
    () => selectDocumentRows(documentsQuery.data),
    [documentsQuery.data],
  );

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
  // replaces it in the same slot (newest first) instead of the row going and
  // the document arriving a beat later. A later upload's row is left alone.
  function uploaded(title: string) {
    AccessibilityInfo.announceForAccessibility(`“${title}” is in the library.`);
    const filed = pendingUpload;
    void documentsQuery.refetch().finally(() => {
      setPendingUpload((current) =>
        current === filed || current?.title === title ? null : current,
      );
    });
  }

  // The upload in flight, or the one that failed, in the slot the document
  // will take. Same two lines as a document row, so nothing moves when it is
  // replaced; "Uploading…" is the quiet caption, no spinner. A failure says
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
    if (rows.length === 0 && !pendingRow) {
      // Empty-states plan rule 7: one line where the rows would be. A search
      // that matched nothing names the query and offers the way out: inside a
      // folder chip, widening to every folder (the search stays); otherwise
      // clearing it. Uploading lives on the screen's + (writing.md § Chapter
      // Documents).
      if (deferredSearch) {
        return folder ? (
          <InlineNote
            action={{
              label: "Search all files",
              onPress: () => setFolder(null),
            }}
          >
            {`Nothing in ${folder} matches “${deferredSearch}”.`}
          </InlineNote>
        ) : (
          <InlineNote
            action={{ label: "Clear search", onPress: () => setSearch("") }}
          >
            {`No documents match “${deferredSearch}”.`}
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
        {rows.map((row) => (
          <ListRow
            key={row.id}
            label={row.title}
            description={row.meta}
            accessibilityHint="Opens in your browser."
            // Only the row being opened shows it. The others stay as they
            // are and take a tap, which moves the spinner to them (`open`).
            busy={row.id === openingId}
            onPress={() => void open(row.id)}
          />
        ))}
      </ListSection>
    );
  }

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
        accessibilityLabel="Search documents by title"
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
        />
      ) : null}

      {openFailed ? (
        <Text style={styles.errorNote}>
          That document couldn&apos;t be opened. Try again in a moment.
        </Text>
      ) : null}

      <SectionHeader>Recent</SectionHeader>
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
    errorNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      paddingHorizontal: tokens.spacing.xs,
    },
  });
}
