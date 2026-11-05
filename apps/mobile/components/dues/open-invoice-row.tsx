import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { StatusChip } from "@/components/status-chip";
import {
  dueChip,
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
  /** This invoice's payment was captured and the webhook hasn't settled it. */
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
  // The balance card's rule, so a row and the card never disagree about the
  // same invoice: warning while it's due, destructive once the date passes.
  const hue =
    !isConfirming && due.state === "past-due"
      ? tokens.color.semantic.destructive
      : tokens.color.semantic.warning;

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
// styles are private. If the two lists' rows get one shared component, this
// row moves onto it with HISTORY's.
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
