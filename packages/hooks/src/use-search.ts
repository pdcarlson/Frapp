"use client";

import { useQuery } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useSearch(query: string) {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["search", query],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/search", {
        params: { query: { q: query } },
      });
      if (error) throw error;
      return data;
    },
    staleTime: 0,
    enabled: !!query,
  });
}
