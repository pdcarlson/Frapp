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
 * Pending is a state of the card, not a line above it: from capture until the
 * list itself reads the invoice as no longer OPEN, the CTA stays disabled as
 * "Confirming payment…" and the chip reads Pending. Re-enabling it the moment
 * the poll gave up offered a second payment for an invoice the member had
 * just paid, which the server refuses with a 409.
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
 * The only thing that disables the CTA is whether this build can open a payment
 * sheet at all.
 */

/** `billing.md`'s own phrase for the window between capture and settlement. */
const PENDING_COPY =
  "Payment received, confirmation pending. This updates as soon as your chapter's records catch up.";

const PAID_COPY = "Paid. Your chapter has it — thanks.";

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

  /** Only ever the settled line; the pending one is derived from the latch. */
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  /**
   * The invoice whose payment was captured, held until the list reads it as
   * no longer OPEN. Not cleared when the poll gives up, and not on refocus:
   * the member has paid, and re-offering Pay on that invoice is the 409.
   */
  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);
  const pendingInvoiceIdRef = useRef(pendingInvoiceId);
  useEffect(() => {
    pendingInvoiceIdRef.current = pendingInvoiceId;
  }, [pendingInvoiceId]);
  const refetchInvoicesRef = useRef(invoicesQuery.refetch);
  useEffect(() => {
    refetchInvoicesRef.current = invoicesQuery.refetch;
  });

  // One clock per focus. A tab is never unmounted, so a mount-only value would
  // still be yesterday's when the member reopens the app — and "Past due" is
  // exactly the label that must not be a day stale.
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      // A webhook that landed while the member was elsewhere is what lets a
      // pending payment settle; nothing else re-reads the list after the poll
      // has given up.
      if (pendingInvoiceIdRef.current !== null) {
        void refetchInvoicesRef.current();
      }
      return undefined;
    }, []),
  );

  const rows = useMemo(
    () => selectInvoiceRows(invoicesQuery.data, viewerUserId),
    [invoicesQuery.data, viewerUserId],
  );
  const open = useMemo(() => selectOpenInvoicesByDueDate(rows), [rows]);
  // Derived, not cleared by an effect: the latch holds exactly while its
  // invoice is still OPEN in the list the screen is drawing.
  const confirmingInvoiceId =
    pendingInvoiceId !== null && open.some((row) => row.id === pendingInvoiceId)
      ? pendingInvoiceId
      : null;
  // Memoized rather than re-derived inside `renderBody`, which re-runs on every
  // `isPaying` / `notice` change. `balanceCents` stays the single definition of
  // the number — the screen must not grow a second notion of "open" beside the
  // one the CTA pays against.
  const balance = useMemo(() => balanceCents(rows), [rows]);
  const history = useMemo(() => selectInvoiceHistory(rows), [rows]);

  const target = useMemo(() => selectNextDueInvoice(rows), [rows]);

  const canPay = isStripeAvailable();
  const blockedReason = canPay ? null : stripeUnavailableReason();

  const handlePay = useCallback(async () => {
    if (!target) return;
    setFailure(null);
    setNotice(null);
    setPendingInvoiceId(null);
    setIsPaying(true);
    try {
      const intent = await payInvoice.mutateAsync(target.id);
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
      setPendingInvoiceId(target.id);
      try {
        const settled = await awaitPaid.mutateAsync(target.id);
        // The poll's PAID is the server's word, but the card keeps saying
        // pending until the refetched list agrees, so the two never differ.
        if (settled) setNotice(PAID_COPY);
      } catch {
        // A failed read says nothing about the payment. The latch keeps the
        // pending state up, which is the honest answer either way.
      }
    } catch (error) {
      setFailure(payIntentErrorCopy(error));
    } finally {
      setIsPaying(false);
    }
  }, [awaitPaid, chapterName, payInvoice, target]);

  // One line about the last payment attempt, newest-first in what it can say:
  // a failure, then a captured payment still settling, then a settled one.
  const paymentStatus: BalanceCardStatus | null = failure
    ? { text: failure, tone: "destructive" }
    : confirmingInvoiceId !== null
      ? { text: PENDING_COPY, tone: "neutral" }
      : notice
        ? { text: notice, tone: "neutral" }
        : null;

  function renderBody() {
    if (viewerQuery.isError) {
      return (
        <ErrorState
          title="Couldn't load your account"
          body="Your dues are filtered to you, so this has to load first."
          onRetry={() => void viewerQuery.refetch()}
          isRetrying={viewerQuery.isFetching}
        />
      );
    }

    // `viewerUserId === null` here is "/v1/users/me has not answered yet". The
    // selector withholds every row until it does, so treating that as empty
    // would flash "all paid up" at a member who owes money.
    if (invoicesQuery.isPending || viewerUserId === null) {
      return <CardListSkeleton rows={3} />;
    }

    if (invoicesQuery.isError) {
      return (
        <>
          {/* No card to carry it here, and a refetch that fails right after a
              payment must not swallow "payment received". */}
          {paymentStatus ? (
            <Text
              style={
                paymentStatus.tone === "destructive"
                  ? styles.failure
                  : styles.notice
              }
            >
              {paymentStatus.text}
            </Text>
          ) : null}
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
          isConfirming={confirmingInvoiceId !== null}
          status={paymentStatus}
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
                  isConfirming={invoice.id === confirmingInvoiceId}
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
