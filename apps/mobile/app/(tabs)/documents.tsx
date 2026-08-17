import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import {
  useActiveChapterId,
  useDocument,
  useDocumentFolders,
  useDocuments,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { ListRow, ListSection, SectionHeader } from "@/components/list-section";
import {
  EmptyState,
  ErrorState,
  NoChapterState,
  SkeletonLines,
} from "@/components/state-block";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  selectDocumentFolders,
  selectDocumentRows,
  selectDownloadUrl,
} from "@/lib/more/documents";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s12 — Documents (`canvas-screens.dc.html:427`).
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
 * document with a freshly signed `downloadUrl`. So a tap selects an id, that
 * single-document query runs, and the effect below opens the URL it comes back
 * with. Note the key is **`downloadUrl`** — web reads `download_url` at two
 * call sites and there is no case-transforming interceptor anywhere, so those
 * are broken; `selectDownloadUrl` accepts both and is the only place that
 * spelling appears.
 */
export default function DocumentsScreen() {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const chapterId = useActiveChapterId();

  const [folder, setFolder] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState(false);

  const foldersQuery = useDocumentFolders();
  const documentsQuery = useDocuments({
    folder: folder ?? undefined,
    search: search.trim() || undefined,
  });
  const openingQuery = useDocument(openingId ?? "");

  const folders = useMemo(
    () => selectDocumentFolders(foldersQuery.data),
    [foldersQuery.data],
  );
  const rows = useMemo(
    () => selectDocumentRows(documentsQuery.data),
    [documentsQuery.data],
  );

  // The signed URL arrives with the single-document read, so opening is a
  // two-step: select an id, then follow what comes back for it. Keyed on the id
  // so a slow response for a document the member has moved on from cannot open
  // the wrong file.
  useEffect(() => {
    if (!openingId) return;
    if (openingQuery.isError) {
      setOpeningId(null);
      setOpenFailed(true);
      return;
    }
    if (!openingQuery.isSuccess) return;
    const url = selectDownloadUrl(openingQuery.data);
    setOpeningId(null);
    if (!url) {
      setOpenFailed(true);
      return;
    }
    setOpenFailed(false);
    void WebBrowser.openBrowserAsync(url);
  }, [openingId, openingQuery.isSuccess, openingQuery.isError, openingQuery.data]);

  function renderList() {
    if (!chapterId) return <NoChapterState noun="chapter documents" />;
    if (documentsQuery.isPending) return <SkeletonLines lines={4} />;
    if (documentsQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load documents"
          body="The chapter library couldn't reach the server."
          onRetry={() => void documentsQuery.refetch()}
          isRetrying={documentsQuery.isFetching}
        />
      );
    }
    if (rows.length === 0) {
      return (
        <EmptyState
          glyph="⌸"
          title={search.trim() ? "No matches" : "Nothing filed here yet"}
          body={
            search.trim()
              ? `No document title matches “${search.trim()}”.`
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
            disabled={openingId === row.id}
            onPress={() => {
              setOpenFailed(false);
              setOpeningId(row.id);
            }}
          />
        ))}
      </ListSection>
    );
  }

  return (
    <ScreenShell title="Documents" subtitle="The chapter's document library.">
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search documents"
        placeholderTextColor={tokens.color.text.muted}
        accessibilityLabel="Search documents by title"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.search}
      />

      {folders.length > 0 ? (
        <View style={styles.chipRow}>
          {[{ id: "__all", name: "All" }, ...folders].map((entry) => {
            const value = entry.id === "__all" ? null : entry.name;
            const selected = folder === value;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFolder(value)}
                style={[
                  styles.chip,
                  selected ? { backgroundColor: accent } : styles.chipIdle,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    selected ? styles.chipTextSelected : null,
                  ]}
                >
                  {entry.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
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
    search: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: tokens.spacing.sm,
    },
    chip: {
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.lg,
      borderRadius: tokens.radius.chipLarge,
    },
    chipIdle: {
      backgroundColor: tokens.color.surface.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
    },
    chipText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    chipTextSelected: {
      color: tokens.color.gold.onHouse,
    },
    errorNote: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
      paddingHorizontal: tokens.spacing.xs,
    },
  });
}
