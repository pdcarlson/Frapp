import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import {
  payIntentErrorCopy,
  useActiveChapterId,
  useAwaitInvoicePaid,
  useCurrentUser,
  useInvoices,
  usePayInvoice,
  useViewerUserId,
} from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_MORE } from "@/components/back-row";
import { SectionHeader } from "@/components/list-section";
import { EmptyState, ErrorState } from "@/components/state-block";
import { CardListSkeleton } from "@/components/card-list-skeleton";
import {
  BalanceCard,
  type BalanceCardStatus,
} from "@/components/dues/balance-card";
import { InvoiceHistoryRow } from "@/components/dues/invoice-row";
import { OpenInvoiceRow } from "@/components/dues/open-invoice-row";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  balanceCents,
  dueChip,
  formatAmount,
  selectInvoiceHistory,
  selectInvoiceRows,
  selectNextDueInvoice,
  selectOpenInvoicesByDueDate,
} from "@/lib/dues/invoices";
import {
  isStripeAvailable,
  presentPaymentSheet,
  stripeUnavailableReason,
} from "@/lib/payments/stripe";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s11 — Dues (`canvas-screens.dc.html`, `id="s11"`).
 *
 * Composition only; the narrowing, money formatting and error mapping live in
 * `lib/dues/` where they are unit-tested, and the native module sits behind
 * `lib/payments/stripe.ts`.
 *
 * ## The rule this screen exists to obey
 *
 * **The webhook is the source of truth.** `spec/behavior/billing.md`: "A
 * successful client-side confirmation means the money moved, not that the
 * invoice settled. Clients must re-read the invoice until the server reports
 * PAID, and until then surface 'payment received, confirmation pending' — never
 * a locally-declared PAID the webhook has not written." So a completed
 * PaymentSheet writes nothing; it starts `useAwaitInvoicePaid`, which re-reads
 * the invoice and then the list, and the invoice flips only when the list says
 * so. If the poll runs out, the screen says pending rather than guessing.
 *
 * ## A captured payment holds its own invoice, for a while
 *
 * Each captured payment holds **that invoice**, and nothing else: its OPEN row
 * reads Pending, and Pay settles the earliest-due open invoice that isn't held,
 * so the others really are payable. With nothing else open, the card shows the
 * held invoice as "Confirming payment…", Pay off. A hold ends when the list
 * reads its invoice as no longer OPEN, or {@link PENDING_HOLD_MS} after
 * capture, whichever is first. The poll's PAID alone ends nothing: it only
 * makes the list re-read, and until that read lands the card and the row still
 * say pending, so the two never disagree. The "Paid …" line waits for the list
 * too.
 *
 * The bound exists because a webhook that hasn't landed in two minutes is
 * failing or retrying for hours, and holding Pay off would hide that behind
 * "Confirming…" until a force-quit. Past it, the invoice says the payment went
 * through and the chapter's records haven't caught up, on the card when the
 * card's CTA pays it and on its OPEN row when the rows are listed, and Pay
 * comes back for it. The hold is a courtesy, not the guard. What a tap then
 * meets is `createPaymentIntent`'s answer for the invoice's stored intent
 * (`financial-invoice.service.ts`, `billing.md` § Member payment flow):
 *
 * - `succeeded`, which is where a card payment ends up: a 409, "Payment already
 *   completed; confirmation is being processed", shown as the server words it.
 * - `processing`: the server hands the same intent back, client secret and no
 *   status, so this screen can't tell, and the sheet opens on it. The pinned
 *   Stripe SDKs load such an intent (stripe-ios 26.11.0 and stripe-android
 *   23.19.0 turn away only succeeded, canceled and requires_capture ones).
 *   Stripe confirms only an intent still waiting on a payment method,
 *   confirmation or action, so by its intent lifecycle the attempt fails
 *   inside the sheet and charges nothing; no device run has shown the sheet's
 *   exact words. Stripe uses processing for bank debits rather than cards, and
 *   this sheet doesn't offer delayed methods (`allowsDelayedPaymentMethods` is
 *   left at its default, off), so it means a payment started somewhere else.
 * - Failed since, back to `requires_payment_method`: the sheet takes a new
 *   payment on the same intent, which is what the member needs.
 *
 * Either way the server never mints a second intent while the first is
 * succeeded or processing, so no tap pays an invoice twice.
 *
 * Everything here is one chapter's: {@link DuesScreen} remounts the screen when
 * the active chapter changes, so no capture, hold timer or failure line
 * outlives its chapter.
 *
 * ## Copy discipline
 *
 * "Chapter dues", never "subscription" (`spec/ui/mobile/patterns.md`). The
 * chapter's own Frapp subscription is a different bill with a different payer,
 * and `useBillingStatus` is deliberately not read here.
 *
 * ## No entitlement gate, deliberately
 *
 * `POST /v1/invoices/:id/payment-intent` is `@SubscriptionExempt()` — dues
 * collection is how a locked chapter recovers, and
 * `spec/ui/design-system/README.md` §5 rule 3 says never to gate a user out of
 * the screen that ungates them. The reads are reads, and §5 never gates those.
 * Nothing about the chapter's plan disables the CTA: only whether this build
 * can open a payment sheet at all, a payment sheet already opening, and the
 * bounded hold above.
 */

