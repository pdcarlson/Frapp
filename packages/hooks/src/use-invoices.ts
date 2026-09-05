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
export function useInvoices(
  userId?: string,
  options?: { enabled?: boolean },
) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["invoices", chapterId, userId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/invoices", {
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
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/invoices/overdue");
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

/**
 * Poll an invoice until the Stripe webhook has flipped it to PAID.
 *
 * A successful `confirmPayment` in the browser means the money moved, not that
 * the invoice row settled: `payment_intent.succeeded` → `apply_invoice_payment`
 * is what actually writes PAID, and that webhook lands out-of-band. So rather
 * than optimistically marking the invoice paid — which would show PAID even if
 * the reconciliation later failed — re-read until the server agrees.
 *
 * Resolves `false` once the attempts are exhausted so a slow webhook degrades
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
    mutationFn: async (invoiceId: string) => {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const { data } = await client.GET("/v1/invoices/{id}", {
          params: { path: { id: invoiceId } },
        });
        if ((data as { status?: string } | undefined)?.status === "PAID") {
          return true;
        }
        if (attempt < attempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
      }
      return false;
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
