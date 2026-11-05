/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * s11 rendered: the open bills it lists, the shape it loads in, and where a
 * payment's outcome is drawn.
 *
 * It renders `app/(tabs)/dues.tsx` but lives here: a spec under `app/` ships
 * as a route module (`lib/routes.spec.ts`).
 */

const VIEWER = "u-1";
const PENDING_COPY =
  "Payment received, confirmation pending. This updates as soon as your chapter's records catch up.";
const UNCONFIRMED_ROW_COPY =
  "Your payment went through, but your chapter's records haven't caught up yet.";
const unconfirmedCopy = (title: string) =>
  `Your payment for ${title} went through, but your chapter's records haven't caught up yet. Check back later, or ask your treasurer if this stays open.`;
const paidCopy = (title: string) =>
  `Paid ${title}. Your chapter has it — thanks.`;
/** `PENDING_HOLD_MS` in the screen. */
const PENDING_HOLD_MS = 2 * 60 * 1000;

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-fall",
    user_id: VIEWER,
    title: "Fall dues",
    amount: 42500,
    status: "OPEN",
    due_date: "2099-09-15",
    paid_at: null,
    ...overrides,
  };
}

const FALL = invoice();
const SOCIAL = invoice({
  id: "inv-social",
  title: "Social fee",
  amount: 5000,
  due_date: "2099-10-01",
});
/** Due before Fall: billed during Fall's hold, it becomes what Pay settles. */
const RUSH = invoice({
  id: "inv-rush",
  title: "Rush fee",
  amount: 2000,
  due_date: "2099-08-01",
});
const paid = (row: Record<string, unknown>) => ({
  ...row,
  status: "PAID",
  paid_at: "2099-09-01T12:00:00Z",
});

/** A promise the test settles, for a request or poll still in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let chapterId = "ch-tau-nu";
let invoices: unknown[] = [];
let invoicesPending = false;
/** A failed read: TanStack keeps the last data beside `isError`. */
let invoicesError = false;
let viewerError = false;
const refetchInvoices = vi.fn();
const payInvoice = vi.fn();
const awaitPaid = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => chapterId,
  useViewerUserId: () => VIEWER,
  useCurrentUser: () => ({
    isError: viewerError,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useInvoices: () => ({
    data: invoicesPending ? undefined : invoices,
    isPending: invoicesPending,
    isError: invoicesError,
    isFetching: false,
    refetch: refetchInvoices,
  }),
  usePayInvoice: () => ({ mutateAsync: payInvoice }),
  useAwaitInvoicePaid: () => ({ mutateAsync: awaitPaid }),
}));

const presentPaymentSheet = vi.fn();
vi.mock("@/lib/payments/stripe", () => ({
  isStripeAvailable: () => true,
  stripeUnavailableReason: () => null,
  presentPaymentSheet: (input: unknown) => presentPaymentSheet(input),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844", chapterName: "Tau Nu" }),
}));

import DuesScreen from "@/app/(tabs)/dues";
import { BalanceCard } from "@/components/dues/balance-card";
import { OpenInvoiceRow } from "@/components/dues/open-invoice-row";
import { CardListSkeleton } from "@/components/card-list-skeleton";
import { SkeletonLines } from "@/components/state-block";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <DuesScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function rerender(tree: ReactTestRenderer) {
  act(() =>
    tree.update(
      <FrappThemeProvider>
        <DuesScreen />
      </FrappThemeProvider>,
    ),
  );
}

const payButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      node.props.accessibilityLabel === "Pay now",
  );

async function tapPay(tree: ReactTestRenderer) {
  await act(async () => {
    payButton(tree).props.onPress();
  });
}

const card = (tree: ReactTestRenderer) =>
  drawnText(tree.root.findByType(BalanceCard));

/** The CTA, whatever it currently reads. */
const cta = (tree: ReactTestRenderer) =>
  tree.root
    .findByType(BalanceCard)
    .find((node) => node.type === ("Pressable" as never));

