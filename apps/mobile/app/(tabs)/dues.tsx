import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import {
  payIntentErrorCopy,
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
 * PaymentSheet writes nothing; it starts `useAwaitInvoicePaid`, and the invoice
 * flips only when `GET /v1/invoices/:id` says so. If the poll runs out, the
 * screen says pending rather than guessing either way.
 *
 * Pending is a state of **one invoice**, drawn in the card when the card's CTA
 * is that invoice's, and as a Pending chip on its OPEN row. From capture, the
 * CTA for that invoice stays disabled as "Confirming payment…" until the list
 * reads it as no longer OPEN or {@link PENDING_HOLD_MS} passes, whichever is
 * first. Every other open invoice stays payable meanwhile.
 *
 * The hold is bounded because the server, not this latch, is what stops a
 * double payment: `POST /v1/invoices/:id/payment-intent` answers 409 ("Payment
 * already completed; confirmation is being processed") while the invoice's
 * stored intent has succeeded and the webhook hasn't written PAID
 * (`financial-invoice.service.ts`, `billing.md` § Member payment flow). The
 * hold only keeps the obvious second tap away while the webhook normally
 * lands. Past it, a webhook that still hasn't landed is failing or retrying
 * for hours, and holding Pay off would hide that behind "Confirming…" until a
 * force-quit. So the card says plainly that the payment went through and the
 * chapter's records haven't caught up, and Pay comes back: a second attempt
 * meets the server's 409, shown as the server words it, and a payment that
 * really did fail later (its intent back to confirmable) can be retried.
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
 * can open a payment sheet at all, a payment sheet already open, and the
 * bounded pending hold above.
 */

/** `billing.md`'s own phrase for the window between capture and settlement. */
const PENDING_COPY =
  "Payment received, confirmation pending. This updates as soon as your chapter's records catch up.";

/** The hold ran out with the invoice still OPEN: the webhook hasn't landed. */
const UNCONFIRMED_COPY =
  "Your payment went through, but your chapter's records haven't caught up yet. Check back later, or ask your treasurer if this stays open.";

/** Names the invoice, because it can sit beside the next invoice's CTA. */
const paidCopy = (title: string) =>
  `Paid ${title}. Your chapter has it — thanks.`;

/**
 * How long a captured payment holds Pay off for its invoice. The poll covers
 * the first ~24s; the rest covers a slow webhook and a refocus or two. See the
 * docblock for why it ends at all.
 */
const PENDING_HOLD_MS = 2 * 60 * 1000;

/**
 * The last captured payment, and what the screen knows about it. `confirming`
 * holds Pay off for its invoice; `unconfirmed` is the hold run out with the
 * invoice still OPEN; `paid` is the poll's PAID. Whichever it is, the list wins
 * once it reads the invoice as no longer OPEN.
 */
interface CapturedPayment {
  kind: "confirming" | "unconfirmed" | "paid";
  invoiceId: string;
  title: string;
  capturedAt: number;
}

export default function DuesScreen() {
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

  const [failure, setFailure] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [captured, setCaptured] = useState<CapturedPayment | null>(null);
  const refetchInvoicesRef = useRef(invoicesQuery.refetch);
  useEffect(() => {
    refetchInvoicesRef.current = invoicesQuery.refetch;
  });

  const rows = useMemo(
    () => selectInvoiceRows(invoicesQuery.data, viewerUserId),
    [invoicesQuery.data, viewerUserId],
  );
  const open = useMemo(() => selectOpenInvoicesByDueDate(rows), [rows]);

  // What the list says about the captured payment's invoice. Derived rather
  // than cleared by an effect, so the latch lets go the moment the list does.
  // A list that hasn't loaded can't say the invoice left OPEN, so it counts as
  // still open.
  const capturedRow = captured
    ? rows.find((row) => row.id === captured.invoiceId)
    : undefined;
  const capturedStillOpen =
    captured !== null &&
    (invoicesQuery.data === undefined || capturedRow?.status === "OPEN");
  // Pay is held for this invoice: confirming, or the poll said PAID before the
  // list caught up.
  const heldInvoiceId =
    captured && capturedStillOpen && captured.kind !== "unconfirmed"
      ? captured.invoiceId
      : null;
  const unconfirmedInvoiceId =
    captured?.kind === "unconfirmed" && capturedStillOpen
      ? captured.invoiceId
      : null;
  const paidLine =
    captured &&
    (captured.kind === "paid" ||
      (invoicesQuery.data !== undefined && capturedRow?.status === "PAID"))
      ? paidCopy(capturedRow?.title ?? captured.title)
      : null;

  // One clock per focus. A tab is never unmounted, so a mount-only value would
  // still be yesterday's when the member reopens the app — and "Past due" is
  // exactly the label that must not be a day stale.
  const [now, setNow] = useState(() => new Date());
  const capturedStillOpenRef = useRef(capturedStillOpen);
  useEffect(() => {
    capturedStillOpenRef.current = capturedStillOpen;
  }, [capturedStillOpen]);
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      if (capturedStillOpenRef.current) {
        // A webhook that landed while the member was elsewhere is what lets a
        // pending payment settle, and the list's 30s staleTime would otherwise
        // skip the read.
        void refetchInvoicesRef.current();
      } else {
        // Settled (or voided) and already shown: coming back is a fresh look,
        // and a "Paid …" line from last week isn't news.
        setCaptured(null);
      }
      return undefined;
    }, []),
  );

  // The hold's bound. One last read when it runs out, so the card states what
  // the server says now rather than what it said at the end of the poll.
  const confirmingSince =
    captured?.kind === "confirming" ? captured.capturedAt : null;
  const confirmingId =
    captured?.kind === "confirming" ? captured.invoiceId : null;
  useEffect(() => {
    if (confirmingSince === null || confirmingId === null) return undefined;
    const timer = setTimeout(
      () => {
        setCaptured((current) =>
          current?.kind === "confirming" && current.invoiceId === confirmingId
            ? { ...current, kind: "unconfirmed" }
            : current,
        );
        void refetchInvoicesRef.current();
      },
      Math.max(0, confirmingSince + PENDING_HOLD_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [confirmingSince, confirmingId]);

  // Memoized rather than re-derived inside `renderBody`, which re-runs on every
  // `isPaying` / `captured` change. `balanceCents` stays the single definition of
  // the number — the screen must not grow a second notion of "open" beside the
  // one the CTA pays against.
  const balance = useMemo(() => balanceCents(rows), [rows]);
  const history = useMemo(() => selectInvoiceHistory(rows), [rows]);

  const target = useMemo(() => selectNextDueInvoice(rows), [rows]);

  const canPay = isStripeAvailable();
  const blockedReason = canPay ? null : stripeUnavailableReason();

  const handlePay = useCallback(async () => {
    if (!target) return;
    const paying = target;
    setFailure(null);
    // A settled line, or this invoice's own unconfirmed one, is about to be
    // superseded. Another invoice's live hold stays until a capture here
    // replaces it.
    setCaptured((current) =>
      current && (current.kind === "paid" || current.invoiceId === paying.id)
        ? null
        : current,
    );
    setIsPaying(true);
    try {
      const intent = await payInvoice.mutateAsync(paying.id);
      const clientSecret =
        (intent as { client_secret?: string } | undefined)?.client_secret ??
        null;
      if (!clientSecret) {
        // The server hands back a secret on every success path, so an absent
        // one is a contract break rather than a member-facing condition — say
        // something actionable instead of opening an empty sheet.
        setFailure("Could not start payment. Please try again.");
        return;
      }

      const outcome = await presentPaymentSheet({
        clientSecret,
        merchantDisplayName: chapterName ?? "Frapp",
      });
      // Dismissing the sheet is a decision, not a failure. Nothing is said.
      if (outcome.kind === "canceled") return;
      if (outcome.kind === "failed") {
        setFailure(outcome.message);
        return;
      }

      // Past this point the card has been charged. Everything that follows is
      // *reading* the outcome, so it gets its own try/catch — mapping a failed
      // poll through `payIntentErrorCopy` would put "Could not start payment.
      // Please try again." in red under a member who has already paid, with the
      // Pay button live again.
      setCaptured({
        kind: "confirming",
        invoiceId: paying.id,
        title: paying.title,
        capturedAt: Date.now(),
      });
      // The sheet is closed; from here the hold, not "Opening…", is what the
      // CTA says, and it is scoped to this invoice.
      setIsPaying(false);
      try {
        const settled = await awaitPaid.mutateAsync(paying.id);
        // The poll's PAID is the server's word. Pay stays held until the
        // refetched list agrees, so the card and the list never differ.
        if (settled) {
          setCaptured((current) =>
            current?.invoiceId === paying.id
              ? { ...current, kind: "paid" }
              : current,
          );
        }
      } catch {
        // A failed read says nothing about the payment. The hold keeps the
        // pending state up until its bound, which is the honest answer
        // either way.
      }
    } catch (error) {
      setFailure(payIntentErrorCopy(error));
    } finally {
      setIsPaying(false);
    }
  }, [awaitPaid, chapterName, payInvoice, target]);

  /** The captured payment's line, for whichever invoice it is about. */
  const capturedText =
    heldInvoiceId !== null && captured?.kind === "confirming"
      ? PENDING_COPY
      : unconfirmedInvoiceId !== null
        ? UNCONFIRMED_COPY
        : paidLine;
  const capturedIsTarget =
    captured !== null && target !== null && captured.invoiceId === target.id;

  // The card's caption, about the invoice its CTA settles: a failure, then
  // that invoice's captured payment.
  const cardStatus: BalanceCardStatus | null = failure
    ? { text: failure, tone: "destructive" }
    : capturedIsTarget && capturedText
      ? { text: capturedText, tone: "neutral" }
      : null;
  // A payment for an invoice the CTA no longer settles: the paid one, which
  // left OPEN. A pending one for another invoice is on its OPEN row.
  const receipt = capturedIsTarget ? null : paidLine;

  // Every branch with no card to carry the line still says where the payment
  // stands: a background refetch that fails right after a payment must not
  // swallow "payment received".
  const standaloneStatus: BalanceCardStatus | null = failure
    ? { text: failure, tone: "destructive" }
    : capturedText
      ? { text: capturedText, tone: "neutral" }
      : null;
  const standaloneLine = standaloneStatus ? (
    <Text
      style={
        standaloneStatus.tone === "destructive" ? styles.failure : styles.notice
      }
    >
      {standaloneStatus.text}
    </Text>
  ) : null;

  function renderBody() {
    if (viewerQuery.isError) {
      return (
        <>
          {standaloneLine}
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
          {standaloneLine}
          <CardListSkeleton rows={3} />
        </>
      );
    }

    if (invoicesQuery.isError) {
      return (
        <>
          {standaloneLine}
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
          ? (target?.title ?? "Chapter dues")
          : `${open.length} invoices open`;

    return (
      <>
        <BalanceCard
          label={label}
          amountCents={balance}
          due={target ? dueChip(target, now) : null}
          payLabel={target ? "Pay now" : null}
          disabledReason={target ? blockedReason : null}
          footnote={
            target && open.length > 1
              ? `Pays ${target.title} — ${formatAmount(target.amountCents)} of your balance.`
              : null
          }
          isConfirming={target !== null && target.id === heldInvoiceId}
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
                  isConfirming={invoice.id === heldInvoiceId}
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
    failure: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    footer: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      marginTop: tokens.spacing.sm,
    },
  });
}
