"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";
import { useActiveChapterId } from "./use-frapp-client";

export function useBillingStatus() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: ["billing", "status", chapterId],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/billing/status");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
  });
}

export function useCreateCheckout() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (body: {
      customer_email: string;
      success_url: string;
      cancel_url: string;
    }) => {
      const { data, error } = await client.POST("/v1/billing/checkout", {
        body,
      });
      if (error) throw error;
      return data;
    },
  });
}

export function useCreatePortal() {
  const client = useFrappClient();
  return useMutation({
    mutationFn: async (body: { return_url: string }) => {
      const { data, error } = await client.POST("/v1/billing/portal", {
        body,
      });
      if (error) throw error;
      return data;
    },
  });
}
