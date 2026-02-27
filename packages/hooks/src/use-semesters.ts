"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useFrappClient } from "./use-frapp-client";

export function useSemesters() {
  const client = useFrappClient();
  return useQuery({
    queryKey: ["semesters"],
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/semesters");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
  });
}

export function useSemesterRollover() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      label: string;
      start_date: string;
      end_date: string;
    }) => {
      const { data, error } = await client.POST(
        "/v1/chapters/current/rollover",
        { body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["semesters"] });
      queryClient.invalidateQueries({ queryKey: ["chapters"] });
    },
  });
}
