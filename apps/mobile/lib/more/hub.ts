/**
 * The More hub's profile card line: the points balance as "1,240 pts".
 *
 * `null` while the balance is unknown, so the card draws no line rather than
 * a confident "0 pts" beside a member who has points. A real zero is still a
 * line: "0 pts".
 *
 * Device locale, as s15 formats the same balance, so the card and the screen
 * it opens agree.
 */
export function formatPointsLabel(balance: number | null): string | null {
  if (balance === null) return null;
  return `${balance.toLocaleString()} ${balance === 1 ? "pt" : "pts"}`;
}
