import { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { SkeletonBlock, SkeletonText } from "@/components/state-block";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * One row of a "my history" list: s10's study sessions, s11's dues invoices
 * and Service hours' entries. A title over a muted meta line, a trailing slot
 * (a status chip or a figure), and a hairline under every row but the last.
 *
 * The board draws these rows unboxed, straight on the page. Shared because
 * s10 and s11 had grown two near-identical copies, and Service hours drew its
 * history a third way, boxed in a `ListSection` with its status as bare
 * colored text.
 */
export interface HistoryRowProps {
  title: string;
  meta?: string | null;
  trailing?: ReactNode;
  isLast: boolean;
}

export function HistoryRow({ title, meta, trailing, isLast }: HistoryRowProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View style={[styles.row, isLast ? null : styles.rowDivided]}>
      <View style={styles.text}>
        {/* Wraps in full, never clamped: the row isn't pressable, so it is
            the only place a member can read a rejected entry's whole
            description (up to 2,000 characters), an invoice title or a zone
            name. */}
        <Text style={styles.title}>{title}</Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
      </View>
      {trailing}
    </View>
  );
}

/** Title widths, cycled, so the placeholder list doesn't read as a grid. */
const TITLE_WIDTHS = ["55%", "40%", "48%", "62%"] as const;

/**
 * History rows that haven't loaded, on {@link HistoryRow}'s own styles: the
 * same padding, line boxes and hairlines, and a block where the trailing chip
 * or figure lands. Placed inside a `SkeletonRegion`
 * (`components/state-block.tsx`), which gives them their pulse and their one
 * accessible name.
 */
export function HistoryRowsSkeleton({
  rows = 3,
  trailingWidth,
}: {
  rows?: number;
  /** The trailing slot's width: a status chip's, or a figure's. */
  trailingWidth: number;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { label, caption } = tokens.typography.role;

  return (
    <View>
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          style={[styles.row, index === rows - 1 ? null : styles.rowDivided]}
        >
          <View style={styles.text}>
            <SkeletonText
              role={label}
              width={TITLE_WIDTHS[index % TITLE_WIDTHS.length]!}
            />
            <SkeletonText
              role={caption}
              width="34%"
              style={styles.metaSkeleton}
            />
          </View>
          {/* A status chip's height (`status-chip.tsx`), at the chip radius. */}
          <SkeletonBlock width={trailingWidth} height={tokens.spacing.xl} />
        </View>
      ))}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const META_MARGIN_TOP = 2;
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
    },
    rowDivided: {
      borderBottomWidth: 1,
      borderBottomColor: tokens.color.border.hairline,
    },
    text: {
      flex: 1,
    },
    title: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      marginTop: META_MARGIN_TOP,
    },
    // The meta line's margin, shared so the skeleton's can't drift from it.
    metaSkeleton: {
      marginTop: META_MARGIN_TOP,
    },
  });
}
