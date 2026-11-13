import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { SignetTokens } from "@repo/theme/signet";
import { classifyFile, type LibraryDocument } from "@repo/hooks/document-library";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { pageSurfaces } from "@/lib/surfaces";
import { useChapterBranding } from "@/lib/chapter-branding";
import { NavGlyph } from "@/components/nav-glyph";
import { PressableRow } from "@/components/list-section";
import { GridLine, toGridChunks } from "@/components/grid-line";
import { documentMeta, type MobileDocument } from "@/lib/more/documents";
import { PinGlyph, StarGlyph } from "./document-glyphs";

type DocumentRowData = LibraryDocument<MobileDocument>;

/**
 * s12's Grid layout (#4175): the files two to a line, each a tile in Google
 * Drive's grid shape, a preview panel naming the file's type over its title
 * and the row's own meta line. It takes the row's tap (open), long press (the
 * Star, Pin and Delete sheet) and screen-reader wording, so the layout changes
 * the shape of the list and nothing a member can do with it.
 *
 * The preview is the type `classifyFile` gives the File type filter, not the
 * file's pages, which would mean fetching every file on screen. A pinned
 * file's glyph takes the accent duotone, as its PINNED card does; a pinned or
 * starred tile wears the marks its row wears.
 *
 * Lines and their padding are every grid's (`components/grid-line.tsx`), so
 * this screen and the Directory lay out alike.
 */
export function DocumentTiles({
  rows,
  isStarred,
  busyIds,
  deletingIds,
  actionsLabel,
  onOpen,
  onActions,
}: {
  rows: readonly DocumentRowData[];
  isStarred: (id: string) => boolean;
  /** Files being opened or deleted: each shows a spinner and takes no press. */
  busyIds: ReadonlySet<string>;
  /** Files being deleted take no long press either, as their rows don't. */
  deletingIds: ReadonlySet<string>;
  /** The long press's spoken name, matched to what the viewer may do. */
  actionsLabel: string;
  onOpen: (doc: MobileDocument) => void;
  onActions: (doc: MobileDocument) => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  return (
    <View style={styles.grid}>
      {toGridChunks(rows).map((line) => (
        <GridLine key={line[0]!.doc.id} filled={line.length}>
          {line.map((row) => {
            const { doc } = row;
            const pinned = !!doc.pinned_at;
            const starred = isStarred(doc.id);
            const busy = busyIds.has(doc.id);
            const actionable = !busy && !deletingIds.has(doc.id);
            const meta = documentMeta(row);
            const marks = [
              pinned ? "Pinned for the chapter" : null,
              starred ? "Starred" : null,
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <PressableRow
                key={doc.id}
                onCard
                accessibilityRole="button"
                accessibilityLabel={doc.title}
                accessibilityHint={[meta, "Opens in your browser."]
                  .filter(Boolean)
                  .join(". ")}
                accessibilityValue={marks ? { text: marks } : undefined}
                accessibilityState={{ busy }}
                accessibilityActions={
                  actionable
                    ? [{ name: "longpress", label: actionsLabel }]
                    : undefined
                }
                onAccessibilityAction={(event) => {
                  if (actionable && event.nativeEvent.actionName === "longpress") {
                    onActions(doc);
                  }
                }}
                disabled={busy}
                onPress={() => onOpen(doc)}
                onLongPress={actionable ? () => onActions(doc) : undefined}
                style={styles.tile}
              >
                <View style={styles.preview}>
                  {busy ? (
                    <ActivityIndicator
                      size="small"
                      color={tokens.color.text.muted}
                    />
                  ) : (
                    <NavGlyph
                      paths={NAV_GLYPHS.documents}
                      color={pinned ? accent : tokens.color.text.muted}
                      size={28}
                      active={pinned}
                    />
                  )}
                  <Text style={styles.type} numberOfLines={1}>
                    {classifyFile(doc).label}
                  </Text>
                  {pinned || starred ? (
                    <View style={styles.marks}>
                      {pinned ? <PinGlyph color={accent} on size={14} /> : null}
                      {starred ? (
                        <StarGlyph color={accent} on size={14} />
                      ) : null}
                    </View>
                  ) : null}
                </View>
                <Text style={styles.title} numberOfLines={2}>
                  {doc.title}
                </Text>
                {meta ? (
                  <Text style={styles.meta} numberOfLines={2}>
                    {meta}
                  </Text>
                ) : null}
              </PressableRow>
            );
          })}
        </GridLine>
      ))}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    grid: {
      gap: tokens.spacing.sm,
    },
    // The PINNED card's shape (`marked-cards.tsx`): a screen's card fill
    // (`lib/surfaces.ts`), card radius, a hairline, stood on end.
    tile: {
      flex: 1,
      gap: tokens.spacing.xs,
      padding: tokens.spacing.sm,
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
    },
    preview: {
      height: 88,
      alignItems: "center",
      justifyContent: "center",
      gap: tokens.spacing.xs,
      borderRadius: tokens.radius.control,
      backgroundColor: surfaces.raised,
      marginBottom: tokens.spacing.xs,
    },
    type: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
    },
    marks: {
      position: "absolute",
      top: tokens.spacing.xs,
      right: tokens.spacing.xs,
      flexDirection: "row",
      gap: tokens.spacing.xs,
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
