import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { StatusChip } from "@/components/status-chip";
import {
  dueChip,
  dueChipHue,
  formatAmount,
  type InvoiceRow as InvoiceRowModel,
} from "@/lib/dues/invoices";

/**
 * One OPEN row on s11: title, amount, and the same due chip the balance card
 * draws for the invoice Pay settles.
 *
 * **Not drawn.** Canvas draws one open bill, which the balance card carries
 * whole. With two or more open, the card can only say "3 invoices open" and
 * name the one Pay settles, and HISTORY holds settled rows only, so without
 * this list the others (what each is for, what it costs, when it's due)
 * appeared nowhere. Built from HISTORY's row anatomy so the two lists read as
 * one family.
 */
export interface OpenInvoiceRowProps {
  invoice: InvoiceRowModel;
  now: Date;
  /**
   * This invoice has a captured payment the invoice list doesn't read as
   * settled yet, so the screen holds it: the chip reads Pending.
   */
  isConfirming: boolean;
  isLast: boolean;
}

export function OpenInvoiceRow({
  invoice,
  now,
  isConfirming,
  isLast,
}: OpenInvoiceRowProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const due = dueChip(invoice, now);
  // The balance card's own rule, shared rather than restated.
  const hue = dueChipHue(
    isConfirming ? "pending" : due.state,
    tokens.color.semantic,
  );

  return (
    <View style={[styles.row, isLast ? null : styles.rowDivided]}>
      <View style={styles.text}>
        <Text style={styles.title}>{invoice.title}</Text>
        <Text style={styles.meta}>{formatAmount(invoice.amountCents)}</Text>
      </View>
      <StatusChip label={isConfirming ? "Pending" : due.label} hue={hue} />
    </View>
  );
}

// HISTORY's row geometry (`invoice-row.tsx`), restated because that file's
// styles are private. It stays a copy for now: `invoice-row.tsx` is moving onto
// a shared `HistoryRow` in a separate change, and this row follows it there
// once that lands, rather than both changes editing the same row at once.
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
