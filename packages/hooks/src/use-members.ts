"use client";

import { useQuery } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useMembers() {
  const client = useFrappClient();

  return useQuery({
    queryKey: ["members"],
    queryFn: async () => {
      const { data, error } = await client.GET("/members", {
        params: {
          header: {
            "x-chapter-id": "", // Handled by middleware but required by types
          } as any,
        },
      });
      if (error) throw error;
      return data;
    },
  });
}
