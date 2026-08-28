import { describe, expect, it } from "vitest";
import {
  balanceCents,
  dueChip,
  formatAmount,
  historyMeta,
  selectInvoiceHistory,
  selectInvoiceRows,
  selectNextDueInvoice,
  selectOpenInvoices,
  splitAmount,
  type InvoiceRow,
} from "./invoices";

const VIEWER = "u-1";

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    chapter_id: "c-1",
    user_id: VIEWER,
    title: "Fall 2026 dues",
    description: null,
    amount: 42500,
    status: "OPEN",
    due_date: "2026-09-15",
    paid_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("selectInvoiceRows", () => {
  it("narrows an invoice into a drawable row", () => {
    const [row] = selectInvoiceRows([invoice()], VIEWER);
    expect(row?.id).toBe("inv-1");
    expect(row?.amountCents).toBe(42500);
    expect(row?.status).toBe("OPEN");
  });

  it("drops other members' rows, which a treasurer's read includes", () => {
    // GET /v1/invoices returns the whole chapter to a billing:view holder
    // (billing.md § Member payment flow). s11 is a personal surface.
    const rows = selectInvoiceRows(
      [invoice(), invoice({ id: "inv-2", user_id: "u-2" })],
      VIEWER,
    );
    expect(rows.map((row) => row.id)).toEqual(["inv-1"]);
  });

  it("withholds every row until the viewer is known", () => {
    // Otherwise a treasurer sees the chapter's ledger flash onto their own
    // dues screen for the round trip /v1/users/me takes.
    expect(selectInvoiceRows([invoice()], null)).toEqual([]);
  });

  it("drops a row with an unreadable amount rather than billing $0.00", () => {
    expect(selectInvoiceRows([invoice({ amount: null })], VIEWER)).toEqual([]);
  });

  it("drops a row with an unknown status", () => {
    expect(selectInvoiceRows([invoice({ status: "REFUNDED" })], VIEWER)).toEqual(
      [],
    );
  });

  it("names an untitled invoice rather than rendering a blank row", () => {
    const [row] = selectInvoiceRows([invoice({ title: null })], VIEWER);
    expect(row?.title).toBe("Chapter dues");
  });

  it("sorts by due date, newest first", () => {
    const rows = selectInvoiceRows(
      [
        invoice({ id: "old", due_date: "2026-01-15" }),
        invoice({ id: "new", due_date: "2026-09-15" }),
      ],
      VIEWER,
    );
    expect(rows.map((row) => row.id)).toEqual(["new", "old"]);
  });

  it("returns an empty list for a non-array body", () => {
    expect(selectInvoiceRows(undefined, VIEWER)).toEqual([]);
  });
});

describe("balance", () => {
  const rows = (): InvoiceRow[] =>
    selectInvoiceRows(
      [
        invoice({ id: "open-1", amount: 42500, status: "OPEN" }),
        invoice({ id: "open-2", amount: 5000, status: "OPEN" }),
        invoice({ id: "paid", amount: 30000, status: "PAID" }),
        invoice({ id: "draft", amount: 90000, status: "DRAFT" }),
        invoice({ id: "void", amount: 10000, status: "VOID" }),
      ],
      VIEWER,
    );

  it("counts only OPEN invoices", () => {
    // DRAFT is "not yet sent" (billing.md), so charging for it would be the
    // app inventing a debt; VOID and PAID are settled.
    expect(balanceCents(rows())).toBe(47500);
    expect(selectOpenInvoices(rows()).map((row) => row.id).sort()).toEqual([
      "open-1",
      "open-2",
    ]);
  });

  it("keeps PAID and VOID in history and nothing else", () => {
    expect(
      selectInvoiceHistory(rows()).map((row) => row.id).sort(),
    ).toEqual(["paid", "void"]);
  });
});

describe("money", () => {
  it("splits into the drawn two tiers", () => {
    expect(splitAmount(42500)).toEqual({ whole: "$425", fraction: ".00" });
    expect(splitAmount(42599)).toEqual({ whole: "$425", fraction: ".99" });
    expect(splitAmount(5)).toEqual({ whole: "$0", fraction: ".05" });
  });

  it("groups thousands", () => {
    expect(formatAmount(123456)).toBe("$1,234.56");
  });

  it("never renders a negative balance", () => {
    expect(formatAmount(-500)).toBe("$0.00");
  });
});

