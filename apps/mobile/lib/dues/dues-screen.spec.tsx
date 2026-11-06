/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { focusManager } from "@tanstack/react-query";
import { AppState } from "react-native";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";

/**
 * s11 rendered: the open bills it lists, the shape it loads in, and where a
 * payment's outcome is drawn.
 *
 * It renders `app/(app)/dues.tsx` but lives here: a spec under `app/` ships
 * as a route module (`lib/routes.spec.ts`).
 */

const VIEWER = "u-1";
const PENDING_COPY =
  "Payment received, confirmation pending. This updates as soon as your chapter's records catch up.";
/** The pending line on a card counting two or more open invoices. */
const pendingCopyFor = (title: string) =>
  `Payment received for ${title}, confirmation pending. This updates as soon as your chapter's records catch up.`;
const paidCopy = (title: string) =>
  `Paid ${title}. Your chapter has it — thanks.`;
const voidedCopy = (title: string) =>
  `Payment received for ${title}, but your chapter has cancelled that invoice. Ask your treasurer about it.`;
const droppedCopy = (title: string) =>
  `Payment received for ${title}, but that invoice is no longer on your dues. Ask your treasurer about it.`;
const DECLINED = "Your card was declined.";
/** The server's 409 for an invoice whose stored intent already succeeded. */
const REFUSAL = "Payment already completed; confirmation is being processed";

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
/** Due before Fall, for a bill issued while Fall's payment confirms. */
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
/** `null` while `/v1/users/me` hasn't answered. */
let viewerId: string | null = VIEWER;
const refetchInvoices = vi.fn();
const refetchViewer = vi.fn();
const payInvoice = vi.fn();
const awaitPaid = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => chapterId,
  useViewerUserId: () => viewerId,
  useCurrentUser: () => ({
    isError: viewerError,
    isFetching: false,
    refetch: refetchViewer,
  }),
  // `isEnabled` follows the screen's `enabled`, as a TanStack result's does.
  useInvoices: (_userId?: string, options?: { enabled?: boolean }) => ({
    data: invoicesPending ? undefined : invoices,
    isPending: invoicesPending,
    isError: invoicesError,
    isFetching: false,
    isEnabled: options?.enabled ?? true,
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

import DuesScreen from "@/app/(app)/dues";
import { forgetDuesMemory } from "@/lib/dues/visit-memory";
import {
  BalanceCard,
  BalanceCardSkeleton,
} from "@/components/dues/balance-card";
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

/** "Another screen is over this one" (vitest.setup.ts's expo-router). */
function blur() {
  (expoRouter as unknown as { __blur: () => void }).__blur();
}

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

/** The listener the screen registered last with the mocked `AppState`. */
function appStateListener(): (state: string) => void {
  const calls = vi.mocked(AppState.addEventListener).mock.calls;
  return calls[calls.length - 1]![1] as (state: string) => void;
}

/** The app goes through `states`, in order, as AppState reports them. */
function appGoes(...states: string[]) {
  const listener = appStateListener();
  act(() => {
    for (const state of states) listener(state);
  });
}

function flatten(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (acc, entry) => ({ ...acc, ...flatten(entry) }),
      {},
    );
  }
  return style && typeof style === "object"
    ? (style as Record<string, unknown>)
    : {};
}

/** The one `Text` drawing exactly `text`. */
const line = (tree: ReactTestRenderer, text: string) =>
  tree.root.find(
    (node) => node.type === ("Text" as never) && drawnText(node) === text,
  );

const DESTRUCTIVE = signetDarkTokens.color.semantic.destructive;

beforeEach(() => {
  // Captured payments outlive the screen by design; each test starts clean.
  forgetDuesMemory();
  chapterId = "ch-tau-nu";
  invoices = [FALL];
  invoicesPending = false;
  invoicesError = false;
  viewerError = false;
  viewerId = VIEWER;
  focusManager.setFocused(undefined);
  refetchInvoices.mockReset().mockResolvedValue(undefined);
  refetchViewer.mockReset().mockResolvedValue(undefined);
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
    // The balance card's own skeleton, so the card doesn't grow in on load.
    expect(tree.root.findAllByType(BalanceCardSkeleton)).toHaveLength(1);
    // Its writing.md row, without the ellipsis, as the region's name.
    expect(
      tree.root.find(
        (node) =>
          (node.type as unknown) === "View" &&
          node.props.accessibilityRole === "progressbar",
      ).props.accessibilityLabel,
    ).toBe("Loading your dues");
  });
});