/** `billing.md`'s own phrase for the window between capture and settlement. */
const PENDING_COPY =
  "Payment received, confirmation pending. This updates as soon as your chapter's records catch up.";

/**
 * The hold ran out with the invoice still OPEN: the webhook hasn't landed. The
 * row's line, under the invoice's own title.
 */
const UNCONFIRMED_ROW_COPY =
  "Your payment went through, but your chapter's records haven't caught up yet.";

/**
 * The same, as a line of its own. It names the invoice, because on the card it
 * takes the place of the footnote that would have.
 */
const unconfirmedCopy = (title: string) =>
  `Your payment for ${title} went through, but your chapter's records haven't caught up yet. Check back later, or ask your treasurer if this stays open.`;

/** Names the invoice, because it sits beside the next invoice's CTA. */
const paidCopy = (title: string) =>
  `Paid ${title}. Your chapter has it — thanks.`;

/**
 * How long a captured payment holds Pay off for its invoice. The poll covers
 * the first ~24s; the rest covers a slow webhook and a refocus or two. See the
 * docblock for why it ends at all.
 */
const PENDING_HOLD_MS = 2 * 60 * 1000;

/** A payment the sheet captured on one invoice. At most one per invoice. */
interface CapturedPayment {
  invoiceId: string;
  title: string;
  capturedAt: number;
  /** {@link PENDING_HOLD_MS} has passed. */
  holdEnded: boolean;
}

/**
 * Where a captured payment stands, read off the list. `held`: still OPEN (or
 * the list hasn't loaded) inside the hold. `unconfirmed`: still OPEN past it.
 * `settled`: the list reads PAID. A capture whose invoice is neither (voided,
 * or gone from the list) has nothing to say.
 */
type PaymentStanding = "held" | "unconfirmed" | "settled";

/** A Pay attempt's failure, on the invoice the attempt was for. */
interface PayFailure {
  invoiceId: string;
  text: string;
}

/**
 * One screen per chapter. The tab stays mounted through a chapter switch, so
 * keying it is what keeps chapter A's captured payment, hold timer and failure
 * line off chapter B's dues, and an attempt still running for A writes into a
 * screen that is gone.
 */
export default function DuesScreen() {
  const chapterId = useActiveChapterId();
  return <ChapterDues key={chapterId ?? "no-chapter"} />;
}