/** "The member came back to this screen" (vitest.setup.ts's expo-router). */
async function refocus() {
  const expoRouter = (await import("expo-router")) as unknown as {
    __refocus: () => void;
  };
  act(() => expoRouter.__refocus());
}

const openRow = (tree: ReactTestRenderer, id: string) =>
  tree.root
    .findAllByType(OpenInvoiceRow)
    .find((row) => row.props.invoice.id === id)!;

/** The invoice a Pay tap asked the server to pay, by call. */
const paidFor = (call: number) => payInvoice.mock.calls[call]?.[0];

beforeEach(() => {
  chapterId = "ch-tau-nu";
  invoices = [FALL];
  invoicesPending = false;
  invoicesError = false;
  viewerError = false;
  refetchInvoices.mockReset().mockResolvedValue(undefined);
  payInvoice.mockReset().mockResolvedValue({ client_secret: "pi_secret" });
  awaitPaid.mockReset().mockResolvedValue(false);
  presentPaymentSheet.mockReset().mockResolvedValue({ kind: "completed" });
});

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});
function mount() {
  const tree = render();
  mounted.push(tree);
  return tree;
}

describe("Dues loading", () => {
  it("loads as the balance card and the list it becomes, not one card of bars", () => {
    invoicesPending = true;
    const tree = mount();

    expect(tree.root.findAllByType(CardListSkeleton)).toHaveLength(1);
    expect(tree.root.findAllByType(SkeletonLines)).toHaveLength(0);
  });
});

describe("Dues with more than one open invoice", () => {
  it("lists every open bill, earliest due first, with its amount and due date", () => {
    // HISTORY holds settled rows only, so the card's "2 invoices open" was
    // the only trace of the second bill anywhere on the screen.
    invoices = [SOCIAL, FALL];
    const tree = mount();

    expect(card(tree)).toContain("2 invoices open");
    const rows = tree.root.findAllByType(OpenInvoiceRow);
    expect(rows.map((row) => row.props.invoice.id)).toEqual([
      "inv-fall",
      "inv-social",
    ]);
    const second = drawnText(rows[1]!);
    expect(second).toContain("Social fee");
    expect(second).toContain("$50.00");
    expect(second).toMatch(/Due Oct\s?1/);
    expect(screenText(tree)).toContain("OPEN");
  });

  it("draws no OPEN list for a single open bill, which the card already shows whole", () => {
    const tree = mount();

    expect(tree.root.findAllByType(OpenInvoiceRow)).toHaveLength(0);
    expect(screenText(tree)).not.toContain("OPEN");
  });
});