describe("Dues pull-to-refresh (#3385)", () => {
  /**
   * Pulls the screen down. The stand-in ScrollView doesn't draw its
   * `refreshControl`, so this calls the `refresh` that element was handed.
   */
  async function pull(tree: ReactTestRenderer) {
    const scroll = tree.root.find(
      (node) =>
        node.type === ("ScrollView" as never) &&
        node.props.refreshControl != null,
    );
    await act(async () => {
      await scroll.props.refreshControl.props.refresh();
    });
  }

  it("refreshes the viewer and their invoices on a pull (#3385)", async () => {
    const tree = mount();
    await pull(tree);

    expect(refetchViewer).toHaveBeenCalledWith({ cancelRefetch: true });
    expect(refetchInvoices).toHaveBeenCalledWith({ cancelRefetch: true });
  });

  it("leaves the invoice read alone on a pull while the viewer's id is unknown", async () => {
    // Unscoped, the read would ask for the whole chapter's ledger.
    viewerId = null;
    const tree = mount();
    refetchInvoices.mockClear();
    await pull(tree);

    expect(refetchViewer).toHaveBeenCalledTimes(1);
    expect(refetchInvoices).not.toHaveBeenCalled();
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
  it("holds the paid invoice while its poll runs: Pending, Pay off as Confirming payment…, and the pending line in the card", async () => {
    awaitPaid.mockReturnValue(deferred<boolean>().promise);
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
    expect(drawnText(cta(tree))).not.toBe("Opening…");
  });

  it("leaves Pay live under the pending line once the poll is over", async () => {
    // Nothing the server sends says a payment failed, so a member who got
    // the decline push pays again from here. The server refuses a second
    // charge itself.
    const tree = mount();
    await tapPay(tree);

    expect(payButton(tree).props.disabled).toBe(false);
    expect(drawnText(cta(tree))).toBe("Pay now");
    expect(payButton(tree).props.accessibilityHint).toBe(PENDING_COPY);
    expect(card(tree)).toContain("Pending");
    expect(card(tree)).toContain(PENDING_COPY);
  });

  it("stays confirming when the poll says PAID but the list still reads OPEN", async () => {
    // The poll's PAID re-reads the list, but that read is a round trip away.
    // A "Paid" line beside a Pending chip says two things at once.
    awaitPaid.mockResolvedValue(true);
    const tree = mount();
    await tapPay(tree);

    expect(card(tree)).toContain("Pending");
    expect(card(tree)).toContain(PENDING_COPY);
    expect(screenText(tree)).not.toContain(paidCopy("Fall dues"));
  });

  it("lets go once the list reads the invoice PAID, and says paid then", async () => {
    awaitPaid.mockResolvedValue(true);
    const tree = mount();
    await tapPay(tree);

    invoices = [paid(FALL)];
    rerender(tree);

    expect(card(tree)).toContain("You're all paid up");
    expect(card(tree)).toContain(paidCopy("Fall dues"));
    expect(card(tree)).not.toContain("Pending");
    expect(screenText(tree)).not.toContain(PENDING_COPY);
  });

  it("keeps the hold when the poll itself fails", async () => {
    // A failed read says nothing about the payment.
    awaitPaid.mockRejectedValue(new Error("network"));
    const tree = mount();
    await tapPay(tree);

    expect(card(tree)).toContain("Pending");
    expect(card(tree)).toContain(PENDING_COPY);
  });

  it("keeps the card on the confirming invoice while the others wait, then pays the next", async () => {
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);
    expect(paidFor(0)).toBe("inv-fall");

    expect(card(tree)).toContain("2 invoices open");
    expect(card(tree)).toContain(pendingCopyFor("Fall dues"));
    expect(card(tree)).not.toContain("Pays Social fee");
    // The rows: the confirming one as Pending, the other with its amount and
    // due chip, and no line of its own under either.
    expect(drawnText(openRow(tree, "inv-fall"))).toBe(
      "Fall dues$425.00Pending",
    );
    expect(drawnText(openRow(tree, "inv-social"))).toMatch(
      /^Social fee\$50\.00Due Oct\s?1$/,
    );
    // Pay is still about Fall, for a retry.
    presentPaymentSheet.mockResolvedValueOnce({ kind: "canceled" });
    await tapPay(tree);
    expect(paidFor(1)).toBe("inv-fall");

    invoices = [paid(FALL), SOCIAL];
    rerender(tree);
    expect(payButton(tree).props.disabled).toBe(false);
    expect(card(tree)).toContain("Social fee");
    expect(card(tree)).toContain(paidCopy("Fall dues"));
    await tapPay(tree);
    expect(paidFor(2)).toBe("inv-social");
  });

  it("stays on the confirming invoice when an earlier-due bill is issued during the hold", async () => {
    // The More hub's chip names Rush now; the card doesn't move until Fall
    // settles, and Rush's own row reads as due, not Pending.
    const tree = mount();
    await tapPay(tree);

    invoices = [FALL, RUSH];
    rerender(tree);

    expect(card(tree)).toContain(pendingCopyFor("Fall dues"));
    expect(card(tree)).not.toContain("Pays Rush fee");
    // What the card is about, though the pending line covers its footnote.
    expect(tree.root.findByType(BalanceCard).props.footnote).toBe(
      "Pays Fall dues — $425.00 of your balance.",
    );
    expect(drawnText(openRow(tree, "inv-fall"))).toContain("Pending");
    expect(drawnText(openRow(tree, "inv-rush"))).not.toContain("Pending");
    presentPaymentSheet.mockResolvedValueOnce({ kind: "canceled" });
    await tapPay(tree);
    expect(paidFor(1)).toBe("inv-fall");

    invoices = [paid(FALL), RUSH];
    rerender(tree);
    expect(card(tree)).toContain("Rush fee");
  });

  it("lets only the latest Pay attempt switch Pay back on", async () => {
    // Fall's poll is still running when the list settles Fall and the member
    // pays Social. Its end used to clear the flag Social's request had set,
    // putting a live "Pay now" under a request still in flight.
    invoices = [FALL, SOCIAL];
    const fallPoll = deferred<boolean>();
    const socialIntent = deferred<{ client_secret: string }>();
    awaitPaid.mockReturnValueOnce(fallPoll.promise);
    payInvoice
      .mockResolvedValueOnce({ client_secret: "pi_fall" })
      .mockReturnValueOnce(socialIntent.promise);
    const tree = mount();
    await tapPay(tree);
    invoices = [paid(FALL), SOCIAL];
    rerender(tree);
    await tapPay(tree);
    expect(paidFor(1)).toBe("inv-social");
    expect(drawnText(cta(tree))).toBe("Opening…");

    await act(async () => fallPoll.resolve(false));
    expect(drawnText(cta(tree))).toBe("Opening…");
    expect(cta(tree).props.disabled).toBe(true);

    await act(async () => socialIntent.resolve({ client_secret: "pi_social" }));
  });

  it("says which invoice a live Pay pays when the hold outlasts the poll with two open", async () => {
    // "2 invoices open" names neither, and the pending line takes the
    // footnote's slot, so the line names the held invoice and the CTA's hint
    // says what a tap pays: Fall again, not the $50 Social fee.
    invoices = [FALL, SOCIAL];
    const poll = deferred<boolean>();
    awaitPaid.mockReturnValueOnce(poll.promise);
    const tree = mount();
    await tapPay(tree);
    // While the poll runs the CTA is off, and its hint is why.
    expect(payButton(tree).props.disabled).toBe(true);
    expect(payButton(tree).props.accessibilityHint).toBe(
      pendingCopyFor("Fall dues"),
    );

    await act(async () => poll.resolve(false));
    expect(card(tree)).toContain("2 invoices open");
    expect(payButton(tree).props.disabled).toBe(false);
    expect(card(tree)).toContain(pendingCopyFor("Fall dues"));
    expect(screenText(tree)).not.toContain(PENDING_COPY);
    expect(payButton(tree).props.accessibilityHint).toBe(
      "Pays Fall dues — $425.00 of your balance.",
    );
  });

  it("keeps Pay confirming when an earlier attempt's poll ends during a later one's", async () => {
    // Fall's poll is still running when the treasurer voids Fall, which frees
    // Pay for Social. Social's sheet completes and its poll starts; Fall's
    // poll ending then must not switch Pay back on under Social's.
    invoices = [FALL, SOCIAL];
    const fallPoll = deferred<boolean>();
    const socialPoll = deferred<boolean>();
    awaitPaid
      .mockReturnValueOnce(fallPoll.promise)
      .mockReturnValueOnce(socialPoll.promise);
    const tree = mount();
    await tapPay(tree);
    invoices = [{ ...FALL, status: "VOID" }, SOCIAL];
    rerender(tree);
    await tapPay(tree);
    expect(paidFor(1)).toBe("inv-social");
    expect(drawnText(cta(tree))).toBe("Confirming payment…");

    await act(async () => fallPoll.resolve(false));
    expect(drawnText(cta(tree))).toBe("Confirming payment…");
    expect(cta(tree).props.disabled).toBe(true);

    await act(async () => socialPoll.resolve(false));
    expect(drawnText(cta(tree))).toBe("Pay now");
  });

  it("keeps the voided line for the rest of the visit when the member then pays the next invoice", async () => {
    // One slot for the captured payment used to be overwritten by Social's,
    // taking Fall's cancelled line with it mid-visit.
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);
    invoices = [{ ...FALL, status: "VOID" }, SOCIAL];
    rerender(tree);
    expect(card(tree)).toContain(voidedCopy("Fall dues"));

    await tapPay(tree);
    expect(paidFor(1)).toBe("inv-social");
    expect(card(tree)).toContain(voidedCopy("Fall dues"));
    expect(card(tree)).toContain("Pending");
    expect(card(tree)).toContain(PENDING_COPY);

    invoices = [{ ...FALL, status: "VOID" }, paid(SOCIAL)];
    rerender(tree);
    expect(card(tree)).toContain(voidedCopy("Fall dues"));
    expect(card(tree)).toContain(paidCopy("Social fee"));

    // Both are done with on the next visit.
    await refocus();
    expect(screenText(tree)).not.toContain(voidedCopy("Fall dues"));
    expect(screenText(tree)).not.toContain(paidCopy("Social fee"));
  });

  it("shows the Paid line in the next visit when the list read PAID while the member was away", async () => {
    // The screen stays mounted, so the poll's own re-read as it ends can
    // read PAID with another screen over this one. That line was never seen,
    // so the return draws it, and the visit after that drops it.
    const tree = mount();
    await tapPay(tree);
    act(() => blur());
    invoices = [paid(FALL)];
    rerender(tree);

    await refocus();
    expect(card(tree)).toContain(paidCopy("Fall dues"));
    await refocus();
    expect(screenText(tree)).not.toContain(paidCopy("Fall dues"));
  });

  it("shows the Paid line when the app comes back if the list read PAID while it was away", async () => {
    const tree = mount();
    await tapPay(tree);
    appGoes("background");
    invoices = [paid(FALL)];
    rerender(tree);

    appGoes("active");
    expect(card(tree)).toContain(paidCopy("Fall dues"));
    appGoes("background", "active");
    expect(screenText(tree)).not.toContain(paidCopy("Fall dues"));
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
    // Settled, so coming back doesn't force a re-read.
    expect(refetchInvoices).not.toHaveBeenCalled();
  });

  it("says the paid invoice was cancelled, naming it, when it is voided, and frees Pay", async () => {
    // A treasurer can void an OPEN invoice with a captured payment on it.
    // The member was still charged, so a line stays, on its own and naming
    // Fall, since the card is about Social now. VOID is terminal, so it
    // promises no update; it isn't a "Paid …" line, which only PAID earns.
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);

    invoices = [{ ...FALL, status: "VOID" }, SOCIAL];
    rerender(tree);
    expect(card(tree)).toContain(voidedCopy("Fall dues"));
    expect(screenText(tree).split(voidedCopy("Fall dues")).length - 1).toBe(1);
    expect(screenText(tree)).not.toContain(PENDING_COPY);
    expect(screenText(tree)).not.toContain(paidCopy("Fall dues"));
    expect(card(tree)).toContain("Social fee");
    expect(card(tree)).not.toContain("Pending");
    expect(payButton(tree).props.disabled).toBe(false);
    // It isn't the next invoice's hint.
    expect(payButton(tree).props.accessibilityHint).toBeUndefined();

    // Still there on the next read in the same visit, and done with on the
    // next visit, when History shows Fall as cancelled.
    invoices = [{ ...FALL, status: "VOID" }, SOCIAL];
    rerender(tree);
    expect(card(tree)).toContain(voidedCopy("Fall dues"));
    await refocus();
    expect(screenText(tree)).not.toContain(voidedCopy("Fall dues"));
    expect(screenText(tree)).toContain("Cancelled by your chapter");
  });

  it("says the paid invoice is gone, naming it, when it drops out of the list, until it reads PAID", async () => {
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);

    invoices = [SOCIAL];
    rerender(tree);
    expect(card(tree)).toContain(droppedCopy("Fall dues"));
    expect(screenText(tree)).not.toContain(PENDING_COPY);
    expect(payButton(tree).props.disabled).toBe(false);

    invoices = [paid(FALL), SOCIAL];
    rerender(tree);
    expect(screenText(tree)).not.toContain(droppedCopy("Fall dues"));
    expect(card(tree)).toContain(paidCopy("Fall dues"));
  });

  it("says the paid invoice is gone when it was the only one", async () => {
    const tree = mount();
    await tapPay(tree);

    invoices = [];
    rerender(tree);
    expect(screenText(tree)).toContain("No dues yet");
    expect(screenText(tree)).toContain(droppedCopy("Fall dues"));
  });

  it("holds through a re-read inside the visit that still reads OPEN", async () => {
    const tree = mount();
    await tapPay(tree);

    invoices = [{ ...FALL }];
    rerender(tree);
    expect(card(tree)).toContain("Pending");
    expect(card(tree)).toContain(PENDING_COPY);
  });

  it("keeps the hold when the member swipes back out of Dues and opens it again", async () => {
    // Dues is pushed on the stack, so going back unmounts it. The hold must
    // outlive that, or Pay would be live on an invoice just paid.
    const first = mount();
    await tapPay(first);
    expect(card(first)).toContain(PENDING_COPY);
    act(() => blur());
    act(() => first.unmount());
    await refocus();

    const again = mount();
    expect(card(again)).toContain("Pending");
    expect(card(again)).toContain(PENDING_COPY);

    invoices = [paid(FALL)];
    rerender(again);
    expect(card(again)).toContain(paidCopy("Fall dues"));
  });

  it("keeps the hold when the member leaves and comes back, re-reading the list", async () => {
    // billing.md: the pending line stands until the server reports PAID.
    // The hold is still there on return, and the return asks whether the
    // webhook landed meanwhile.
    const tree = mount();
    await tapPay(tree);

    refetchInvoices.mockClear();
    act(() => blur());
    await refocus();
    // Joining a read in flight, as the 10s re-reads do.
    expect(refetchInvoices).toHaveBeenLastCalledWith({ cancelRefetch: false });
    expect(card(tree)).toContain("Pending");
    expect(card(tree)).toContain(PENDING_COPY);

    // The re-read finds it PAID: the "Paid …" line, in this new visit.
    invoices = [paid(FALL)];
    rerender(tree);
    expect(card(tree)).toContain(paidCopy("Fall dues"));
  });

  it("keeps the hold when the app comes back from the background, re-reading the list", async () => {
    // The member left to check their bank or read a push.
    const tree = mount();
    await tapPay(tree);

    refetchInvoices.mockClear();
    appGoes("inactive", "background", "active");
    expect(refetchInvoices).toHaveBeenLastCalledWith({ cancelRefetch: false });
    expect(card(tree)).toContain("Pending");
    expect(card(tree)).toContain(PENDING_COPY);
  });

  it("re-reads on a return that passes through inactive", async () => {
    const tree = mount();
    await tapPay(tree);

    refetchInvoices.mockClear();
    appGoes("background", "inactive", "active");
    expect(refetchInvoices).toHaveBeenCalledTimes(1);
    expect(card(tree)).toContain(PENDING_COPY);
  });

  it("starts no visit for an iOS inactive spell, which is no leave", async () => {
    // Control Center, a system sheet: `inactive`, never `background`.
    const tree = mount();
    await tapPay(tree);

    refetchInvoices.mockClear();
    appGoes("inactive", "active");
    expect(refetchInvoices).not.toHaveBeenCalled();
    expect(card(tree)).toContain(PENDING_COPY);
  });

  it("starts no visit when the background spell began during the Pay attempt", async () => {
    // A bank's page opened from the sheet sends the app to the background,
    // and the sheet can report back before AppState says the app is active
    // again. That return is the attempt's own, so its outcome stays.
    const sheet = deferred<{ kind: "failed"; message: string }>();
    presentPaymentSheet.mockReturnValue(sheet.promise);
    const tree = mount();
    await tapPay(tree);
    expect(drawnText(cta(tree))).toBe("Opening…");

    appGoes("background");
    await act(async () => sheet.resolve({ kind: "failed", message: DECLINED }));
    appGoes("active");
    expect(card(tree)).toContain(DECLINED);

    // The next spell away, after the attempt, is a leave.
    appGoes("background", "active");
    expect(screenText(tree)).not.toContain(DECLINED);
  });

  it("opens the sheet on the same intent when the member pays again during the hold", async () => {
    // Processing, then failed: the server hands back the stored intent,
    // now waiting on a payment method, and the sheet takes a new one on it.
    const tree = mount();
    await tapPay(tree);
    appGoes("background", "active");

    presentPaymentSheet.mockClear();
    await tapPay(tree);
    expect(paidFor(1)).toBe("inv-fall");
    expect(presentPaymentSheet).toHaveBeenLastCalledWith(
      expect.objectContaining({ clientSecret: "pi_secret" }),
    );
  });

  it("shows the server's 409 on the card when the member pays again during the hold", async () => {
    // The payment went through but the webhook is stuck: the server, not
    // the screen, refuses a second payment, and says so as it wrote it.
    const tree = mount();
    await tapPay(tree);
    act(() => blur());
    await refocus();

    payInvoice.mockRejectedValue({ statusCode: 409, message: REFUSAL });
    presentPaymentSheet.mockClear();
    await tapPay(tree);
    expect(paidFor(1)).toBe("inv-fall");
    expect(card(tree)).toContain(REFUSAL);
    expect(flatten(line(tree, REFUSAL).props.style).color).toBe(DESTRUCTIVE);
    expect(payButton(tree).props.accessibilityHint).toBe(REFUSAL);
    expect(presentPaymentSheet).not.toHaveBeenCalled();
    // Still held: the refusal says the payment is there.
    expect(card(tree)).toContain("Pending");
  });

  it("sends no re-read while another screen is over this one", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const tree = mount();
      await tapPay(tree);
      refetchInvoices.mockClear();

      act(() => blur());
      act(() => vi.advanceTimersByTime(30_000));
      expect(refetchInvoices).not.toHaveBeenCalled();
      // The return re-reads once, and the 10s reads carry on with the hold.
      await refocus();
      expect(refetchInvoices).toHaveBeenCalledTimes(1);
      act(() => vi.advanceTimersByTime(30_000));
      expect(refetchInvoices).toHaveBeenCalledTimes(4);
      expect(card(tree)).toContain("Pending");
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-reads the list every 10s while the hold stands and the screen is up", async () => {
    // The poll gave up (12 × 2s) before the webhook landed. Nothing else
    // would ask again while the member stays on the screen.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const tree = mount();
      await tapPay(tree);
      refetchInvoices.mockClear();

      act(() => vi.advanceTimersByTime(9_999));
      expect(refetchInvoices).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(refetchInvoices).toHaveBeenCalledTimes(1);
      // It joins a read still in flight instead of cancelling it, so on a
      // network slower than 10s one read still finishes.
      expect(refetchInvoices).toHaveBeenLastCalledWith({
        cancelRefetch: false,
      });
      act(() => vi.advanceTimersByTime(10_000));
      expect(refetchInvoices).toHaveBeenCalledTimes(2);
      refetchInvoices.mockClear();

      // The app in the background (AppState, through focusManager): no reads.
      act(() => focusManager.setFocused(false));
      act(() => vi.advanceTimersByTime(30_000));
      expect(refetchInvoices).not.toHaveBeenCalled();
      act(() => focusManager.setFocused(undefined));

      // Settled: the re-reads stop.
      invoices = [paid(FALL)];
      rerender(tree);
      act(() => vi.advanceTimersByTime(30_000));
      expect(refetchInvoices).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends no re-read while the viewer is unknown, which would go out unfiltered", async () => {
    // A billing:view holder's unfiltered read is the whole chapter's ledger.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const tree = mount();
      await tapPay(tree);
      viewerId = null;
      rerender(tree);
      refetchInvoices.mockClear();

      act(() => vi.advanceTimersByTime(30_000));
      expect(refetchInvoices).not.toHaveBeenCalled();
      // Still holding, so the pending line stands on the skeleton.
      expect(screenText(tree)).toContain(PENDING_COPY);

      viewerId = VIEWER;
      rerender(tree);
      act(() => vi.advanceTimersByTime(10_000));
      expect(refetchInvoices).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("switches Pay back on after the poll's budget when a poll read never answers", async () => {
    // Android times no request out (#3433), so the poll can hang for good.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      awaitPaid.mockReturnValue(new Promise<boolean>(() => {}));
      const tree = mount();
      await tapPay(tree);
      expect(drawnText(cta(tree))).toBe("Confirming payment…");

      act(() => vi.advanceTimersByTime(23_999));
      expect(cta(tree).props.disabled).toBe(true);
      act(() => vi.advanceTimersByTime(1));
      expect(drawnText(cta(tree))).toBe("Pay now");
      expect(cta(tree).props.disabled).toBe(false);
      // Still held: only the list ends that.
      expect(card(tree)).toContain("Pending");
      expect(card(tree)).toContain(PENDING_COPY);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a confirming window that ran out while the member was away on the next visit", async () => {
    // A timer can come late after a spell in the background; the return
    // doesn't wait for it.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      awaitPaid.mockReturnValue(new Promise<boolean>(() => {}));
      const tree = mount();
      await tapPay(tree);
      appGoes("background");
      vi.setSystemTime(Date.now() + 25_000);
      expect(drawnText(cta(tree))).toBe("Confirming payment…");

      appGoes("active");
      expect(drawnText(cta(tree))).toBe("Pay now");
      expect(cta(tree).props.disabled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts no hold when the member closes the sheet", async () => {
    presentPaymentSheet.mockResolvedValue({ kind: "canceled" });
    const tree = mount();
    await tapPay(tree);

    expect(payButton(tree).props.disabled).toBe(false);
    expect(drawnText(cta(tree))).toBe("Pay now");
    expect(card(tree)).not.toContain("Pending");
    expect(screenText(tree)).not.toContain(PENDING_COPY);
    expect(awaitPaid).not.toHaveBeenCalled();
  });

  it("pays that invoice again on a fresh screen, and shows the server's 409 there", async () => {
    // The app was closed with the webhook still stuck, so the hold is gone
    // and Pay targets the invoice again.
    payInvoice.mockRejectedValue({ statusCode: 409, message: REFUSAL });
    const tree = mount();
    await tapPay(tree);
    expect(paidFor(0)).toBe("inv-fall");
    expect(card(tree)).toContain(REFUSAL);
    expect(payButton(tree).props.accessibilityHint).toBe(REFUSAL);
    expect(presentPaymentSheet).not.toHaveBeenCalled();
  });

  it("ends the hold when the chapter changes", async () => {
    // The screen can stay mounted through a chapter switch. Until the next
    // chapter's list loads, nothing says the paid invoice left OPEN, so the
    // pending line would stand on that chapter's skeleton.
    const tree = mount();
    await tapPay(tree);
    expect(card(tree)).toContain(PENDING_COPY);

    chapterId = "ch-other";
    invoicesPending = true;
    rerender(tree);
    expect(tree.root.findAllByType(CardListSkeleton)).toHaveLength(1);
    expect(screenText(tree)).not.toContain(PENDING_COPY);

    // The same invoice id under the other chapter, so only the chapter tells
    // the two apart.
    invoicesPending = false;
    rerender(tree);
    expect(payButton(tree).props.disabled).toBe(false);
    expect(screenText(tree)).not.toContain(PENDING_COPY);
  });

  it("keeps saying payment received when the list then fails to load, read out as it arrives", async () => {
    const tree = mount();
    await tapPay(tree);

    invoicesError = true;
    rerender(tree);

    expect(screenText(tree)).toContain("Couldn't load your dues");
    expect(screenText(tree)).toContain(PENDING_COPY);
    // The line a card would carry, with the card's live region and tone.
    const pending = line(tree, PENDING_COPY);
    expect(pending.props.accessibilityLiveRegion).toBe("polite");
    expect(flatten(pending.props.style).color).not.toBe(DESTRUCTIVE);
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
});

describe("Dues after a failed payment", () => {
  beforeEach(() => {
    presentPaymentSheet.mockResolvedValue({
      kind: "failed",
      message: DECLINED,
    });
  });

  it("draws it inside the card once, destructive, and leaves Pay live for a retry", async () => {
    const tree = mount();
    await tapPay(tree);

    expect(card(tree)).toContain(DECLINED);
    expect(flatten(line(tree, DECLINED).props.style).color).toBe(DESTRUCTIVE);
    expect(screenText(tree).split(DECLINED).length - 1).toBe(1);
    expect(payButton(tree).props.accessibilityHint).toBe(DECLINED);
    expect(payButton(tree).props.disabled).toBe(false);
  });

  it("never draws it as another invoice's caption or hint", async () => {
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);
    expect(card(tree)).toContain(DECLINED);

    // An earlier-due bill is issued, so the card is about Rush now.
    invoices = [FALL, SOCIAL, RUSH];
    rerender(tree);
    expect(screenText(tree)).not.toContain(DECLINED);
    expect(payButton(tree).props.accessibilityHint).toBe(
      "Pays Rush fee — $20.00 of your balance.",
    );

    // The treasurer records Fall as paid in cash.
    invoices = [paid(FALL), SOCIAL];
    rerender(tree);
    expect(screenText(tree)).not.toContain(DECLINED);
    expect(card(tree)).toContain("Social fee");
    expect(payButton(tree).props.accessibilityHint).toBeUndefined();
  });

  it("doesn't bring it back when the card returns to its invoice", async () => {
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);
    expect(card(tree)).toContain(DECLINED);

    // An earlier-due bill moves the card off Fall, then is paid on the web.
    invoices = [FALL, SOCIAL, RUSH];
    rerender(tree);
    invoices = [FALL, SOCIAL, paid(RUSH)];
    rerender(tree);
    expect(card(tree)).toContain("Fall dues");
    expect(screenText(tree)).not.toContain(DECLINED);
    expect(payButton(tree).props.accessibilityHint).not.toBe(DECLINED);
  });

  it("clears it when a new attempt starts", async () => {
    const tree = mount();
    await tapPay(tree);
    expect(card(tree)).toContain(DECLINED);

    const retry = deferred<{ client_secret: string }>();
    payInvoice.mockReturnValueOnce(retry.promise);
    await tapPay(tree);
    expect(drawnText(cta(tree))).toBe("Opening…");
    expect(screenText(tree)).not.toContain(DECLINED);

    presentPaymentSheet.mockResolvedValue({ kind: "canceled" });
    await act(async () => retry.resolve({ client_secret: "pi_retry" }));
  });

  it("drops it when the member comes back to the screen", async () => {
    const tree = mount();
    await tapPay(tree);
    expect(card(tree)).toContain(DECLINED);

    await refocus();
    expect(screenText(tree)).not.toContain(DECLINED);
  });

  it("drops it when the app comes back from the background, as a return to the screen does", async () => {
    // The member went to call their bank; the decline is about an attempt
    // they have moved on from.
    const tree = mount();
    await tapPay(tree);
    expect(card(tree)).toContain(DECLINED);

    appGoes("background", "active");
    expect(screenText(tree)).not.toContain(DECLINED);
    expect(payButton(tree).props.accessibilityHint).not.toBe(DECLINED);
  });

  it("still says it when the list then fails to load", async () => {
    // A read on return from the bank app can fail, and TanStack keeps the
    // rows; the member must still learn why the payment didn't go through.
    const tree = mount();
    await tapPay(tree);

    invoicesError = true;
    rerender(tree);
    expect(screenText(tree)).toContain("Couldn't load your dues");
    expect(screenText(tree)).toContain(DECLINED);
    const failure = line(tree, DECLINED);
    expect(flatten(failure.props.style).color).toBe(DESTRUCTIVE);
    expect(failure.props.accessibilityLiveRegion).toBe("polite");
  });

  it("still says it while the list loads again", async () => {
    const tree = mount();
    await tapPay(tree);

    invoicesPending = true;
    rerender(tree);
    expect(tree.root.findAllByType(CardListSkeleton)).toHaveLength(1);
    expect(screenText(tree)).toContain(DECLINED);
  });

  it("still says it when the account then fails to load", async () => {
    const tree = mount();
    await tapPay(tree);

    viewerError = true;
    rerender(tree);
    expect(screenText(tree)).toContain("Couldn't load your account");
    expect(screenText(tree)).toContain(DECLINED);
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

describe("Dues on a new visit", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The balance card's due chip, as drawn. */
  const chip = (tree: ReactTestRenderer) =>
    tree.root.findByType(BalanceCard).props.due?.label as string | undefined;

  it("takes the clock again when the app comes back, so a bill past due overnight says so", () => {
    // The app sat in the background on this screen overnight. Navigation
    // focus never fires on an app return, so the chip kept yesterday's clock.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2099, 8, 15, 20, 0));
    const tree = mount();
    expect(chip(tree)).toMatch(/^Due Sep\s?15$/);

    appGoes("background");
    vi.setSystemTime(new Date(2099, 8, 16, 8, 0));
    appGoes("active");
    expect(chip(tree)).toMatch(/^Past due Sep\s?15$/);
  });

  it("takes the clock again when the member comes back to the screen", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2099, 8, 15, 20, 0));
    const tree = mount();
    act(() => blur());
    vi.setSystemTime(new Date(2099, 8, 16, 8, 0));
    await refocus();
    expect(chip(tree)).toMatch(/^Past due Sep\s?15$/);
  });

  it("is done with the Paid line when the app comes back, as on a return to the screen", async () => {
    invoices = [FALL, SOCIAL];
    const tree = mount();
    await tapPay(tree);
    invoices = [paid(FALL), SOCIAL];
    rerender(tree);
    expect(card(tree)).toContain(paidCopy("Fall dues"));

    appGoes("background", "active");
    expect(screenText(tree)).not.toContain(paidCopy("Fall dues"));
  });
});
