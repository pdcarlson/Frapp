import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Redirect, useFocusEffect } from "expo-router";
import { focusManager } from "@tanstack/react-query";
import { AppState, StyleSheet, Text, View } from "react-native";
import type { AppStateStatus } from "react-native";
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
import { isBetaOffModule } from "@repo/validation";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_MORE } from "@/components/back-row";
import { SectionHeader } from "@/components/list-section";
import { ErrorState } from "@/components/state-block";
import { InlineNote } from "@/components/inline-note";
import { CardListSkeleton } from "@/components/card-list-skeleton";
import { CardMessages } from "@/components/card-messages";
import {
  BalanceCard,
  BalanceCardSkeleton,
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
 * ## A captured payment holds its invoice while the list reads it OPEN
 *
 * `billing.md` § Member payment flow owns the PAID rule: "Clients must re-read
 * the invoice until the server reports PAID, and until then surface 'payment
 * received, confirmation pending'." The copy and the states are `writing.md`
 * § Dues (mobile, s11)'s rows (*Payment captured, unsettled*, *Payment
 * settled*, *Payment captured, invoice voided or gone*), and `screens.md` s11
 * states the rule for the screen.
 *
 * Pay settles one invoice, because a PaymentIntent is per invoice: the
 * earliest-due open one ({@link selectNextDueInvoice}), unless a payment is
 * held, in which case it is that invoice. A completed sheet holds the invoice
 * it paid: the chip reads Pending and the card says "Payment received,
 * confirmation pending", naming the invoice when two or more are open, since
 * the card's label then only counts them and a live Pay pays that one. For
 * the poll's budget ({@link CONFIRMING_WINDOW_MS}, about 24s) the CTA is
 * disabled as "Confirming payment…", which covers the usual webhook a few
 * seconds out; after that Pay is live under the pending line (see "How long
 * the hold lasts" for why), and with two or more open its accessibility hint
 * is the footnote naming the invoice a tap pays. The window has its own
 * deadline rather than waiting for the poll to settle, because a poll read
 * can hang for good on Android (#3433). The poll's PAID ends nothing on its
 * own: it makes the list re-read (`useAwaitInvoicePaid`'s onSettled), and the
 * "Paid …" line waits for that read, so the card never says Paid beside a
 * Pending chip.
 *
 * Other open invoices wait meanwhile. The card stays on the held invoice, and
 * the OPEN list shows the rest with their own amounts and due chips.
 *
 * ## How long the hold lasts
 *
 * The hold ends when the invoice list reads the invoice as no longer OPEN
 * (PAID, VOID, or dropped from the list), on a chapter switch, which remounts
 * the screen ({@link DuesScreen}), or when the app is closed. Nothing else
 * ends it. Leaving the screen and coming back, or leaving the app and coming
 * back, doesn't: Dues is a hidden tab route (`href: null` in
 * `app/(tabs)/_layout.tsx`), which the tab navigator keeps mounted, so the
 * hold is there on the return, and the return re-reads the list, which the
 * list's 30s staleTime would otherwise skip.
 *
 * PAID ends it with the "Paid …" line. VOID (a treasurer can void an OPEN
 * invoice, captured payment or not) or a dropped invoice ends it with a line
 * of its own: the member has still been charged, so the line names the
 * invoice (the card is about the next one by then) and says it was cancelled
 * or is gone. VOID is terminal and a dropped invoice gets no further read, so
 * the line doesn't promise an update; only a later PAID read replaces it,
 * with the "Paid …" line. Pay is free for the next invoice, and paying it
 * doesn't take the line away: each captured payment keeps its own line until
 * the visit ends.
 *
 * Nothing this screen reads tells it a payment failed. A payment that sat in
 * `processing` and then failed leaves the invoice OPEN:
 * `notifyStripePaymentFailure` changes no status. It writes a "Payment
 * declined" notification, the in-app row that s14 Notifications lists plus a
 * push, unless the member turned billing notifications off, and that row
 * carries no invoice id (its `data` is only a billing-screen target), so this
 * screen reads neither. The invoice read carries no payment status, and
 * `createPaymentIntent` answers a failed intent and a processing one alike,
 * with a client secret and no status (#3432). So a hold on a failed payment
 * doesn't end on its own, and Pay stays live under the pending line once the
 * confirming window is over, so that a member who got the decline can pay
 * again. A tap meets `createPaymentIntent`'s answer for the invoice's stored
 * intent (`financial-invoice.service.ts`, `billing.md` § Member payment flow):
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
 * processing, so a live Pay under the pending line can't charge twice.
 *
 * While the hold stands, the screen is up and the app is in the foreground,
 * the list is also re-read every {@link HOLD_REREAD_MS}, so a webhook that
 * lands after the poll gives up still ends the hold in front of the member.
 * Re-reads wait for the viewer's id, so none goes out unfiltered.
 *
 * The re-reads join a read already in flight rather than cancelling it, so on
 * Android a read that never answers keeps the hold: nothing there times a
 * request out (#3433). The poll's own re-read as it ends
 * (`useAwaitInvoicePaid`'s invalidation), like any invoice invalidation, does
 * cancel the read in flight and send a fresh one. A tick doesn't restart a
 * stuck read. A fresh request could answer, but cancelling aborts nothing
 * (`useInvoices` passes no `signal`), so every restart would leave one more
 * request open on Android's timeout-free networking, and a read that is only
 * slow would be thrown away. Once #3433 adds a client-side timeout, a stuck
 * read ends in an error and the next tick sends a fresh one.
 *
 * ## What a visit resets
 *
 * Coming back to the screen and the app coming back from the background are
 * the same new visit ({@link startVisit} runs for both): the due chips' clock
 * is taken again, so an invoice that went past due overnight says so; the
 * last attempt's failure line goes; a confirming window that ran out while
 * the member was away ends; and the line about a payment whose hold had
 * already ended when the member left goes. A PAID invoice is in History then
 * as paid, and a VOID one as `Cancelled by your chapter`. A dropped invoice is
 * nowhere on the screen, so once its line goes nothing here records that
 * payment; the line has told the member to ask their treasurer. A hold that
 * ended while the member was away keeps its line through the return, the
 * first visit to draw it: the screen stays mounted and keeps reading, and the
 * poll's own re-read as it ends can read PAID with another screen over this
 * one. A hold carries on. A background spell that starts while a Pay attempt
 * is in flight is part of that attempt, not a leave, so it starts no visit.
 * That is for a bank's page or app opened from the sheet, which can send the
 * app to the background with the sheet still up; derived from the payment
 * methods the server enables (`automatic_payment_methods`), not seen on a
 * device.
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
 * can open a payment sheet at all, a payment sheet already opening, and a
 * captured payment's confirming window.
 */

/** `billing.md`'s own phrase for the window between capture and settlement. */
const PENDING_COPY =
  "Payment received, confirmation pending. This updates as soon as your chapter's records catch up.";

/**
 * The pending line on a card that counts two or more open invoices: it names
 * the held invoice, which is the one a live Pay pays again, since the card's
 * label no longer does and the line takes the footnote's place.
 */
const pendingCopyFor = (title: string) =>
  `Payment received for ${title}, confirmation pending. This updates as soon as your chapter's records catch up.`;

/** The post-sheet poll's budget, `useAwaitInvoicePaid`'s attempts × interval. */
const POLL_ATTEMPTS = 12;
const POLL_INTERVAL_MS = 2000;
/**
 * How long the CTA reads "Confirming payment…" after a sheet completes: the
 * poll's budget, about 24s, whether or not the poll has settled by then. On
 * Android a poll read can hang for good (#3433), and a window that waited for
 * it would keep Pay off for the rest of the session.
 */
const CONFIRMING_WINDOW_MS = POLL_ATTEMPTS * POLL_INTERVAL_MS;

/**
 * How often the invoice list is re-read while a hold stands and the screen is
 * up: after the payment poll (12 × 2s) gives up, nothing else would ask, and
 * the list's 30s staleTime only matters to a read something triggers.
 */
const HOLD_REREAD_MS = 10_000;

/** Names the invoice, because it sits beside the next invoice's CTA. */
const paidCopy = (title: string) =>
  `Paid ${title}. Your chapter has it — thanks.`;

/**
 * The captured payment's invoice read VOID: terminal, so no record will catch
 * up, and the charge is the treasurer's to refund or reissue (`billing.md`
 * § Payment webhook idempotency). Names the invoice, like the "Paid …" line.
 */
const voidedCopy = (title: string) =>
  `Payment received for ${title}, but your chapter has cancelled that invoice. Ask your treasurer about it.`;

/** The captured payment's invoice is gone from the list. */
const droppedCopy = (title: string) =>
  `Payment received for ${title}, but that invoice is no longer on your dues. Ask your treasurer about it.`;

/** The invoice a completed sheet paid, as the hold and its lines need it. */
interface CapturedPayment {
  id: string;
  title: string;
}

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
  // More hides the row while dues is beta-off; this catches a way in that
  // skips More, such as a billing notification. A chapter's own dues switch
  // doesn't close the screen, so a member can still pay an invoice the
  // chapter already sent.
  if (isBetaOffModule("dues")) {
    return <Redirect href="/more" />;
  }
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
  // The invoice read stays off until the id is known, and the pull skips it
  // while it is: unscoped, it would ask for the whole ledger.
  const refresh = useRefetchAll([viewerQuery, invoicesQuery]);
  const payInvoice = usePayInvoice();
  // Wider than the web default of 8 × 1500ms: a phone returning from the Stripe
  // sheet re-renders and re-authenticates on a mobile network, so the same
  // webhook lands later here than it does in a browser tab.
  const awaitPaid = useAwaitInvoicePaid({
    attempts: POLL_ATTEMPTS,
    intervalMs: POLL_INTERVAL_MS,
  });

  /**
   * The invoices completed sheets paid, oldest first. While the list reads one
   * OPEN it is held, across visits; once the list reads it PAID it is a
   * "Paid …" line; voided or gone, a line naming it. The title is kept for the
   * last case, where the list no longer has it. A list, not one slot, so a
   * payment for the next invoice doesn't erase the line about the last one
   * before the visit ends.
   */
  const [payments, setPayments] = useState<readonly CapturedPayment[]>([]);
  const [failure, setFailure] = useState<PayFailure | null>(null);
  /**
   * The Pay attempt that has the CTA reading "Opening…", by its token. Only
   * that attempt clears it, so an earlier attempt's poll ending can't switch
   * Pay back on while a later one's request is in flight.
   */
  const [openingAttempt, setOpeningAttempt] = useState<number | null>(null);
  const lastAttemptRef = useRef(0);
  const isPaying = openingAttempt !== null;
  /**
   * The attempt whose confirming window is open, by its token, so an
   * earlier attempt's poll ending can't end a later one's window. The window
   * closes when the poll settles or its budget runs out, whichever is first.
   */
  const [pollingAttempt, setPollingAttempt] = useState<number | null>(null);
  /** When the latest attempt's confirming window runs out, for a new visit. */
  const pollWindowRef = useRef<{ attempt: number; endsAt: number } | null>(
    null,
  );
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (pollTimerRef.current !== null) clearTimeout(pollTimerRef.current);
    },
    [],
  );
  const isPayingRef = useRef(isPaying);
  useEffect(() => {
    isPayingRef.current = isPaying;
  }, [isPaying]);
  const refetchInvoicesRef = useRef(invoicesQuery.refetch);
  useEffect(() => {
    refetchInvoicesRef.current = invoicesQuery.refetch;
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
  const captures = useMemo(
    () =>
      payments.map((payment) => {
        const row =
          rows.find((candidate) => candidate.id === payment.id) ?? null;
        return {
          payment,
          row,
          held: !listLoaded || row?.status === "OPEN",
        };
      }),
    [payments, rows, listLoaded],
  );
  // Only one is held once the list has loaded: Pay targets the held invoice,
  // so a new payment is for it or comes after it left OPEN. The latest, should
  // that ever slip.
  const heldCaptures = useMemo(
    () => captures.filter((capture) => capture.held),
    [captures],
  );
  const held = heldCaptures[heldCaptures.length - 1] ?? null;
  const isHolding = held !== null;
  const isHoldingRef = useRef(isHolding);
  useEffect(() => {
    isHoldingRef.current = isHolding;
  }, [isHolding]);
  /** The ids held now, as of the last commit. */
  const heldIdsRef = useRef<readonly string[]>([]);
  useEffect(() => {
    heldIdsRef.current = heldCaptures.map((capture) => capture.payment.id);
  });
  /**
   * The ids that were held when the last visit ended. The screen stays
   * mounted and keeps reading while the member is away (the poll's own
   * re-read as it ends, say), so a hold can end off screen; such a payment
   * keeps its line through the next visit, which is the first to draw it.
   */
  const heldAtLeaveRef = useRef<readonly string[]>([]);

  // One clock per visit. A tab is never unmounted, so a mount-only value would
  // still be yesterday's when the member reopens the app — and "Past due" is
  // exactly the label that must not be a day stale.
  const [now, setNow] = useState(() => new Date());
  // Re-reads ask for the viewer's own rows only. While the viewer's id is
  // unknown the query is disabled, and an explicit refetch would still send
  // it, without the `user_id` filter (see `useInvoices` above).
  const rereads = isHolding && viewerUserId !== null;
  const rereadsRef = useRef(rereads);
  useEffect(() => {
    rereadsRef.current = rereads;
  }, [rereads]);
  /**
   * A new visit, the one thing both ways back run (see "What a visit
   * resets"): a fresh clock for the due chips, no failure line from an
   * attempt the member has moved on from, no line about a payment whose
   * invoice had already left OPEN when the member left, and no confirming
   * window that ran out while they were away. A hold that stands carries on,
   * and re-reads the list, so the screen shows whether the webhook landed
   * while the member was away.
   */
  const startVisit = useCallback(() => {
    setNow(new Date());
    setFailure(null);
    const confirmingWindow = pollWindowRef.current;
    if (confirmingWindow !== null && Date.now() >= confirmingWindow.endsAt) {
      setPollingAttempt((current) =>
        current === confirmingWindow.attempt ? null : current,
      );
    }
    const keep = new Set([...heldIdsRef.current, ...heldAtLeaveRef.current]);
    setPayments((current) =>
      current.every((payment) => keep.has(payment.id))
        ? current
        : current.filter((payment) => keep.has(payment.id)),
    );
    if (isHoldingRef.current && rereadsRef.current) {
      void refetchInvoicesRef.current({ cancelRefetch: false });
    }
  }, []);
  /** The member left: what was held then gets the next visit to show how it ended. */
  const endVisit = useCallback(() => {
    heldAtLeaveRef.current = heldIdsRef.current;
  }, []);
  useFocusEffect(
    useCallback(() => {
      startVisit();
      return endVisit;
    }, [startVisit, endVisit]),
  );
  // Back to the app on this screen is an AppState change, which navigation
  // focus never sees, so it starts a visit too. Only a return from
  // `background`, however it passes through `inactive` on the way: iOS goes
  // `inactive` alone for Control Center or a system sheet, which is no leave.
  // And not a return whose background spell began during a Pay attempt,
  // which a bank's page opened from the sheet would cause: clearing the
  // failure line then could wipe the decline the sheet has just reported.
  useEffect(() => {
    let away = AppState.currentState === "background";
    let leftDuringAttempt = false;
    const subscription = AppState.addEventListener(
      "change",
      (next: AppStateStatus) => {
        if (next === "background" && !away) {
          away = true;
          leftDuringAttempt = isPayingRef.current;
          if (!leftDuringAttempt) endVisit();
        } else if (next === "active") {
          if (away && !leftDuringAttempt) startVisit();
          away = false;
        }
      },
    );
    return () => subscription.remove();
  }, [startVisit, endVisit]);
  useFocusEffect(
    useCallback(() => {
      if (!rereads) return undefined;
      const timer = setInterval(() => {
        // Navigation focus doesn't see the app going to the background;
        // TanStack's focusManager does (`lib/connection/query-connectivity.ts`
        // drives it from AppState). And a tick joins a read still in flight
        // rather than cancelling it, so on a slow network one still finishes
        // (see "How long the hold lasts" for one that never does).
        if (!focusManager.isFocused()) return;
        void refetchInvoicesRef.current({ cancelRefetch: false });
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

  // What Pay settles: the held invoice while there is one (`confirming`, the
  // row whose payment is awaiting confirmation), otherwise the earliest-due
  // open invoice, by the same rule the More hub's chip uses. The two still
  // name the same invoice during a hold, since the held one was the earliest
  // open when the member tapped Pay, except if an earlier-due invoice is
  // issued during the hold: the chip names that one, and the card stays on the
  // held one.
  const confirming = held?.row ?? null;
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
      setPayments((current) => [
        ...current.filter((payment) => payment.id !== paying.id),
        { id: paying.id, title: paying.title },
      ]);
      // The sheet is closed; from here the poll, not "Opening…", is what the
      // CTA says, for the poll's budget at most. Only this attempt ends its
      // window, so an earlier attempt's poll ending can't switch Pay back on
      // during a later one's.
      const stopConfirming = () =>
        setPollingAttempt((current) => (current === attempt ? null : current));
      setPollingAttempt(attempt);
      pollWindowRef.current = {
        attempt,
        endsAt: Date.now() + CONFIRMING_WINDOW_MS,
      };
      if (pollTimerRef.current !== null) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(stopConfirming, CONFIRMING_WINDOW_MS);
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
      } finally {
        stopConfirming();
      }
    } catch (error) {
      fail(payIntentErrorCopy(error));
    } finally {
      stopOpening();
    }
  }, [awaitPaid, chapterName, payInvoice, target]);

  // The CTA is busy only for the attempt's confirming window. After that the
  // hold keeps the card, the chip and the pending line, and Pay is live
  // under it: nothing this screen reads says a payment failed, so a re-tap is
  // how a member whose payment failed retries (see "How long the hold lasts").
  const isConfirming = confirming !== null && pollingAttempt !== null;
  const cardStatus: BalanceCardStatus | null = failureText
    ? { text: failureText, tone: "destructive" }
    : confirming
      ? {
          text:
            open.length > 1 ? pendingCopyFor(confirming.title) : PENDING_COPY,
          tone: "neutral",
        }
      : null;
  // Each captured payment's line once its invoice left OPEN, so the card is
  // about another invoice or none, and the line is drawn as its own and names
  // its invoice: "Paid …" when the list says PAID, and otherwise what became
  // of it. A voided or dropped invoice is never updated again, so its line
  // doesn't promise an update.
  const receipts = captures.flatMap(({ payment, row, held: isHeld }) =>
    isHeld
      ? []
      : row?.status === "PAID"
        ? [paidCopy(row.title)]
        : row
          ? [voidedCopy(payment.title)]
          : [droppedCopy(payment.title)],
  );

  // The branches with no card still say where the payment stands and why the
  // last attempt failed: a read that fails right after a payment must not
  // swallow "payment received", or the reason a payment didn't go through.
  const capturedLines = [...(isHolding ? [PENDING_COPY] : []), ...receipts];
  const capturedLine =
    capturedLines.length > 0 ? capturedLines.join("\n") : null;
  const standalone = (
    <CardMessages
      notice={capturedLine}
      failure={failureText}
      align="left"
      placement="screen"
    />
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
          <CardListSkeleton
            label="Loading your dues"
            card={<BalanceCardSkeleton />}
            rows={3}
          />
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
      // The paid invoice can leave the list altogether, and with it every row.
      return (
        <>
          {standalone}
          {/* Empty-states plan rule 7: one line (writing.md § Billing). */}
          <InlineNote>You have no invoices.</InlineNote>
        </>
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
          isPending={confirming !== null}
          isConfirming={isConfirming}
          status={cardStatus}
          receipts={receipts}
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
    <ScreenShell back={BACK_TO_MORE} title="Dues" refresh={refresh}>
      {renderBody()}
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    rows: {
      marginTop: tokens.spacing.xs,
    },
    footer: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      marginTop: tokens.spacing.sm,
    },
  });
}
