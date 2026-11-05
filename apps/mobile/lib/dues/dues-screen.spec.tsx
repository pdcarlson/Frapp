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
const UNCONFIRMED_COPY =
  "Your payment went through, but your chapter's records haven't caught up yet. Check back later, or ask your treasurer if this stays open.";
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

beforeEach(() => {
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
    expect(card(tree)).toContain("Pending");
    expect(card(tree)).toContain(PENDING_COPY);
    // Drawn once, in the card: not as a caption above it.
    expect(screenText(tree).split(PENDING_COPY).length - 1).toBe(1);

    // Coming back to the screen re-reads the list, and still holds the latch.
    await refocus();
    expect(refetchInvoices).toHaveBeenCalled();
    expect(payButton(tree).props.disabled).toBe(true);
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

  it("marks the pending bill in the OPEN list too", async () => {
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);

    expect(drawnText(openRow(tree, "inv-fall"))).toContain("Pending");
    expect(drawnText(openRow(tree, "inv-social"))).not.toContain("Pending");
  });

  it("holds Pay for the paid invoice only, so a bill that becomes due first stays payable", async () => {
    // Fall's webhook is slow, and meanwhile the treasurer bills an earlier
    // invoice. The card moves to it: it was never paid, so it must not read
    // Pending or have its Pay held.
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);

    const EARLIER = invoice({
      id: "inv-rush",
      title: "Rush fee",
      amount: 2000,
      due_date: "2099-08-01",
    });
    invoices = [FALL, SOCIAL, EARLIER];
    rerender(tree);

    expect(payButton(tree).props.disabled).toBe(false);
    expect(card(tree)).not.toContain("Pending");
    expect(card(tree)).not.toContain(PENDING_COPY);
    expect(card(tree)).toContain("Pays Rush fee — $20.00 of your balance.");
    expect(drawnText(openRow(tree, "inv-fall"))).toContain("Pending");
    expect(drawnText(openRow(tree, "inv-rush"))).not.toContain("Pending");
  });

  it("lets go once the list reads PAID, and says paid in the card", async () => {
    awaitPaid.mockResolvedValue(true);
    const tree = mount();
    await tapPay(tree);

    invoices = [invoice({ status: "PAID", paid_at: "2099-09-01T12:00:00Z" })];
    rerender(tree);

    expect(card(tree)).toContain("You're all paid up");
    expect(card(tree)).toContain(paidCopy("Fall dues"));
    expect(screenText(tree)).not.toContain(PENDING_COPY);
  });

  it("leaves the next bill's footnote and hint alone, and drops the paid line on return", async () => {
    // The paid line used to take the caption slot under the next invoice's
    // live Pay, hiding the footnote naming it and becoming that button's hint.
    const RUSH = invoice({
      id: "inv-rush",
      title: "Rush fee",
      amount: 2000,
      due_date: "2099-11-01",
    });
    invoices = [FALL, SOCIAL, RUSH];
    awaitPaid.mockResolvedValue(true);
    const tree = mount();
    await tapPay(tree);

    invoices = [
      invoice({ status: "PAID", paid_at: "2099-09-01T12:00:00Z" }),
      SOCIAL,
      RUSH,
    ];
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
      expect(card(tree)).toContain(UNCONFIRMED_COPY);
      expect(card(tree)).not.toContain(PENDING_COPY);
      expect(card(tree)).not.toContain("Pending");

      const refusal =
        "Payment already completed; confirmation is being processed";
      payInvoice.mockRejectedValue({ statusCode: 409, message: refusal });
      await tapPay(tree);
      expect(card(tree)).toContain(refusal);
      expect(presentPaymentSheet).toHaveBeenCalledTimes(1);
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
