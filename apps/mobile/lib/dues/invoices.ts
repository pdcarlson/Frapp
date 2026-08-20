/**
 * Narrowing and derivation for s11, over `GET /v1/invoices` — a route that
 * ships no OpenAPI response schema, so the SDK types its body `never` (the wall
 * `lib/more/narrow.ts` documents).
 *
 * ## Why the viewer filter is here and not assumed
 *
 * `spec/behavior/billing.md`: "`GET /v1/invoices` returns the *whole chapter's*
 * invoices to a `billing:view` holder; a member without that permission sees
 * only their own rows." So on a treasurer's phone this endpoint returns other
 * members' dues. The same paragraph draws the consequence — "a client rendering
 * the chapter-wide list must not offer a pay affordance on an invoice whose
 * `user_id` is not the viewer's" — and s11 is a *member* surface, so it filters
 * to the viewer entirely rather than only gating the button.
 */
import { parseBareDateUtcNoon } from "@repo/formatting";
import { num, records, str } from "../more/narrow";

export type InvoiceStatus = "DRAFT" | "OPEN" | "PAID" | "VOID";

export interface InvoiceRow {
  id: string;
  userId: string | null;
  title: string;
  description: string | null;
  /** Cents. The API's unit, kept all the way to the formatter. */
  amountCents: number;
  status: InvoiceStatus;
  dueDate: string;
  paidAt: string | null;
}

const STATUSES: ReadonlySet<string> = new Set<InvoiceStatus>([
  "DRAFT",
  "OPEN",
  "PAID",
  "VOID",
]);

function toRow(row: Record<string, unknown>): InvoiceRow | null {
  const id = str(row, "id");
  const rawStatus = str(row, "status");
  const dueDate = str(row, "due_date");
  const amountCents = num(row, "amount");
  if (!id || !rawStatus || !STATUSES.has(rawStatus) || !dueDate) return null;
  // An invoice with no readable amount cannot be drawn or paid honestly — a
  // "$0.00" balance is a different claim from "we could not read this".
  if (amountCents === null) return null;

  return {
    id,
    userId: str(row, "user_id"),
    title: str(row, "title") ?? "Chapter dues",
    description: str(row, "description"),
    amountCents,
    status: rawStatus as InvoiceStatus,
    dueDate,
    paidAt: str(row, "paid_at"),
  };
}

/**
 * The viewer's invoices, newest first.
 *
 * A `null` viewer id means `/v1/users/me` has not answered yet — the rows are
 * withheld rather than shown unfiltered, because a treasurer would otherwise
 * see the chapter's whole dues ledger flash onto their personal dues screen.
 */
export function selectInvoiceRows(
  data: unknown,
  viewerUserId: string | null,
): InvoiceRow[] {
  if (!viewerUserId) return [];
  return records(data)
    .map(toRow)
    .filter((row): row is InvoiceRow => !!row && row.userId === viewerUserId)
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
}

/**
 * What the member currently owes.
 *
 * `OPEN` only. `DRAFT` has not been sent to them yet ("not yet sent", per
 * `billing.md`), so billing a member for it would be the app inventing a debt.
 */
export function selectOpenInvoices(rows: InvoiceRow[]): InvoiceRow[] {
  return rows.filter((row) => row.status === "OPEN");
}

/** Settled and cancelled rows — the drawn HISTORY list. */
export function selectInvoiceHistory(rows: InvoiceRow[]): InvoiceRow[] {
  return rows.filter((row) => row.status === "PAID" || row.status === "VOID");
}

export function balanceCents(rows: InvoiceRow[]): number {
  return selectOpenInvoices(rows).reduce((sum, row) => sum + row.amountCents, 0);
}

/**
 * The drawn two-tier money display: `$425` at full size, `.00` smaller.
 *
 * The currency is a literal `$` because the server mints every PaymentIntent in
 * `usd` (`billing.md` § Member payment flow) — there is no currency field to
 * read, and a formatter that guessed from the device locale would render a
 * dollar amount with a euro sign for a member studying abroad.
 */
