import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { createFrappClient } from "@repo/api-sdk";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappClientProvider } from "./use-frapp-client";
import {
  useAwaitInvoicePaid,
  useCreateInvoice,
  usePayInvoice,
} from "./use-invoices";

const CHAPTER_ID = "chapter-abc";
// The invoice hooks invalidate `["invoices", chapterId]`, which prefix-matches
// every per-chapter invoice query (`["invoices", chapterId, userId]` etc.).
// Asserting a bare `["invoices"]` here would not match what the hooks actually
// pass, so the wrapper supplies a real chapter id.
const INVOICES_QUERY_KEY = ["invoices", CHAPTER_ID];
const CREATE_INVOICE_PATH = "/v1/invoices";
const PAYMENT_INTENT_PATH = "/v1/invoices/{id}/payment-intent";
const INVOICE_PATH = "/v1/invoices/{id}";

function makeWrapper(
  queryClient: QueryClient,
  mockClient: unknown,
  displayName: string,
) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <FrappClientProvider
      client={mockClient as unknown as ReturnType<typeof createFrappClient>}
      chapterId={CHAPTER_ID}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </FrappClientProvider>
  );

  Wrapper.displayName = displayName;
  return Wrapper;
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

describe("useCreateInvoice", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  const createWrapper = (mockClient: unknown) =>
    makeWrapper(queryClient, mockClient, "UseCreateInvoiceTestWrapper");

  it("creates an invoice and invalidates invoices queries on success", async () => {
    const createdInvoice = { id: "inv-123", title: "Spring dues" };
    const mockPost = vi.fn().mockResolvedValue({
      data: createdInvoice,
      error: null,
    });
    const mockClient = { POST: mockPost };
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const createInvoiceInput = {
      user_id: "user-123",
      title: "Spring dues",
      description: "Chapter semester dues",
      amount: 15000,
      due_date: "2026-04-01",
    };

    const { result } = renderHook(() => useCreateInvoice(), {
      wrapper: createWrapper(mockClient),
    });

    result.current.mutate(createInvoiceInput);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockPost).toHaveBeenCalledWith(CREATE_INVOICE_PATH, {
      body: createInvoiceInput,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: INVOICES_QUERY_KEY,
    });
  });

  it("surfaces API errors and does not invalidate invoices queries", async () => {
    const requestError = new Error("Invoice creation failed");
    const mockPost = vi.fn().mockResolvedValue({
      data: null,
      error: requestError,
    });
    const mockClient = { POST: mockPost };
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const createInvoiceInput = {
      user_id: "user-999",
      title: "Late fee",
      amount: 2500,
      due_date: "2026-05-15",
    };

    const { result } = renderHook(() => useCreateInvoice(), {
      wrapper: createWrapper(mockClient),
    });

    result.current.mutate(createInvoiceInput);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toEqual(requestError);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("usePayInvoice", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
  });

  it("mints a payment intent for the given invoice and returns the client secret", async () => {
    const mockPost = vi.fn().mockResolvedValue({
      data: { client_secret: "pi_123_secret_abc", payment_intent_id: "pi_123" },
      error: null,
    });

    const { result } = renderHook(() => usePayInvoice(), {
      wrapper: makeWrapper(queryClient, { POST: mockPost }, "UsePayInvoiceTestWrapper"),
    });

    result.current.mutate("inv-1");

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(mockPost).toHaveBeenCalledWith(PAYMENT_INTENT_PATH, {
      params: { path: { id: "inv-1" } },
    });
    expect(result.current.data).toEqual({
      client_secret: "pi_123_secret_abc",
      payment_intent_id: "pi_123",
    });
  });

  it("surfaces the API error and does not invalidate invoice queries", async () => {
    // The real 409 body from financial-invoice.service.ts — the dialog maps it
    // to member-facing copy, so the raw status has to survive the hook.
    const conflict = {
      statusCode: 409,
      message: "Payment already completed; confirmation is being processed",
    };
    const mockPost = vi.fn().mockResolvedValue({ data: null, error: conflict });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => usePayInvoice(), {
      wrapper: makeWrapper(queryClient, { POST: mockPost }, "UsePayInvoiceErrorTestWrapper"),
    });

    result.current.mutate("inv-1");

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toEqual(conflict);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe("useAwaitInvoicePaid", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = makeQueryClient();
  });

  it("resolves true once the webhook has flipped the invoice to PAID", async () => {
    // First read still OPEN (the webhook has not landed yet), second is PAID.
    const mockGet = vi
      .fn()
      .mockResolvedValueOnce({ data: { id: "inv-1", status: "OPEN" }, error: null })
      .mockResolvedValueOnce({ data: { id: "inv-1", status: "PAID" }, error: null });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => useAwaitInvoicePaid({ attempts: 5, intervalMs: 0 }),
      {
        wrapper: makeWrapper(queryClient, { GET: mockGet }, "UseAwaitPaidTestWrapper"),
      },
    );

    result.current.mutate("inv-1");

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.data).toBe(true);
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenCalledWith(INVOICE_PATH, {
      params: { path: { id: "inv-1" } },
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: INVOICES_QUERY_KEY,
    });
  });

  it("gives up after the configured attempts rather than reporting a false PAID", async () => {
    const mockGet = vi
      .fn()
      .mockResolvedValue({ data: { id: "inv-1", status: "OPEN" }, error: null });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(
      () => useAwaitInvoicePaid({ attempts: 3, intervalMs: 0 }),
      {
        wrapper: makeWrapper(queryClient, { GET: mockGet }, "UseAwaitPaidTimeoutTestWrapper"),
      },
    );

    result.current.mutate("inv-1");

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Resolves false — "payment received, confirmation pending" — never true.
    expect(result.current.data).toBe(false);
    expect(mockGet).toHaveBeenCalledTimes(3);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: INVOICES_QUERY_KEY,
    });
  });
});
