import { useFrappTheme } from "@/lib/theme";
import { HistoryRow } from "@/components/history-row";
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
 * appeared nowhere. Drawn by the shared `HistoryRow`, HISTORY's own row, so the
 * two lists read as one family.
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
  const due = dueChip(invoice, now);
  // The balance card's own rule, shared rather than restated.
  const hue = dueChipHue(
    isConfirming ? "pending" : due.state,
    tokens.color.semantic,
  );

  return (
    <HistoryRow
      title={invoice.title}
      meta={formatAmount(invoice.amountCents)}
      trailing={
        <StatusChip label={isConfirming ? "Pending" : due.label} hue={hue} />
      }
      isLast={isLast}
    />
  );
}
