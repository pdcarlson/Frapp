import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { focusManager } from "@tanstack/react-query";
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
 * ## A captured payment holds its invoice until the list agrees
 *
 * Pay settles one invoice, because a PaymentIntent is per invoice: the
 * earliest-due open one ({@link selectNextDueInvoice}), unless a payment is
 * confirming, in which case it is that invoice. A completed sheet holds the
 * invoice it paid: the chip reads Pending, the CTA is disabled as "Confirming
 * payment…", and the card says "Payment received, confirmation pending"
 * (`billing.md` § Member payment flow, `screens.md` s11). The hold ends only
 * when the invoice list reads that invoice as no longer OPEN, and the "Paid …"
 * line waits for the same read. The poll's PAID ends nothing on its own: it
 * makes the list re-read (`useAwaitInvoicePaid`'s onSettled), so the card
 * never says Paid beside a Pending chip.
 *
 * Other open invoices wait meanwhile, until the webhook lands: usually
 * seconds, but if the webhook is stuck, until the hold ends as below. The card
 * stays on the confirming invoice, and the OPEN list shows the rest with their
 * own amounts and due chips.
 *
 * ## How long the hold lasts
 *
 * Until the list reads the invoice as no longer OPEN, with no time bound,
 * because until then Pay has nothing honest to offer: the server already has
 * the payment, and a second tap would only meet its refusal below. The list
 * is re-read every {@link HOLD_REREAD_MS} while the hold stands, the screen
 * is up and the app is in the foreground, so a webhook that lands after the
 * poll gives up still ends it in front of the member, and again when they come
 * back to the screen (Dues is a hidden tab route, `href: null` in
 * `app/(tabs)/_layout.tsx`, which the tab navigator keeps mounted, so coming
 * back doesn't reset it). Re-reads wait for the viewer's id, so none goes out
 * unfiltered, and a read that hangs is started over after
 * {@link HUNG_AFTER_TICKS} ticks.
 *
 * The hold lives in this screen's state, so a chapter switch, which remounts
 * the screen ({@link DuesScreen}), or the app being closed ends it. If the
 * webhook is still stuck then, Pay targets that invoice again, and a tap meets
 * `createPaymentIntent`'s answer for the invoice's stored intent
 * (`financial-invoice.service.ts`, `billing.md` § Member payment flow):
 *
 * - `succeeded`: a 409, "Payment already completed; confirmation is being
 *   processed". `payIntentErrorCopy` passes a 409's message through as the
 *   server wrote it, and the card shows it as that attempt's failure.
 * - `processing`: the server reuses the intent and answers 200 with its client
 *   secret and no status (#3432), so this screen can't tell and opens the
 *   sheet. The pinned Stripe SDKs load a processing intent: stripe-ios 26.11.0's
 *   `PaymentSheetLoader` and stripe-android 23.19.0's `StripeIntentValidator`
 *   turn away only succeeded, canceled and requires_capture ones. The rest of
 *   this bullet is derived and hasn't been seen on a device. Stripe confirms
 *   only an intent still waiting on a payment method, confirmation or action,
 *   so the sheet shouldn't charge a processing one again, and what it says then
 *   is Stripe's wording. A card payment can pass through processing too, so a
 *   tap that lands while one is moving through it would meet this case.
 * - `requires_payment_method`, a payment that failed since: the sheet takes a
 *   new payment on the same intent.
 *
 * The server never mints a second intent while the stored one is succeeded or
 * processing.
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
 * hold above.
 */

/** `billing.md`'s own phrase for the window between capture and settlement. */
const PENDING_COPY =
  "Payment received, confirmation pending. This updates as soon as your chapter's records catch up.";

/**
 * How often the invoice list is re-read while a hold stands and the screen is
 * up: after the payment poll (12 × 2s) gives up, nothing else would ask, and
 * the list's 30s staleTime only matters to a read something triggers.
 */
const HOLD_REREAD_MS = 10_000;

/**
 * Re-read ticks a read may stay in flight across, nothing having ended in
 * between, before a tick takes it as hung and starts it over: two, so 20s at
 * the least. React Native's Android networking sets no timeout of its own
 * (`OkHttpClientProvider.kt` passes 0 for connect, read and write), so a read
 * that never answers would otherwise hold the card on "Confirming payment…"
 * for as long as the screen is up.
 */
const HUNG_AFTER_TICKS = 2;

/** Names the invoice, because it sits beside the next invoice's CTA. */
const paidCopy = (title: string) =>
  `Paid ${title}. Your chapter has it — thanks.`;

/** A Pay attempt's failure, on the invoice the attempt was for. */
interface PayFailure {
  invoiceId: string;
  text: string;
}

/**
 * One screen per chapter. The tab stays mounted through a chapter switch, so
 * keying it is what keeps chapter A's captured payment and failure line off
 * chapter B's dues, and an attempt still running for A writes into a screen
 * that is gone.
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

  /**
   * The invoice a completed sheet paid on this visit. While the list reads it
   * OPEN it is held; once the list reads it PAID it is the "Paid …" line.
   */
  const [capturedId, setCapturedId] = useState<string | null>(null);
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
  // The list's read as of the last render, for the re-read ticks below:
  // whether one is in flight, and when the last one ended either way.
  const invoicesReadRef = useRef({ fetching: false, endedAt: 0 });
  useEffect(() => {
    refetchInvoicesRef.current = invoicesQuery.refetch;
    invoicesReadRef.current = {
      fetching: invoicesQuery.isFetching,
      endedAt: Math.max(
        invoicesQuery.dataUpdatedAt,
        invoicesQuery.errorUpdatedAt,
      ),
    };
  });

  const rows = useMemo(
    () => selectInvoiceRows(invoicesQuery.data, viewerUserId),
    [invoicesQuery.data, viewerUserId],
  );
  const open = useMemo(() => selectOpenInvoicesByDueDate(rows), [rows]);

  // Read off the list on every render rather than cleared by an effect, so the
  // hold lets go in the render the list does. A list that hasn't loaded, or
  // whose rows are withheld until the viewer is known, can't say the invoice
  // left OPEN, so it counts as still open.
  const listLoaded = invoicesQuery.data !== undefined && viewerUserId !== null;
  const capturedRow =
    capturedId === null
      ? null
      : (rows.find((row) => row.id === capturedId) ?? null);
  const isHolding =
    capturedId !== null && (!listLoaded || capturedRow?.status === "OPEN");
  const settledRow =
    listLoaded && capturedRow?.status === "PAID" ? capturedRow : null;

  // One clock per focus. A tab is never unmounted, so a mount-only value would
  // still be yesterday's when the member reopens the app — and "Past due" is
  // exactly the label that must not be a day stale.
  const [now, setNow] = useState(() => new Date());
  // Re-reads ask for the viewer's own rows only. While the viewer's id is
  // unknown the query is disabled, and an explicit refetch would still send
  // it, without the `user_id` filter (see `useInvoices` above).
  const rereads = isHolding && viewerUserId !== null;
  const isHoldingRef = useRef(isHolding);
  const rereadsRef = useRef(rereads);
  useEffect(() => {
    isHoldingRef.current = isHolding;
    rereadsRef.current = rereads;
  }, [isHolding, rereads]);
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      // Coming back is a fresh look: last visit's failure is about an
      // attempt the member has moved on from, and a settled "Paid …" line
      // isn't news. A hold stays, since the payment it stands for is still
      // confirming (see "How long the hold lasts"), and a webhook that landed
      // while the member was elsewhere settles it on this read, which the
      // list's 30s staleTime would otherwise skip.
      setFailure(null);
      if (!isHoldingRef.current) setCapturedId(null);
      else if (rereadsRef.current) {
        void refetchInvoicesRef.current({ cancelRefetch: false });
      }
      return undefined;
    }, []),
  );
  useFocusEffect(
    useCallback(() => {
      if (!rereads) return undefined;
      // Ticks in a row that found the same read in flight: still fetching,
      // and nothing ended since the tick before.
      let spanned = 0;
      let endedAt = invoicesReadRef.current.endedAt;
      const timer = setInterval(() => {
        // Navigation focus doesn't see the app going to the background;
        // TanStack's focusManager does (`lib/connection/query-connectivity.ts`
        // drives it from AppState).
        if (!focusManager.isFocused()) return;
        const read = invoicesReadRef.current;
        spanned = read.fetching && read.endedAt === endedAt ? spanned + 1 : 0;
        endedAt = read.endedAt;
        // A tick joins a read still in flight rather than cancelling it, so
        // on a slow network one still finishes, unless that read has been in
        // flight for HUNG_AFTER_TICKS ticks: then it starts the read over.
        const restart = spanned >= HUNG_AFTER_TICKS;
        if (restart) spanned = 0;
        void refetchInvoicesRef.current({ cancelRefetch: restart });
      }, HOLD_REREAD_MS);
      return () => clearInterval(timer);
    }, [rereads]),
  );

  // Memoized rather than re-derived inside `renderBody`, which re-runs on every
  // attempt and capture change. `balanceCents` stays the single definition of
  // the number — the screen must not grow a second notion of "open" beside the
  // one the CTA pays against.
  const balance = useMemo(() => balanceCents(rows), [rows]);
  const history = useMemo(() => selectInvoiceHistory(rows), [rows]);

  // What Pay settles: the confirming invoice while there is one, otherwise the
  // earliest-due open invoice, by the same rule the More hub's chip uses. The
  // two still name the same invoice during a hold, since the confirming one
  // was the earliest open when the member tapped Pay, except if an earlier-due
  // invoice is issued during the hold: the chip names that one, and the card
  // stays on the confirming one.
  const confirming = isHolding ? capturedRow : null;
  const target = useMemo(
    () => confirming ?? selectNextDueInvoice(rows),
    [confirming, rows],
  );

  // A failure belongs to the invoice its attempt was for. Once a loaded list
  // moves the card off that invoice it is dropped, in the render that moves
  // it (React re-runs this render before committing it), so it is never drawn
  // beside another invoice and can't come back if the card later returns
  // there. A list that is loading or withheld says nothing about where the
  // card is, so the failure stands through it.
  const targetId = target?.id ?? null;
  if (failure !== null && listLoaded && failure.invoiceId !== targetId) {
    setFailure(null);
  }
  const failureText =
    failure !== null && (!listLoaded || failure.invoiceId === targetId)
      ? failure.text
      : null;

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

      // Past this point the card has been charged, and the hold starts.
      setCapturedId(paying.id);
      // The sheet is closed; from here the hold, not "Opening…", is what the
      // CTA says.
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

  const cardStatus: BalanceCardStatus | null = failureText
    ? { text: failureText, tone: "destructive" }
    : confirming
      ? { text: PENDING_COPY, tone: "neutral" }
      : null;
  // The settled payment's line. Its invoice left OPEN, so the card is about
  // another invoice or none, and the line is drawn as its own.
  const receipt = settledRow ? paidCopy(settledRow.title) : null;

  // The branches with no card still say where the payment stands and why the
  // last attempt failed: a read that fails right after a payment must not
  // swallow "payment received", or the reason a payment didn't go through.
  const capturedLine = isHolding ? PENDING_COPY : receipt;
  const standalone = (
    <>
      {capturedLine ? <Text style={styles.notice}>{capturedLine}</Text> : null}
      {failureText ? <Text style={styles.failure}>{failureText}</Text> : null}
    </>
  );

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
                  isConfirming={invoice.id === confirming?.id}
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
