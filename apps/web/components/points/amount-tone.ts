/**
 * The class recipe for a signed points amount.
 *
 * One rule, two surfaces: the transactions table on `/points` and the audit
 * card's row list both render `+12` / `-5` and both have to answer the same
 * question about tone. The Directory & Finance slice of #920 established that
 * answer — positive takes `--success` (6.75:1 on `--card`, replacing the stock
 * `text-emerald-700` at 3.13:1 that #916 is about) and negative takes the solid
 * `--destructive` (5.12:1), **not** the AA-lifted `--destructive-text`, which is
 * for danger text on a danger *tint* and over-applies components.md §1 on a
 * plain surface.
 *
 * It lives here because it was written twice, and a later rule — what a zero
 * amount does, or a per-category tone — would have had to be written twice too.
 *
 * `font-mono` is foundations.md §7's reserved role for points-table cells;
 * `tabular-nums` keeps a re-sorted column from reflowing.
 */
export function amountToneClassName(amount: number, size: "sm" | "inherit" = "inherit") {
  const scale = size === "sm" ? "text-sm " : "";
  return `font-mono ${scale}font-semibold tabular-nums ${
    amount >= 0 ? "text-success" : "text-destructive"
  }`;
}
