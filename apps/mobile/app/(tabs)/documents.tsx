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
import { BACK_TO_MORE } from "@/components/back-row";
import { UploadGlyph } from "@/components/documents/document-glyphs";
import { UploadDocumentSheet } from "@/components/documents/upload-document-sheet";
import { FilterChips, SearchField } from "@/components/filter-chips";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
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

  const folders = useMemo(
    () => selectDocumentFolders(foldersQuery.data),
    [foldersQuery.data],
  );
  const rows = useMemo(
    () => selectDocumentRows(documentsQuery.data),
    [documentsQuery.data],
  );

  async function open(id: string) {
    // One at a time: iOS rejects a second presentation while one is showing,
    // which is a rejection worth not provoking rather than reporting.
    if (openingId) return;
    setOpenFailed(false);
    setOpeningId(id);
    try {
      const url = selectDownloadUrl(await openDocument.mutateAsync(id));
      if (!url) {
        setOpenFailed(true);
        return;
      }
      await WebBrowser.openBrowserAsync(url);
    } catch {
      setOpenFailed(true);
    } finally {
      setOpeningId(null);
    }
  }

  function renderList() {
    if (documentsQuery.isPending) return <SkeletonLines lines={4} />;
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
        <EmptyState
          glyph="⌸"
          title={deferredSearch ? "No matches" : "Nothing filed here yet"}
          body={
            deferredSearch
              ? `No document title matches “${deferredSearch}”.`
              : "Documents the chapter uploads show up here."
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
            disabled={openingId !== null}
            onPress={() => void open(row.id)}
          />
        ))}
      </ListSection>
    );
  }

  return (
    <ScreenShell
      back={BACK_TO_MORE}
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
          // A new sheet per chapter: a retry the sheet holds after a failed
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