export function splitAmount(cents: number): { whole: string; fraction: string } {
  const safe = Math.max(0, Math.round(cents));
  const dollars = Math.floor(safe / 100);
  const rest = safe % 100;
  return {
    whole: `$${dollars.toLocaleString("en-US")}`,
    fraction: `.${String(rest).padStart(2, "0")}`,
  };
}

export function formatAmount(cents: number): string {
  const { whole, fraction } = splitAmount(cents);
  return `${whole}${fraction}`;
}

function shortDate(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * A bare `YYYY-MM-DD` calendar date → `"Sep 15"`.
 *
 * Parsed at noon UTC, not midnight: a bare date at midnight renders as the
 * previous day west of Greenwich, and a due date is exactly the field where
 * being a day early is a bill the member thinks they missed.
 *
 * **Only for bare dates.** An instant carries its own offset and must go
 * through {@link formatInstant} — truncating one to its UTC day and re-anchoring
 * it here dates a 9pm payment in New York to the following morning.
 */
function formatCalendarDate(value: string): string {
  const date = parseBareDateUtcNoon(value);
  if (!date) return value;
  return shortDate(date);
}

/** A full ISO instant → `"Feb 3"` in the member's own zone. */
function formatInstant(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : shortDate(date);
}

/**
 * The local end of a bare calendar date, as a timestamp.
 *
 * The boundary an invoice is "past due" at is the end of its due date **where
 * the member is**. Reusing the noon-UTC render parse as the comparison put the
 * cutoff at 12:00 UTC, so an invoice due the 15th turned red at 5am on the 15th
 * in Los Angeles.
 */
function endOfLocalDay(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return Number.NaN;
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

export type DueState = "upcoming" | "past-due";

/**
 * The drawn due chip.
 *
 * "Past due" rather than "Overdue" is deliberate. `billing.md` defines OVERDUE
 * as OPEN past the due date **plus the chapter's `wf_dues_grace` window**, and
 * that window is not on the invoice — only `GET /v1/invoices/overdue` knows, and
 * that route is `billing:view`-only, so a member's client cannot ask. Saying
 * "Past due" states the fact this client can actually verify (the date has
 * passed) without claiming the server's flagged state, which `writing.md`
 * reserves for the backend's own label.
 */
export function dueChip(
  row: InvoiceRow,
  now: Date,
): { state: DueState; label: string } {
  const boundary = endOfLocalDay(row.dueDate);
  const past = !Number.isNaN(boundary) && boundary < now.getTime();
  const date = formatCalendarDate(row.dueDate);
  return {
    state: past ? "past-due" : "upcoming",
    label: past ? `Past due ${date}` : `Due ${date}`,
  };
}

/**
 * The invoice a "Pay now" tap settles: a PaymentIntent is per invoice, so only
 * one can be paid at a time, and the earliest due date is the one that turns
 * overdue next.
 *
 * Exported rather than inlined because two surfaces need the same answer — the
 * Dues card and the More hub's trailing chip — and two copies of a tie-break
 * rule are two chips naming different invoices the moment it changes.
 */
export function selectNextDueInvoice(rows: InvoiceRow[]): InvoiceRow | null {
  return (
    [...selectOpenInvoices(rows)].sort((a, b) =>
      a.dueDate.localeCompare(b.dueDate),
    )[0] ?? null
  );
}

/**
 * A history row's meta line.
 *
 * TODO-DESIGN: Canvas draws a payment method here (`Paid Feb 3 · Visa ··4242`,
 * `Apple Pay`, `plan (3 of 3)`). None of it is reachable. `financial_invoices`
 * has no method column, and `billing.md` states outright that "invoice DTOs do
 * not expose Stripe fields" — the only source is
 * `GET /v1/invoices/:id/transactions`, which is `billing:view`-only, so a member
 * collects a 403. Nearest pattern used: the settlement date alone. Filed.
 */
export function historyMeta(row: InvoiceRow): string {
  if (row.status === "VOID") return "Cancelled by your chapter";
  // `paid_at` is an instant, not a calendar date — formatted as one so a
  // payment made at 9pm in New York does not display as the next morning.
  const settled = row.paidAt ? formatInstant(row.paidAt) : null;
  return settled ? `Paid ${settled}` : "Paid";
}