describe("Dues after a captured payment", () => {
  it("keeps Pay disabled as Confirming while the invoice is still OPEN, and says so inside the card", async () => {
    // The poll gives up before the webhook lands. Re-enabling Pay here
    // offered a second payment for the bill the member had just paid.
    const tree = mount();
    await tapPay(tree);

    const button = payButton(tree);
    expect(button.props.disabled).toBe(true);
    expect(drawnText(button)).toBe("Confirming payment…");
    expect(button.props.accessibilityHint).toBe(PENDING_COPY);
    expect(card(tree)).toContain("Pending");
    expect(card(tree)).toContain(PENDING_COPY);
    // Drawn once, in the card: not as a caption above it.
    expect(screenText(tree).split(PENDING_COPY).length - 1).toBe(1);

    // Coming back to the screen re-reads the list, and still holds the latch.
    await refocus();
    expect(refetchInvoices).toHaveBeenCalled();
    expect(payButton(tree).props.disabled).toBe(true);
  });

  it("reads Confirming payment…, not Opening…, while the poll runs", async () => {
    // The sheet has closed; "Opening…" for the poll's ~24s says a sheet is on
    // its way that never comes.
    const poll = deferred<boolean>();
    awaitPaid.mockReturnValue(poll.promise);
    const tree = mount();
    await tapPay(tree);

    expect(drawnText(cta(tree))).toBe("Confirming payment…");
    expect(card(tree)).toContain(PENDING_COPY);
    await act(async () => poll.resolve(false));
    expect(drawnText(cta(tree))).toBe("Confirming payment…");
  });

  it("stays held after the poll says PAID until the list agrees, and says paid only then", async () => {
    // The poll's PAID re-reads the list, but that read is a round trip away.
    // Live Pay in between meets the server's "Only OPEN invoices can be paid"
    // in red under a member who just paid, and a "Paid" caption beside a
    // Pending chip says two things at once.
    awaitPaid.mockResolvedValue(true);
    const tree = mount();
    await tapPay(tree);

    expect(payButton(tree).props.disabled).toBe(true);
    expect(drawnText(cta(tree))).toBe("Confirming payment…");
    expect(card(tree)).toContain("Pending");
    expect(card(tree)).toContain(PENDING_COPY);
    expect(screenText(tree)).not.toContain(paidCopy("Fall dues"));
    expect(payButton(tree).props.accessibilityHint).toBe(PENDING_COPY);

    invoices = [paid(FALL)];
    rerender(tree);
    expect(card(tree)).toContain("You're all paid up");
    expect(card(tree)).toContain(paidCopy("Fall dues"));
    expect(screenText(tree)).not.toContain(PENDING_COPY);
  });

  it("keeps the pending state when the poll itself fails", async () => {
    // A failed read says nothing about the payment: re-offering Pay here would
    // invite a second payment for a bill the member just paid.
    awaitPaid.mockRejectedValue(new Error("network"));
    const tree = mount();
    await tapPay(tree);

    expect(payButton(tree).props.disabled).toBe(true);
    expect(drawnText(payButton(tree))).toBe("Confirming payment…");
    expect(card(tree)).toContain(PENDING_COPY);
  });

  it("pays the next open invoice while the paid one confirms", async () => {
    // Fall is due first, so it is what Pay settles, and it is what the member
    // just paid. Holding the only Pay on it kept Social unpayable for the
    // whole hold.
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);
    expect(paidFor(0)).toBe("inv-fall");

    const footnote = "Pays Social fee — $50.00 of your balance.";
    expect(payButton(tree).props.disabled).toBe(false);
    expect(drawnText(cta(tree))).toBe("Pay now");
    expect(card(tree)).toContain(footnote);
    expect(card(tree)).not.toContain(PENDING_COPY);
    expect(payButton(tree).props.accessibilityHint).toBe(footnote);
    expect(drawnText(openRow(tree, "inv-fall"))).toContain("Pending");
    expect(drawnText(openRow(tree, "inv-social"))).not.toContain("Pending");

    await tapPay(tree);
    expect(paidFor(1)).toBe("inv-social");
  });

  it("holds Pay for the paid invoice only, so a bill that becomes due first stays payable", async () => {
    // Fall's webhook is slow, and meanwhile the treasurer bills an earlier
    // invoice. The card moves to it: it was never paid, so it must not read
    // Pending or have its Pay held.
    invoices = [FALL];
    const tree = mount();
    await tapPay(tree);

    invoices = [FALL, RUSH];
    rerender(tree);

    expect(payButton(tree).props.disabled).toBe(false);
    expect(card(tree)).not.toContain("Pending");
    expect(card(tree)).not.toContain(PENDING_COPY);
    expect(card(tree)).toContain("Pays Rush fee — $20.00 of your balance.");
    expect(drawnText(openRow(tree, "inv-fall"))).toContain("Pending");
    expect(drawnText(openRow(tree, "inv-rush"))).not.toContain("Pending");
  });

  it("says confirming with Pay off once every open invoice is held", async () => {
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);
    await tapPay(tree);
    expect(paidFor(1)).toBe("inv-social");

    expect(payButton(tree).props.disabled).toBe(true);
    expect(drawnText(cta(tree))).toBe("Confirming payment…");
    expect(card(tree)).toContain("2 invoices open");
    expect(card(tree)).toContain(PENDING_COPY);
    expect(drawnText(openRow(tree, "inv-fall"))).toContain("Pending");
    expect(drawnText(openRow(tree, "inv-social"))).toContain("Pending");
  });

  it("lets only the latest Pay attempt switch Pay back on", async () => {
    // Fall's poll is still running when the member pays Social. Its end used
    // to clear the flag Social's request had set, putting a live "Pay now"
    // under a request still in flight.
    invoices = [FALL, SOCIAL];
    const fallPoll = deferred<boolean>();
    const socialIntent = deferred<{ client_secret: string }>();
    awaitPaid.mockReturnValueOnce(fallPoll.promise);
    payInvoice
      .mockResolvedValueOnce({ client_secret: "pi_fall" })
      .mockReturnValueOnce(socialIntent.promise);
    const tree = mount();
    await tapPay(tree);
    await tapPay(tree);
    expect(drawnText(cta(tree))).toBe("Opening…");

    await act(async () => fallPoll.resolve(false));
    expect(drawnText(cta(tree))).toBe("Opening…");
    expect(cta(tree).props.disabled).toBe(true);

    await act(async () => socialIntent.resolve({ client_secret: "pi_social" }));
  });

  it("lets go once the list reads PAID, and says paid in the card", async () => {
    awaitPaid.mockResolvedValue(true);
    const tree = mount();
    await tapPay(tree);

    invoices = [paid(FALL)];
    rerender(tree);

    expect(card(tree)).toContain("You're all paid up");
    expect(card(tree)).toContain(paidCopy("Fall dues"));
    expect(screenText(tree)).not.toContain(PENDING_COPY);
  });

  it("leaves the next bill's footnote and hint alone, and drops the paid line on return", async () => {
    // The paid line used to take the caption slot under the next invoice's
    // live Pay, hiding the footnote naming it and becoming that button's hint.
    const LATER = invoice({
      id: "inv-later",
      title: "Formal fee",
      amount: 2000,
      due_date: "2099-11-01",
    });
    invoices = [FALL, SOCIAL, LATER];
    awaitPaid.mockResolvedValue(true);
    const tree = mount();
    await tapPay(tree);

    invoices = [paid(FALL), SOCIAL, LATER];
    rerender(tree);

    const footnote = "Pays Social fee — $50.00 of your balance.";
    expect(card(tree)).toContain(footnote);
    expect(card(tree)).toContain(paidCopy("Fall dues"));
    expect(payButton(tree).props.disabled).toBe(false);
    expect(payButton(tree).props.accessibilityHint).toBe(footnote);

    refetchInvoices.mockClear();
    await refocus();
    expect(screenText(tree)).not.toContain(paidCopy("Fall dues"));
    expect(card(tree)).toContain(footnote);

    // Settled and shown, so later visits stop forcing a re-read.
    await refocus();
    expect(refetchInvoices).not.toHaveBeenCalled();
  });

  it("says nothing more about a payment whose invoice was voided", async () => {
    // Only the list's PAID is a settled payment. A voided invoice is the
    // treasurer's to reconcile, not a "Paid …" line.
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);

    invoices = [{ ...FALL, status: "VOID" }, SOCIAL];
    rerender(tree);
    expect(screenText(tree)).not.toContain(PENDING_COPY);
    expect(screenText(tree)).not.toContain(paidCopy("Fall dues"));
    expect(card(tree)).toContain("Social fee");
  });

  it("keeps saying payment received when the list then fails to load", async () => {
    const tree = mount();
    await tapPay(tree);

    invoicesError = true;
    rerender(tree);

    expect(screenText(tree)).toContain("Couldn't load your dues");
    expect(screenText(tree)).toContain(PENDING_COPY);
  });

  it("keeps saying payment received while the list loads again", async () => {
    const tree = mount();
    await tapPay(tree);

    invoicesPending = true;
    rerender(tree);

    expect(tree.root.findAllByType(CardListSkeleton)).toHaveLength(1);
    expect(screenText(tree)).toContain(PENDING_COPY);
  });

  it("keeps saying payment received when the account then fails to load", async () => {
    const tree = mount();
    await tapPay(tree);

    viewerError = true;
    rerender(tree);

    expect(screenText(tree)).toContain("Couldn't load your account");
    expect(screenText(tree)).toContain(PENDING_COPY);
  });

  describe("when the webhook never lands", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const endHold = () =>
      act(() => {
        vi.advanceTimersByTime(PENDING_HOLD_MS);
      });

    it("lets Pay come back after the hold, says so plainly, and shows the server's refusal", async () => {
      // Holding Pay until a force-quit hid a failed reconciliation behind
      // "Confirming…". The server, not the hold, refuses a second payment.
      const tree = mount();
      await tapPay(tree);
      expect(payButton(tree).props.disabled).toBe(true);

      refetchInvoices.mockClear();
      act(() => {
        vi.advanceTimersByTime(PENDING_HOLD_MS - 1000);
      });
      expect(payButton(tree).props.disabled).toBe(true);

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(refetchInvoices).toHaveBeenCalled();
      expect(payButton(tree).props.disabled).toBe(false);
      expect(drawnText(cta(tree))).toBe("Pay now");
      expect(card(tree)).toContain(unconfirmedCopy("Fall dues"));
      expect(card(tree)).not.toContain(PENDING_COPY);
      expect(card(tree)).not.toContain("Pending");

      const refusal =
        "Payment already completed; confirmation is being processed";
      payInvoice.mockRejectedValue({ statusCode: 409, message: refusal });
      await tapPay(tree);
      expect(card(tree)).toContain(refusal);
      expect(presentPaymentSheet).toHaveBeenCalledTimes(1);
    });

    it("says it on the invoice's row when Pay settles another one, and keeps saying it", async () => {
      // An earlier-due bill arrived during the hold, so the card is about it.
      // The paid invoice's own row is then the only place left to say its
      // payment went through, and paying the other bill must not erase that.
      invoices = [FALL, SOCIAL];
      const tree = mount();
      await tapPay(tree);
      invoices = [FALL, SOCIAL, RUSH];
      rerender(tree);
      endHold();

      const fallRow = drawnText(openRow(tree, "inv-fall"));
      expect(fallRow).toContain(UNCONFIRMED_ROW_COPY);
      expect(fallRow).not.toContain("Pending");
      expect(card(tree)).toContain("Pays Rush fee — $20.00 of your balance.");
      expect(card(tree)).not.toContain(UNCONFIRMED_ROW_COPY);

      await tapPay(tree);
      expect(paidFor(1)).toBe("inv-rush");
      expect(drawnText(openRow(tree, "inv-fall"))).toContain(
        UNCONFIRMED_ROW_COPY,
      );
      expect(drawnText(openRow(tree, "inv-rush"))).toContain("Pending");
    });

    it("says it on the card and the row when Pay settles that invoice again", async () => {
      invoices = [FALL, SOCIAL];
      const tree = mount();
      await tapPay(tree);
      endHold();

      expect(card(tree)).toContain(unconfirmedCopy("Fall dues"));
      expect(payButton(tree).props.accessibilityHint).toBe(
        unconfirmedCopy("Fall dues"),
      );
      expect(drawnText(openRow(tree, "inv-fall"))).toContain(
        UNCONFIRMED_ROW_COPY,
      );
      await tapPay(tree);
      expect(paidFor(1)).toBe("inv-fall");
    });

    it("drops the server's refusal once its invoice settles", async () => {
      // The refusal was about Fall. Left in place, it sat under the next
      // invoice's live Pay as that button's hint, and under "all paid up".
      invoices = [FALL, SOCIAL];
      const tree = mount();
      await tapPay(tree);
      endHold();
      const refusal =
        "Payment already completed; confirmation is being processed";
      payInvoice.mockRejectedValue({ statusCode: 409, message: refusal });
      await tapPay(tree);
      expect(card(tree)).toContain(refusal);

      invoices = [paid(FALL), SOCIAL];
      rerender(tree);
      expect(screenText(tree)).not.toContain(refusal);
      expect(card(tree)).toContain("Social fee");
      expect(payButton(tree).props.accessibilityHint).toBeUndefined();

      invoices = [paid(FALL), paid(SOCIAL)];
      rerender(tree);
      expect(card(tree)).toContain("You're all paid up");
      expect(screenText(tree)).not.toContain(refusal);
    });

    it("stops the hold's timer with the screen", async () => {
      // A timer that outlived the screen fired a stray list read after
      // sign-out.
      const tree = render();
      await tapPay(tree);
      act(() => tree.unmount());

      refetchInvoices.mockClear();
      endHold();
      expect(refetchInvoices).not.toHaveBeenCalled();
    });

    it("keeps one chapter's payment off another chapter's dues", async () => {
      // The tab stays mounted through a chapter switch. Until the next
      // chapter's list loads, nothing says the paid invoice left OPEN, so its
      // pending line stood on that chapter's skeleton and its hold timer ran
      // on there, re-reading the other chapter's list.
      const tree = mount();
      await tapPay(tree);
      expect(card(tree)).toContain(PENDING_COPY);

      chapterId = "ch-other";
      invoicesPending = true;
      rerender(tree);
      expect(tree.root.findAllByType(CardListSkeleton)).toHaveLength(1);
      expect(screenText(tree)).not.toContain(PENDING_COPY);

      refetchInvoices.mockClear();
      endHold();
      expect(refetchInvoices).not.toHaveBeenCalled();

      invoicesPending = false;
      invoices = [
        invoice({ id: "inv-other", title: "Other chapter dues", amount: 9000 }),
      ];
      rerender(tree);
      expect(card(tree)).toContain("Other chapter dues");
      expect(screenText(tree)).not.toContain(unconfirmedCopy("Fall dues"));
      expect(payButton(tree).props.disabled).toBe(false);
    });
  });

  it("draws a failed payment inside the card, and leaves Pay live for a retry", async () => {
    presentPaymentSheet.mockResolvedValue({
      kind: "failed",
      message: "Your card was declined.",
    });
    const tree = mount();
    await tapPay(tree);

    expect(card(tree)).toContain("Your card was declined.");
    expect(screenText(tree).split("Your card was declined.").length - 1).toBe(
      1,
    );
    expect(payButton(tree).props.disabled).toBe(false);
  });
});

