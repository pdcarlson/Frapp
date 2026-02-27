"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useInvoices(userId?: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["invoices", userId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/invoices", {
        params: { query: { user_id: userId } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

export function useInvoice(id: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["invoices", id],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/invoices/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!id,
  });
}

export function useOverdueInvoices() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["invoices", "overdue"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/invoices/overdue");
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
  });
}

export function useInvoiceTransactions(invoiceId: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["invoices", invoiceId, "transactions"],
    queryFn: async () => {
      const { data, error } = await client.GET(
        "/v1/invoices/{id}/transactions",
        { params: { path: { id: invoiceId } } },
      );
      if (error) throw error;
      return data;
    },
    staleTime: 30_000,
    enabled: !!invoiceId,
  });
}

export function useCreateInvoice() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
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
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export function useUpdateInvoice() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: {
        title?: string;
        description?: string;
        amount?: number;
        due_date?: string;
      };
    }) => {
      const { data, error } = await client.PATCH("/v1/invoices/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}

export function useTransitionInvoiceStatus() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
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
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
    },
  });
}
