"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * Invoices for a chapter, or for one member.
 *
 * **Pass `userId` on a member-facing surface.** `GET /v1/invoices` returns the
 * *whole chapter's* rows to a `billing:view` holder and only the caller's to
 * everyone else, so an unfiltered read on a treasurer's device pulls every
 * member's amounts and due dates into the cache to render one person's balance
 * — under a key shared with the admin surfaces. The server short-circuits
 * `user_id === self` before its RBAC check, so passing your own id always works
 * and needs no permission.
 *
 * `options.enabled` exists because the viewer's id arrives asynchronously from
 * `/v1/users/me`: without it the query fires once unfiltered and again filtered,
 * which is the over-fetch this parameter is meant to avoid.
 */
export function useInvoices(userId?: string, options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["invoices", chapterId, userId],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/invoices", {
        signal,
        params: { query: { user_id: userId } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}

export function useOverdueInvoices() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["invoices", chapterId, "overdue"],
    queryFn: async ({ signal }) => {
      const { data, error } = await client.GET("/v1/invoices/overdue", {
        signal,
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!chapterId,
  });
}

export function useCreateInvoice() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["invoices", "create-invoice"],
    mutationFn: async (body: {
      user_id: string;
      title: string;
      description?: string;
      amount: number;
      due_date: string;
    }) => {
      const { data, error } = await client.POST("/v1/invoices", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", chapterId] });
    },
  });
}

/**
 * Mint (or reuse) a Stripe PaymentIntent for the caller's own OPEN invoice.
 *
 * Returns the `client_secret` the Stripe Elements sheet confirms against. The
 * server owns every guard worth trusting — ownership (403), OPEN-ness (400,
 * re-checked *after* the Stripe round-trip), and a per-invoice idempotency key
 * so two concurrent taps collapse into one chargeable intent rather than two.
 *
 * Deliberately does NOT invalidate the invoice queries: creating an intent
 * moves no money and changes no invoice state. The refresh belongs after
 * confirmation — see `useAwaitInvoicePaid`.
 */
export function usePayInvoice() {
  const client = useFrappClient();
  return useMutation({
    mutationKey: ["invoices", "pay-invoice"],
    mutationFn: async (invoiceId: string) => {
      const { data, error } = await client.POST(
        "/v1/invoices/{id}/payment-intent",
        { params: { path: { id: invoiceId } } },
      );
      if (error) throw error;
      return data;
    },
  });
}

/** How a post-payment poll ended: settled, failed, or still unconfirmed. */
export type AwaitInvoicePaidResult =
  | { outcome: "paid" }
  | { outcome: "failed"; reason: string | null }
  | { outcome: "pending" };

/**
 * Stripe's `created`, which the server records as `last_payment_failed_at`,
 * is whole seconds, rounded down: a failure that came after a client's
 * moment can read up to a second before it.
 */
const FAILED_AT_ROUNDING_MS = 1000;

/**
 * The server's record of a failed payment on an invoice read (#3460), or
 * null. Only an OPEN invoice's counts.
 *
 * `since` is the client's own moment the outcome must come after: web's
 * submit, mobile's sheet completing. The record says the latest payment on
 * the intent failed, not which try: a member can retry inside one attempt
 * (another card in the same form or sheet) without a new pay-endpoint stamp,
 * and that try's earlier decline stays recorded while the retry succeeds or
 * processes. A failure from before `since` is that earlier decline, so it
 * doesn't count. Without `since`, any recorded failure does.
 */
export function invoicePaymentFailure(
  data: unknown,
  since?: number,
): { failedAt: string; reason: string | null } | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.status !== "OPEN") return null;
  const failedAt = row.last_payment_failed_at;
  if (typeof failedAt !== "string" || failedAt === "") return null;
  if (since !== undefined) {
    const at = Date.parse(failedAt);
    if (Number.isNaN(at) || at < since - FAILED_AT_ROUNDING_MS) return null;
  }
  const reason = row.last_payment_failure_reason;
  return {
    failedAt,
    reason: typeof reason === "string" && reason.trim() !== "" ? reason : null,
  };
}

/**
 * Poll an invoice until the Stripe webhook has flipped it to PAID, or has
 * recorded that the payment failed.
 *
 * A successful `confirmPayment` in the browser means the money moved, not that
 * the invoice row settled: `payment_intent.succeeded` → `apply_invoice_payment`
 * is what actually writes PAID, and that webhook lands out-of-band. So rather
 * than optimistically marking the invoice paid — which would show PAID even if
 * the reconciliation later failed — re-read until the server agrees. A
 * `processing` payment can also fail later (a bank debit, a delayed decline);
 * the `payment_intent.payment_failed` webhook records that on the invoice
 * (#3460), and the poll ends with `failed` the moment a read shows one newer
 * than `since` (see {@link invoicePaymentFailure}). Pass the invoice id alone,
 * or `{ invoiceId, since }`.
 *
 * Resolves `pending` once the attempts are exhausted so a slow webhook degrades
 * to an honest "payment received, confirmation pending" instead of hanging the
 * dialog open forever or lying about the outcome. Invalidates the invoice
 * queries either way, since the row may well have changed.
 */
export function useAwaitInvoicePaid(options?: {
  attempts?: number;
  intervalMs?: number;
}) {
  const attempts = options?.attempts ?? 8;
  const intervalMs = options?.intervalMs ?? 1500;
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["invoices", "await-invoice-paid"],
    mutationFn: async (
      input: string | { invoiceId: string; since?: number },
    ): Promise<AwaitInvoicePaidResult> => {
      const { invoiceId, since } =
        typeof input === "string" ? { invoiceId: input, since: undefined } : input;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const { data } = await client.GET("/v1/invoices/{id}", {
          params: { path: { id: invoiceId } },
        });
        if ((data as { status?: string } | undefined)?.status === "PAID") {
          return { outcome: "paid" };
        }
        const failure = invoicePaymentFailure(data, since);
        if (failure) return { outcome: "failed", reason: failure.reason };
        if (attempt < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }
      return { outcome: "pending" };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", chapterId] });
    },
  });
}

export function useTransitionInvoiceStatus() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["invoices", "transition-invoice-status"],
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: { status: "OPEN" | "PAID" | "VOID" };
    }) => {
      const { data, error } = await client.POST("/v1/invoices/{id}/status", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices", chapterId] });
    },
  });
}