describe("Dues after a failed payment", () => {
  const DECLINED = "Your card was declined.";
  beforeEach(() => {
    presentPaymentSheet.mockResolvedValue({
      kind: "failed",
      message: DECLINED,
    });
  });

  it("keeps the failure on its invoice when Pay moves to another", async () => {
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);
    expect(card(tree)).toContain(DECLINED);

    // The treasurer records Fall as paid in cash.
    invoices = [paid(FALL), SOCIAL];
    rerender(tree);
    expect(screenText(tree)).not.toContain(DECLINED);
    expect(card(tree)).toContain("Social fee");
    expect(payButton(tree).props.accessibilityHint).toBeUndefined();
  });

  it("drops it once Pay moves on, rather than bringing it back", async () => {
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);

    invoices = [FALL, SOCIAL, RUSH];
    rerender(tree);
    expect(screenText(tree)).not.toContain(DECLINED);

    // Rush is voided, and Pay is back on Fall: the old decline is not news.
    invoices = [FALL, SOCIAL];
    rerender(tree);
    expect(screenText(tree)).not.toContain(DECLINED);
    expect(card(tree)).toContain("Pays Fall dues — $425.00 of your balance.");
  });

  it("drops it when the member comes back to the screen", async () => {
    const tree = mount();
    await tapPay(tree);
    expect(card(tree)).toContain(DECLINED);

    await refocus();
    expect(screenText(tree)).not.toContain(DECLINED);
  });

  it("keeps a failure in one chapter off another chapter's card", async () => {
    const tree = mount();
    await tapPay(tree);

    // The same invoice id under another chapter, so only the chapter tells
    // the failure apart.
    chapterId = "ch-other";
    rerender(tree);
    expect(screenText(tree)).not.toContain(DECLINED);
  });
});
