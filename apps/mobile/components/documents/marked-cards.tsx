import { StyleSheet, Text, View } from "react-native";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { SignetTokens } from "@repo/theme/signet";
import { formatDay } from "@repo/formatting";
import type { MarkedItem } from "@repo/hooks/document-library";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { pageSurfaces } from "@/lib/surfaces";
import { useChapterBranding } from "@/lib/chapter-branding";
import { NavGlyph } from "@/components/nav-glyph";
import { PressableRow, SectionHeader } from "@/components/list-section";
import type { DocumentFolder, MobileDocument } from "@/lib/more/documents";
import { StarGlyph } from "./document-glyphs";

/** A pinned or starred thing on s12: a folder, or a single file (#3934). */
export type MarkedCardItem = MarkedItem<DocumentFolder, MobileDocument>;

/**
 * s12's PINNED section (`canvas-screens.dc.html` s12), and a STARRED one under
 * it (#3934, `spec/behavior/chapter-docs.md` § Pinned and starred): cards
 * above the list on All with no search or filter, folders and files together.
 * The board draws each card as a filled, bordered tile with the accent
 * duotone file glyph, a title and a meta line; a starred card takes the
 * neutral glyph, so the two groups read apart before their labels are read.
 * A tap opens the folder or the file; a long press opens the same Star and
 * Pin sheet a row's does.
 */
export function MarkedCards({
  pinned,
  starred,
  isStarred,
  openingId,
  deletingIds,
  actionsLabel,
  onOpenFolder,
  onOpenDocument,
  onActions,
}: {
  pinned: readonly MarkedCardItem[];
  starred: readonly MarkedCardItem[];
  isStarred: (item: MarkedCardItem) => boolean;
  /** The file whose link is being fetched, which shows its spinner. */
  openingId: string | null;
  /** Files being deleted: their cards take no press, as their rows don't. */
  deletingIds: ReadonlySet<string>;
  /** The long press's spoken name, matched to what the viewer may do. */
  actionsLabel: string;
  onOpenFolder: (name: string) => void;
  onOpenDocument: (id: string) => void;
  onActions: (item: MarkedCardItem) => void;
}) {
  if (pinned.length === 0 && starred.length === 0) return null;
  return (
    <>
      {pinned.length > 0 ? (
        <>
          <SectionHeader>Pinned</SectionHeader>
          <CardList
            items={pinned}
            accented
            isStarred={isStarred}
            openingId={openingId}
            deletingIds={deletingIds}
            actionsLabel={actionsLabel}
            onOpenFolder={onOpenFolder}
            onOpenDocument={onOpenDocument}
            onActions={onActions}
          />
        </>
      ) : null}
      {starred.length > 0 ? (
        <>
          <SectionHeader>Starred</SectionHeader>
          <CardList
            items={starred}
            accented={false}
            isStarred={isStarred}
            openingId={openingId}
            deletingIds={deletingIds}
            actionsLabel={actionsLabel}
            onOpenFolder={onOpenFolder}
            onOpenDocument={onOpenDocument}
            onActions={onActions}
          />
        </>
      ) : null}
    </>
  );
}

function CardList({
  items,
  accented,
  isStarred,
  openingId,
  deletingIds,
  actionsLabel,
  onOpenFolder,
  onOpenDocument,
  onActions,
}: {
  items: readonly MarkedCardItem[];
  accented: boolean;
  isStarred: (item: MarkedCardItem) => boolean;
  openingId: string | null;
  deletingIds: ReadonlySet<string>;
  actionsLabel: string;
  onOpenFolder: (name: string) => void;
  onOpenDocument: (id: string) => void;
  onActions: (item: MarkedCardItem) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const muted = tokens.color.text.muted;
  return (
    <View style={styles.list}>
      {items.map((item) => {
        const key =
          item.kind === "folder" ? `f:${item.folder.id}` : `d:${item.doc.id}`;
        const title =
          item.kind === "folder" ? item.folder.name : item.doc.title;
        const meta =
          item.kind === "folder"
            ? `Folder · ${item.count} ${item.count === 1 ? "file" : "files"}`
            : [
                item.doc.document_type,
                formatDay(item.doc.created_at || null)
                  ? `Uploaded ${formatDay(item.doc.created_at || null)}`
                  : null,
                item.doc.folder,
              ]
                .filter(Boolean)
                .join(" · ");
        const starred = isStarred(item);
        // A file on its way out takes no second press or long press, as its
        // row doesn't (`ListRow` while busy): a second Delete would fail.
        const deleting =
          item.kind === "document" && deletingIds.has(item.doc.id);
        const busy =
          deleting || (item.kind === "document" && item.doc.id === openingId);
        return (
          <PressableRow
            key={key}
            onCard
            accessibilityRole="button"
            accessibilityLabel={title}
            accessibilityHint={
              item.kind === "folder"
                ? "Shows this folder's files."
                : "Opens in your browser."
            }
            accessibilityState={busy ? { busy: true } : undefined}
            accessibilityActions={
              deleting ? undefined : [{ name: "longpress", label: actionsLabel }]
            }
            onAccessibilityAction={(event) => {
              if (!deleting && event.nativeEvent.actionName === "longpress") {
                onActions(item);
              }
            }}
            disabled={deleting}
            onPress={() =>
              item.kind === "folder"
                ? onOpenFolder(item.folder.name)
                : onOpenDocument(item.doc.id)
            }
            onLongPress={deleting ? undefined : () => onActions(item)}
            style={styles.card}
          >
            <NavGlyph
              paths={
                item.kind === "folder"
                  ? NAV_GLYPHS.folder
                  : NAV_GLYPHS.documents
              }
              color={accented ? accent : muted}
              size={22}
              active={accented}
            />
            <View style={styles.text}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {meta ? (
                <Text style={styles.meta} numberOfLines={1}>
                  {meta}
                </Text>
              ) : null}
            </View>
            {starred ? <StarGlyph color={accent} on size={16} /> : null}
          </PressableRow>
        );
      })}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    list: {
      gap: tokens.spacing.sm,
    },
    // The board's card: `card` fill at radius 14 with a hairline, as
    // `ListSection` draws its grouped list, one card per item.
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
    },
    text: {
      flex: 1,
      gap: 0,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
  });
}
