"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentChapter } from "@repo/hooks";
import { useChapterStore } from "@/lib/stores/chapter-store";
import type { PatchChapterConfig } from "@repo/validation";

const BASE_URL =
  process.env["NEXT_PUBLIC_API_URL"] ?? "http://localhost:3001";

async function fetchChapterConfig(chapterId: string, token: string) {
  const res = await fetch(`${BASE_URL}/chapters/${chapterId}/config`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch chapter config: ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

async function patchChapterConfig(
  chapterId: string,
  token: string,
  diff: PatchChapterConfig,
) {
  const res = await fetch(`${BASE_URL}/chapters/${chapterId}/config`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(diff),
  });
  if (!res.ok) throw new Error(`Failed to patch chapter config: ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

function useAuthToken(): string | null {
  // The app stores the active Supabase session in the auth store;
  // use the same pattern as other hooks in the web app.
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("frapp-auth-token");
    return raw ?? null;
  } catch {
    return null;
  }
}

export function useOrgConfig() {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  useCurrentChapter({ chapterId: activeChapterId });
  const token = useAuthToken();

  return useQuery({
    queryKey: ["chapter-config", activeChapterId],
    queryFn: () =>
      fetchChapterConfig(activeChapterId!, token!),
    enabled: !!activeChapterId && !!token,
    staleTime: 5 * 60 * 1000,
    select: (data) => ({
      ...data,
      // Helpers derived from the config
      isModuleEnabled: (key: string) =>
        (data["enabled_modules"] as Record<string, boolean>)?.[key] !== false,
    }),
  });
}

export function usePatchOrgConfig() {
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const token = useAuthToken();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (diff: PatchChapterConfig) =>
      patchChapterConfig(activeChapterId!, token!, diff),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["chapter-config", activeChapterId] });
    },
  });
}
