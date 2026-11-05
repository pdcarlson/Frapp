import { useFrappTheme } from "@/lib/theme";
import { HistoryRow } from "@/components/history-row";
import { StatusChip } from "@/components/status-chip";
import { historyMeta, type InvoiceRow as InvoiceRowModel } from "@/lib/dues/invoices";

/**
 * One HISTORY row on s11 — title, settlement meta, and a status chip, drawn
 * by the shared `HistoryRow`.
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

  const isVoid = invoice.status === "VOID";
  // `writing.md` § Status labels: match the backend's own domain language.
  const label = isVoid ? "Void" : "Paid";
  const hue = isVoid
    ? tokens.color.text.muted
    : tokens.color.semantic.success;

  return (
    <HistoryRow
      title={invoice.title}
      meta={historyMeta(invoice)}
      trailing={<StatusChip label={label} hue={hue} />}
      isLast={isLast}
    />
  );
}
