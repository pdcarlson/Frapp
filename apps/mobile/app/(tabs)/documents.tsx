import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
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
import { UploadGlyph } from "@/components/documents/document-glyphs";
import { UploadDocumentSheet } from "@/components/documents/upload-document-sheet";
import { FilterChips, SearchField } from "@/components/filter-chips";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import { DocumentsGlyph } from "@/components/more/more-glyphs";
import { SearchGlyph } from "@/components/search-glyph";
import {
  EmptyState,
  ErrorState,
  SkeletonLines,
} from "@/components/state-block";
import {
  selectDocumentFolders,
  selectDocumentRows,
  selectDownloadUrl,
} from "@/lib/more/documents";
import { useChapterBranding } from "@/lib/chapter-branding";
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
 * Canvas draws an upload glyph at the far end of the `‹ More` row, opening the
 * s21 sheet (`components/documents/upload-document-sheet.tsx`, #3399). It is
 * drawn only for a viewer who holds `chapter_docs:upload`, the permission both
 * upload routes carry, as web's `<Can permission="chapter_docs:upload">` does:
 * by default that is the President alone (`DEFAULT_SYSTEM_ROLES`), so most
 * members never see a control the server would refuse them. `can` reads the
 * owner's `*` the way the server's guard does. While the permission read is
 * loading the glyph is absent, which fails closed.
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
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);

  const [folder, setFolder] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);
  const [uploadedTitle, setUploadedTitle] = useState<string | null>(null);
  const uploadSheetRef = useRef<BottomSheetModal>(null);
  const canUpload = can("chapter_docs:upload", usePermissionList());
  const chapterId = useActiveChapterId();

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
  const refresh = useRefetchAll(
    [foldersQuery.refetch, documentsQuery.refetch],
    !!chapterId,
  );

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

  function renderList() {
    if (documentsQuery.isPending)
      return <SkeletonLines lines={4} tone="list" />;
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
    if (rows.length === 0) {
      return (
        // A title alone when the library or folder is empty: the screen is
        // the documents list, and a line saying so told the member nothing.
        // A search that matched nothing names the query, and the folder it
        // searched in when one is picked, since the search stays inside it.
        <EmptyState
          glyph={deferredSearch ? SearchGlyph : DocumentsGlyph}
          title={deferredSearch ? "No matches" : "Nothing filed here yet"}
          body={
            !deferredSearch
              ? undefined
              : folder
                ? `Nothing in ${folder} matches “${deferredSearch}”.`
                : `No document title matches “${deferredSearch}”.`
          }
        />
      );
    }
    return (
      <ListSection>
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
      backAction={
        canUpload ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Upload document"
            accessibilityHint="Opens a sheet to upload a photo to the library."
            hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
            onPress={() => {
              setUploadedTitle(null);
              uploadSheetRef.current?.present();
            }}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <UploadGlyph color={accent} />
          </Pressable>
        ) : undefined
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

      {uploadedTitle ? (
        <Text accessibilityRole="alert" style={styles.uploadedNote}>
          {`“${uploadedTitle}” is in the library.`}
        </Text>
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
          onUploaded={setUploadedTitle}
        />
      ) : null}
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    pressed: {
      opacity: 0.6,
    },
    uploadedNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.xs,
    },
    errorNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      paddingHorizontal: tokens.spacing.xs,
    },
  });
}
