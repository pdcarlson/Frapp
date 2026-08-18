import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { StatusChip } from "@/components/status-chip";
import { historyMeta, type InvoiceRow as InvoiceRowModel } from "@/lib/dues/invoices";

/**
 * One HISTORY row on s11 — title, settlement meta, and a status chip.
 *
 * The drawn rows are all `Paid`. A real history also holds `VOID` invoices,
 * which are cancelled rather than settled — painting those green would tell a
 * member they paid something nobody collected.
 */
export interface InvoiceHistoryRowProps {
  invoice: InvoiceRowModel;
  isLast: boolean;
}

export function InvoiceHistoryRow({ invoice, isLast }: InvoiceHistoryRowProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const isVoid = invoice.status === "VOID";
  // `writing.md` § Status labels: match the backend's own domain language.
  const label = isVoid ? "Void" : "Paid";
  const hue = isVoid
    ? tokens.color.text.muted
    : tokens.color.semantic.success;

  return (
    <View style={[styles.row, isLast ? null : styles.rowDivided]}>
      <View style={styles.text}>
        <Text style={styles.title}>{invoice.title}</Text>
        <Text style={styles.meta}>{historyMeta(invoice)}</Text>
      </View>
      <StatusChip label={label} hue={hue} />
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