function ChapterDues() {
  const { tokens } = useFrappTheme();
  const { chapterName } = useChapterBranding();
  const styles = createStyles(tokens);

  const viewerUserId = useViewerUserId();
  // The query behind `useViewerUserId`, for its error state: the helper reports
  // a failed `/v1/users/me` as `null`, the same value it uses for "pending", and
  // the invoice list is filtered by that id — so without this the screen would
  // shimmer forever on a dead call. The C3 ruling, applied.
  const viewerQuery = useCurrentUser();
  // Filtered **server-side** by the viewer's id, not just narrowed on arrival.
  // `GET /v1/invoices` hands a `billing:view` holder the whole chapter's ledger,
  // so an unfiltered read would cache every member's amounts and due dates on a
  // treasurer's phone to render one balance. `enabled` holds it until the id is
  // known, so the filtered request is the only one that ever goes out.
  const invoicesQuery = useInvoices(viewerUserId ?? undefined, {
    enabled: !!viewerUserId,
  });
  const payInvoice = usePayInvoice();
  // Wider than the web default of 8 × 1500ms: a phone returning from the Stripe
  // sheet re-renders and re-authenticates on a mobile network, so the same
  // webhook lands later here than it does in a browser tab.
  const awaitPaid = useAwaitInvoicePaid({ attempts: 12, intervalMs: 2000 });

  const [captures, setCaptures] = useState<CapturedPayment[]>([]);
  const [failure, setFailure] = useState<PayFailure | null>(null);
  /**
   * The Pay attempt that has the CTA reading "Opening…", by its token. Only
   * that attempt clears it, so an earlier attempt's poll ending can't switch
   * Pay back on while a later one's request is in flight.
   */
  const [openingAttempt, setOpeningAttempt] = useState<number | null>(null);
  const lastAttemptRef = useRef(0);
  const isPaying = openingAttempt !== null;
  const refetchInvoicesRef = useRef(invoicesQuery.refetch);
  useEffect(() => {
    refetchInvoicesRef.current = invoicesQuery.refetch;
  });

  const rows = useMemo(
    () => selectInvoiceRows(invoicesQuery.data, viewerUserId),
    [invoicesQuery.data, viewerUserId],
  );
  const open = useMemo(() => selectOpenInvoicesByDueDate(rows), [rows]);

  // Derived from the list rather than cleared by an effect, so a hold lets go
  // the moment the list does. A list that hasn't loaded, or whose rows are
  // withheld until the viewer is known, can't say the invoice left OPEN, so it
  // counts as still open.
  const listLoaded = invoicesQuery.data !== undefined && viewerUserId !== null;
  const standings = useMemo(() => {
    const byInvoice = new Map<string, PaymentStanding>();
    for (const capture of captures) {
      const status = rows.find((row) => row.id === capture.invoiceId)?.status;
      if (!listLoaded || status === "OPEN") {
        byInvoice.set(
          capture.invoiceId,
          capture.holdEnded ? "unconfirmed" : "held",
        );
      } else if (status === "PAID") {
        byInvoice.set(capture.invoiceId, "settled");
      }
    }
    return byInvoice;
  }, [captures, rows, listLoaded]);
  const standingOf = (invoiceId: string) => standings.get(invoiceId) ?? null;

  // One clock per focus. A tab is never unmounted, so a mount-only value would
  // still be yesterday's when the member reopens the app — and "Past due" is
  // exactly the label that must not be a day stale.
  const [now, setNow] = useState(() => new Date());
  const standingsRef = useRef(standings);
  useEffect(() => {
    standingsRef.current = standings;
  }, [standings]);
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      // Coming back is a fresh look: last visit's failure is about an attempt
      // the member has moved on from, and a settled "Paid …" line isn't news.
      setFailure(null);
      const unsettled = new Set(
        [...standingsRef.current]
          .filter(([, standing]) => standing !== "settled")
          .map(([invoiceId]) => invoiceId),
      );
      setCaptures((current) =>
        current.every((capture) => unsettled.has(capture.invoiceId))
          ? current
          : current.filter((capture) => unsettled.has(capture.invoiceId)),
      );
      // A webhook that landed while the member was elsewhere is what lets a
      // pending payment settle, and the list's 30s staleTime would otherwise
      // skip the read.
      if (unsettled.size > 0) void refetchInvoicesRef.current();
      return undefined;
    }, []),
  );

  // The holds' bound, one timer for the next to run out. One last read when it
  // does, so the invoice states what the server says now rather than what it
  // said at the end of the poll. Only a capture still held needs it: one the
  // list already settled has nothing left to time.
  const nextHoldEnd = useMemo(() => {
    const ends = captures
      .filter((capture) => standings.get(capture.invoiceId) === "held")
      .map((capture) => capture.capturedAt + PENDING_HOLD_MS);
    return ends.length > 0 ? Math.min(...ends) : null;
  }, [captures, standings]);
  useEffect(() => {
    if (nextHoldEnd === null) return undefined;
    const timer = setTimeout(
      () => {
        setCaptures((current) =>
          current.map((capture) =>
            !capture.holdEnded &&
            capture.capturedAt + PENDING_HOLD_MS <= nextHoldEnd
              ? { ...capture, holdEnded: true }
              : capture,
          ),
        );
        void refetchInvoicesRef.current();
      },
      Math.max(0, nextHoldEnd - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [nextHoldEnd]);

  // Memoized rather than re-derived inside `renderBody`, which re-runs on every
  // attempt and capture change. `balanceCents` stays the single definition of
  // the number — the screen must not grow a second notion of "open" beside the
  // one the CTA pays against.
  const balance = useMemo(() => balanceCents(rows), [rows]);
  const history = useMemo(() => selectInvoiceHistory(rows), [rows]);

  // What Pay settles: the earliest-due open invoice whose payment isn't still
  // held, by the same rule the More hub's chip uses.
  const target = useMemo(
    () =>
      selectNextDueInvoice(
        rows.filter((row) => standings.get(row.id) !== "held"),
      ),
    [rows, standings],
  );
  // Every open invoice held: the card shows the first, confirming.
  const confirming = target === null ? (open[0] ?? null) : null;
  const cardInvoice = target ?? confirming;

  // A failure belongs to the invoice it came from. It is dropped in the render
  // that moves Pay off that invoice, during render rather than in an effect so
  // no frame draws it as another invoice's caption or hint, and it doesn't
  // come back if Pay later returns to its invoice.
  const targetId = target?.id ?? null;
  if (failure !== null && failure.invoiceId !== targetId) setFailure(null);

  const canPay = isStripeAvailable();
  const blockedReason = canPay ? null : stripeUnavailableReason();

  const handlePay = useCallback(async () => {
    if (!target) return;
    const paying = target;
    lastAttemptRef.current += 1;
    const attempt = lastAttemptRef.current;
    const stopOpening = () =>
      setOpeningAttempt((current) => (current === attempt ? null : current));
    const fail = (text: string) => setFailure({ invoiceId: paying.id, text });
    setFailure(null);
    setOpeningAttempt(attempt);
    try {
      const intent = await payInvoice.mutateAsync(paying.id);
      const clientSecret =
        (intent as { client_secret?: string } | undefined)?.client_secret ??
        null;
      if (!clientSecret) {
        // The server hands back a secret on every success path, so an absent
        // one is a contract break rather than a member-facing condition — say
        // something actionable instead of opening an empty sheet.
        fail("Could not start payment. Please try again.");
        return;
      }

      const outcome = await presentPaymentSheet({
        clientSecret,
        merchantDisplayName: chapterName ?? "Frapp",
      });
      // Dismissing the sheet is a decision, not a failure. Nothing is said.
      if (outcome.kind === "canceled") return;
      if (outcome.kind === "failed") {
        fail(outcome.message);
        return;
      }

      // Past this point the card has been charged. A new capture replaces any
      // earlier one on this invoice, and its hold starts now.
      setCaptures((current) => [
        ...current.filter((capture) => capture.invoiceId !== paying.id),
        {
          invoiceId: paying.id,
          title: paying.title,
          capturedAt: Date.now(),
          holdEnded: false,
        },
      ]);
      // The sheet is closed; from here the hold, not "Opening…", is what the
      // CTA says when it is this invoice's.
      stopOpening();
      // Everything that follows is *reading* the outcome, so it gets its own
      // try/catch — mapping a failed poll through `payIntentErrorCopy` would
      // put "Could not start payment. Please try again." in red under a member
      // who has already paid. What the poll finds changes nothing here: its
      // PAID re-reads the list (`useAwaitInvoicePaid`'s onSettled), and the
      // list is what ends the hold.
      try {
        await awaitPaid.mutateAsync(paying.id);
      } catch {
        // A failed read says nothing about the payment; the hold stands.
      }
    } catch (error) {
      fail(payIntentErrorCopy(error));
    } finally {
      stopOpening();
    }
  }, [awaitPaid, chapterName, payInvoice, target]);

  /** What a captured payment says when it has a line of its own. */
  const capturedLine = (capture: CapturedPayment): string | null => {
    switch (standingOf(capture.invoiceId)) {
      case "held":
        return PENDING_COPY;
      case "unconfirmed":
        return unconfirmedCopy(capture.title);
      case "settled":
        return paidCopy(
          rows.find((row) => row.id === capture.invoiceId)?.title ??
            capture.title,
        );
      default:
        return null;
    }
  };

  // The card's caption, about the invoice its CTA settles: a failure on it,
  // then where its payment stands.
  const cardFailure = failure?.text ?? null;
  const cardStanding = cardInvoice ? standingOf(cardInvoice.id) : null;
  const cardStatus: BalanceCardStatus | null = cardFailure
    ? { text: cardFailure, tone: "destructive" }
    : cardInvoice && cardStanding === "held"
      ? { text: PENDING_COPY, tone: "neutral" }
      : cardInvoice && cardStanding === "unconfirmed"
        ? { text: unconfirmedCopy(cardInvoice.title), tone: "neutral" }
        : null;
  // The latest payment the list has settled. That invoice left OPEN, so it is
  // never the one the CTA settles, and the line is drawn as its own.
  const latestSettled =
    [...captures]
      .reverse()
      .find((capture) => standingOf(capture.invoiceId) === "settled") ?? null;
  const receipt = latestSettled ? capturedLine(latestSettled) : null;

  // Every branch with no card still says where each payment stands: a
  // background refetch that fails right after a payment must not swallow
  // "payment received".
  const standaloneLines = [
    ...new Set(
      captures
        .map(capturedLine)
        .filter((line): line is string => line !== null),
    ),
  ];
  const standalone =
    standaloneLines.length > 0 ? (
      <>
        {standaloneLines.map((line) => (
          <Text key={line} style={styles.notice}>
            {line}
          </Text>
        ))}
      </>
    ) : null;

  function renderBody() {
    if (viewerQuery.isError) {
      return (
        <>
          {standalone}
          <ErrorState
            title="Couldn't load your account"
            body="Your dues are filtered to you, so this has to load first."
            onRetry={() => void viewerQuery.refetch()}
            isRetrying={viewerQuery.isFetching}
          />
        </>
      );
    }

    // `viewerUserId === null` here is "/v1/users/me has not answered yet". The
    // selector withholds every row until it does, so treating that as empty
    // would flash "all paid up" at a member who owes money.
    if (invoicesQuery.isPending || viewerUserId === null) {
      return (
        <>
          {standalone}
          <CardListSkeleton rows={3} />
        </>
      );
    }

    if (invoicesQuery.isError) {
      return (
        <>
          {standalone}
          <ErrorState
            title="Couldn't load your dues"
            body="Your invoices are still on record — this was a problem fetching them."
            onRetry={() => void invoicesQuery.refetch()}
            isRetrying={invoicesQuery.isFetching}
          />
        </>
      );
    }

    if (rows.length === 0) {
      return (
        <EmptyState
          glyph="✓"
          title="No dues yet"
          body="Your chapter hasn't billed you. Anything they send will show up here."
        />
      );
    }

    const label =
      open.length === 0
        ? "You're all paid up"
        : open.length === 1
          ? (cardInvoice?.title ?? "Chapter dues")
          : `${open.length} invoices open`;

    return (
      <>
        <BalanceCard
          label={label}
          amountCents={balance}
          due={target ? dueChip(target, now) : null}
          payLabel={cardInvoice ? "Pay now" : null}
          disabledReason={target ? blockedReason : null}
          footnote={
            target && open.length > 1
              ? `Pays ${target.title} — ${formatAmount(target.amountCents)} of your balance.`
              : null
          }
          isConfirming={confirming !== null}
          status={cardStatus}
          receipt={receipt}
          isPaying={isPaying}
          onPay={() => void handlePay()}
        />

        {/* One open bill is the card. With more, the card can only count them
            and name the one Pay settles, and HISTORY holds settled rows only,
            so this is the one place the rest are listed. */}
        {open.length > 1 ? (
          <>
            <SectionHeader>OPEN</SectionHeader>
            <View style={styles.rows}>
              {open.map((invoice, index, all) => (
                <OpenInvoiceRow
                  key={invoice.id}
                  invoice={invoice}
                  now={now}
                  isConfirming={standingOf(invoice.id) === "held"}
                  note={
                    standingOf(invoice.id) === "unconfirmed"
                      ? UNCONFIRMED_ROW_COPY
                      : null
                  }
                  isLast={index === all.length - 1}
                />
              ))}
            </View>
          </>
        ) : null}

        {history.length > 0 ? (
          <>
            <SectionHeader>HISTORY</SectionHeader>
            <View style={styles.rows}>
              {history.map((invoice, index, all) => (
                <InvoiceHistoryRow
                  key={invoice.id}
                  invoice={invoice}
                  isLast={index === all.length - 1}
                />
              ))}
            </View>
          </>
        ) : null}

        {/* The drawn footer's first sentence promises receipts by email, which
            nothing in `spec/` implements — omitted per screens.md. The second
            is backed and is the trust copy `writing.md` asks for. */}
        <Text style={styles.footer}>
          Payments run through your chapter&apos;s Stripe account.
        </Text>
      </>
    );
  }

  return (
    <ScreenShell back={BACK_TO_MORE} title="Dues">
      {renderBody()}
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    rows: {
      marginTop: tokens.spacing.xs,
    },
    notice: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    footer: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      marginTop: tokens.spacing.sm,
    },
  });
}
