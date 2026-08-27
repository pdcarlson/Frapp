import { useDeferredValue, useMemo, useState } from "react";
import { StyleSheet, Text } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  useDocumentDownloadUrl,
  useDocumentFolders,
  useDocuments,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { FilterChips, SearchField } from "@/components/filter-chips";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import { EmptyState, ErrorState, SkeletonLines } from "@/components/state-block";
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
 * member with one chapter gets their real library even though the mobile client
 * has no `active_chapter_id` claim to read (#805). Rendering "no chapter
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
 * ## No upload affordance
 *
 * Canvas draws an upload glyph in the header, opening the s21 sheet. Uploading
 * needs a file picker, and none is a dependency of this app — `package.json` is
 * frozen under #937's hotspot protocol, so adding one is an integrator PR. The
 * glyph is omitted rather than rendered dead. Filed.
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
 * `undefined` until #1040. `selectDownloadUrl` (now in `@repo/hooks`, beside the
 * query that returns the payload) accepts both spellings and is the only place
 * either appears.
 */
export default function DocumentsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const [folder, setFolder] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);

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
          body="If you belong to more than one chapter, pick one from More → Chapter first."
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
              : "Documents uploaded on the web dashboard show up here."
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
    <ScreenShell title="Documents" subtitle="The chapter's document library.">
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

      {openFailed ? (
        <Text style={styles.errorNote}>
          That document couldn&apos;t be opened. Try again in a moment.
        </Text>
      ) : null}

      <SectionHeader>Recent</SectionHeader>
      {renderList()}
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
