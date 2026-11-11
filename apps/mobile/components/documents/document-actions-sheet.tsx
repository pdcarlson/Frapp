import { forwardRef, useCallback, useRef, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetModal, BottomSheetView } from "@gorhom/bottom-sheet";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  SheetBackToClose,
  SheetGrabber,
  SheetHeader,
  SheetScrim,
  SHEET_STACK_BEHAVIOR,
  useSheetBackgroundStyle,
  useSheetClose,
} from "@/components/sheet-scaffold";
import { PinGlyph, StarGlyph } from "./document-glyphs";

/** The rows' leading glyph, at the composer + sheet's size. */
const GLYPH_SIZE = 20;

/** What a long press on s12 acts on: a folder chip or a file row (#3934). */
export interface DocumentActionsTarget {
  kind: "folder" | "document";
  id: string;
  /** The folder's name or the file's title, as the screen shows it. */
  name: string;
  pinned: boolean;
  starred: boolean;
}

export interface DocumentActionsSheetProps {
  /** The folder or file the sheet is open on; `null` while closed. */
  target: DocumentActionsTarget | null;
  /** Holds `chapter_docs:manage`: may pin, and delete a file. */
  canManage: boolean;
  onToggleStar: (target: DocumentActionsTarget) => void;
  onTogglePin: (target: DocumentActionsTarget) => void;
  /** A file's delete, which confirms first; folders are managed on web. */
  onDelete: (target: DocumentActionsTarget) => void;
}

/**
 * s12's long-press sheet (#3934, `spec/behavior/chapter-docs.md` § Pinned and
 * starred): Star for everyone, Pin for the chapter for whoever manages
 * documents, and, on a file, Delete document, which used to be the long
 * press's only action. The Add to the conversation sheet's chrome
 * (`components/chat/composer-plus-sheet.tsx`): a title, then bare rows at the
 * 44pt floor. A row runs once the sheet has closed, so Delete's system
 * confirm never draws over the sheet.
 */
export const DocumentActionsSheet = forwardRef<
  BottomSheetModal,
  DocumentActionsSheetProps
>(function DocumentActionsSheet(
  { target, canManage, onToggleStar, onTogglePin, onDelete },
  ref,
) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const backgroundStyle = useSheetBackgroundStyle();
  const closeSheet = useSheetClose(ref);
  const chosen = useRef<(() => void) | null>(null);

  const choose = useCallback(
    (run: () => void) => {
      chosen.current = run;
      closeSheet();
    },
    [closeSheet],
  );
  const dismissed = useCallback(() => {
    const run = chosen.current;
    chosen.current = null;
    run?.();
  }, []);

  const muted = tokens.color.text.mutedForeground;

  return (
    <BottomSheetModal
      ref={ref}
      stackBehavior={SHEET_STACK_BEHAVIOR}
      enableDynamicSizing
      backgroundStyle={backgroundStyle}
      handleComponent={SheetGrabber}
      backdropComponent={SheetScrim}
      onDismiss={dismissed}
    >
      <SheetBackToClose onClose={closeSheet} />
      <BottomSheetView onAccessibilityEscape={closeSheet} style={styles.body}>
        <SheetHeader title={target?.name ?? ""} onCancel={closeSheet} />
        {target ? (
          <>
            <ActionRow
              label={target.starred ? "Unstar" : "Star"}
              detail={target.starred ? null : "Only you see your stars."}
              glyph={
                <StarGlyph
                  color={target.starred ? accent : muted}
                  on={target.starred}
                  size={GLYPH_SIZE}
                />
              }
              onPress={() => choose(() => onToggleStar(target))}
              styles={styles}
            />
            {canManage ? (
              <ActionRow
                label={
                  target.pinned
                    ? "Unpin for the chapter"
                    : "Pin for the chapter"
                }
                detail={target.pinned ? null : "Everyone sees it at the top."}
                glyph={
                  <PinGlyph
                    color={target.pinned ? accent : muted}
                    on={target.pinned}
                    size={GLYPH_SIZE}
                  />
                }
                onPress={() => choose(() => onTogglePin(target))}
                styles={styles}
              />
            ) : null}
            {canManage && target.kind === "document" ? (
              <ActionRow
                label="Delete document"
                // An empty slot the glyphs' width, so the three labels align.
                glyph={<View style={styles.glyphSlot} />}
                destructive
                onPress={() => choose(() => onDelete(target))}
                styles={styles}
              />
            ) : null}
          </>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

function ActionRow({
  label,
  detail = null,
  glyph = null,
  destructive = false,
  onPress,
  styles,
}: {
  label: string;
  detail?: string | null;
  glyph?: ReactNode;
  destructive?: boolean;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail ?? undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      {glyph}
      <Text
        style={[styles.rowLabel, destructive ? styles.rowDestructive : null]}
      >
        {label}
      </Text>
      {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    body: {
      paddingHorizontal: tokens.spacing.lg,
      paddingBottom: tokens.spacing.xl,
    },
    row: {
      minHeight: tokens.touch.minimum,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
    },
    rowPressed: {
      opacity: 0.7,
    },
    glyphSlot: {
      width: GLYPH_SIZE,
    },
    rowLabel: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    rowDestructive: {
      color: tokens.color.semantic.destructive,
    },
    rowDetail: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
  });
}
