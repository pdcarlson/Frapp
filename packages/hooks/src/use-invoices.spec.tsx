import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { createFrappClient } from "@repo/api-sdk";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappClientProvider } from "./use-frapp-client";
import { useCreateInvoice } from "./use-invoices";

const INVOICES_QUERY_KEY = ["invoices"];
const CREATE_INVOICE_PATH = "/v1/invoices";

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

  const createWrapper = (mockClient: unknown) => {
    const Wrapper = ({ children }: { children: React.ReactNode }) => (
      <FrappClientProvider
        client={
          mockClient as unknown as ReturnType<typeof createFrappClient>
        }
      >
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </FrappClientProvider>
    );

    Wrapper.displayName = "UseCreateInvoiceTestWrapper";
    return Wrapper;
  };

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
