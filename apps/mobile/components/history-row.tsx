import { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
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

function createStyles(tokens: SignetTokens) {
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
      marginTop: 2,
    },
  });
}