describe("dueChip", () => {
  const row = () => selectInvoiceRows([invoice()], VIEWER)[0]!;

  it("reads as upcoming before the due date", () => {
    const chip = dueChip(row(), new Date("2026-09-01T12:00:00Z"));
    expect(chip.state).toBe("upcoming");
    expect(chip.label).toContain("Due ");
  });

  it("stays upcoming through the whole of the due date, in any timezone", () => {
    // The bug this pins: reusing the noon-UTC *render* parse as the past-due
    // *boundary* put the cutoff at 12:00 UTC, so an invoice due the 15th turned
    // destructive-red at 5am on the 15th in Los Angeles — before the chapter's
    // dues grace window had even started.
    const morningOfDueDate = new Date(2026, 8, 15, 8, 0, 0);
    expect(dueChip(row(), morningOfDueDate).state).toBe("upcoming");

    const lateOnDueDate = new Date(2026, 8, 15, 23, 30, 0);
    expect(dueChip(row(), lateOnDueDate).state).toBe("upcoming");

    const nextMorning = new Date(2026, 8, 16, 0, 30, 0);
    expect(dueChip(row(), nextMorning).state).toBe("past-due");
  });

  it("says 'Past due', not 'Overdue', once the date has passed", () => {
    // OVERDUE is the server's flagged state and includes the chapter's
    // wf_dues_grace window, which this client cannot read — the /overdue route
    // is billing:view-only. Claiming it would be a status the member cannot
    // reconcile with the reminder they did not get.
    const chip = dueChip(row(), new Date("2026-09-20T12:00:00Z"));
    expect(chip.state).toBe("past-due");
    expect(chip.label).toContain("Past due");
    expect(chip.label).not.toContain("Overdue");
  });

  it("renders the calendar date the chapter set, not the day before", () => {
    // The bare YYYY-MM-DD parse trap: UTC midnight renders as the 14th for
    // anyone west of Greenwich.
    expect(dueChip(row(), new Date("2026-09-01T12:00:00Z")).label).toContain(
      "15",
    );
  });
});

describe("historyMeta", () => {
  it("dates a settled invoice", () => {
    const [row] = selectInvoiceRows(
      [invoice({ status: "PAID", paid_at: "2026-02-03T18:00:00.000Z" })],
      VIEWER,
    );
    expect(historyMeta(row!)).toContain("Feb 3");
  });

  it("says a void invoice was cancelled rather than paid", () => {
    const [row] = selectInvoiceRows([invoice({ status: "VOID" })], VIEWER);
    expect(historyMeta(row!)).toContain("Cancelled");
  });

  it("dates an evening payment in the member's own day, not UTC's", () => {
    // `paid_at` is an instant. Slicing its UTC calendar day and re-anchoring at
    // noon UTC told a member in New York who paid at 9:15pm on Feb 2 that they
    // paid on Feb 3 — contradicting their own card statement.
    const [row] = selectInvoiceRows(
      [invoice({ status: "PAID", paid_at: "2026-02-03T02:15:00.000Z" })],
      VIEWER,
    );
    const rendered = historyMeta(row!);
    const localDay = new Date("2026-02-03T02:15:00.000Z").toLocaleDateString(
      undefined,
      { month: "short", day: "numeric" },
    );
    expect(rendered).toBe(`Paid ${localDay}`);
  });

  it("does not invent a settlement date when the API omits one", () => {
    const [row] = selectInvoiceRows([invoice({ status: "PAID" })], VIEWER);
    expect(historyMeta(row!)).toBe("Paid");
  });
});

describe("selectNextDueInvoice", () => {
  it("picks the earliest-due open invoice, which is what a tap pays", () => {
    const rows = selectInvoiceRows(
      [
        invoice({ id: "later", due_date: "2026-11-01" }),
        invoice({ id: "sooner", due_date: "2026-09-15" }),
        invoice({ id: "paid-earliest", due_date: "2026-01-01", status: "PAID" }),
      ],
      VIEWER,
    );
    expect(selectNextDueInvoice(rows)?.id).toBe("sooner");
  });

  it("returns null when nothing is open", () => {
    const rows = selectInvoiceRows([invoice({ status: "PAID" })], VIEWER);
    expect(selectNextDueInvoice(rows)).toBeNull();
  });
});
