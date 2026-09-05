"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

export interface ChapterMembershipSummary {
  chapter_id: string;
  member_id: string;
  role_ids: string[];
  has_completed_onboarding: boolean;
  /**
   * The member-safe projection the API actually returns, not the `chapters`
   * row (#930). `stripe_customer_id` and `subscription_id` were declared here
   * and are deliberately gone: this endpoint carries no billing permission, so
   * the server withholds them. They are available from `GET /v1/billing/status`
   * to callers holding `billing:view`.
   *
   * Keep this in step with `CHAPTER_MEMBER_VIEW_FIELDS` on the API side.
   * `useListChapters` asserts the response into this type, so a field declared
   * here that the server does not send is `undefined` at runtime with nothing
   * failing to say so.
   */
  chapter: {
    id: string;
    name: string;
    university: string;
    subscription_status: "incomplete" | "active" | "past_due" | "canceled";
    past_due_since: string | null;
    accent_color: string | null;
    logo_path: string | null;
    donation_url: string | null;
    created_at: string;
    updated_at: string;
    org_archetype?: string;
    enabled_modules?: Record<string, boolean>;
    vocabulary?: Record<string, unknown>;
    branding?: Record<string, unknown>;
    theme_palette?: Record<string, unknown>;
    analytics_opt_out?: boolean;
  };
}

function chapterQueryKey(...parts: Array<string | null | undefined>) {
  return ["chapters", ...parts];
}

export function useListChapters(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  return useQuery({
    queryKey: chapterQueryKey("accessible"),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/chapters");
      if (error) throw error;
      return (data ?? []) as ChapterMembershipSummary[];
    },
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  });
}

export const useAccessibleChapters = useListChapters;

export function useCurrentChapter(options?: {
  chapterId?: string | null;
  enabled?: boolean;
}) {
  const client = useFrappClient();
  const activeChapterId = useActiveChapterId();
  const chapterId = options?.chapterId ?? activeChapterId ?? null;
  const baseEnabled = options?.enabled ?? true;
  const enabled = baseEnabled && !!chapterId;

  return useQuery({
    queryKey: chapterQueryKey("current", chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/chapters/current");
      if (error) throw error;
      return data;
    },
    staleTime: 300_000,
    enabled,
  });
}

export interface OnboardChapterInput {
  name: string;
  university: string;
  org_archetype?: string;
  directory_id?: string;
  branding?: {
    greek_letters?: string;
    designation?: string;
    school_short?: string;
    founded_at?: number;
    colors?: { accent?: string };
  };
  /** FRA-17: admin accepted the Terms of Service + Privacy Policy. Must be true. */
  accept_terms_privacy: boolean;
}

/**
 * Onboarding wizard submit (Chunk 03). Creates the chapter, materializes its
 * config from the archetype seed, seeds default channels, and posts the welcome
 * message — all server-side (cold path), never via the chat Edge Functions.
 */
export function useOnboardChapter() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: OnboardChapterInput) => {
      const { data, error } = await client.POST("/v1/chapters/onboard", {
        body,
      });
      if (error) throw error;
      return data as unknown as { id: string } & Record<string, unknown>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chapterQueryKey() });
    },
  });
}

/**
 * Persists the caller's active chapter server-side so it lands in the
 * `active_chapter_id` claim of subsequently issued access tokens
 * (spec/behavior/multi-tenancy.md).
 *
 * The claim only changes when a token is issued, so callers MUST refresh the
 * Supabase session afterwards — otherwise the previous claim stands until the
 * current token expires. `apps/web/lib/auth/select-chapter.ts` wraps this hook
 * with that refresh; prefer it over calling this directly.
 */
export function useActivateChapter() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (chapterId: string) => {
      const { data, error } = await client.POST("/v1/chapters/{id}/activate", {
        params: { path: { id: chapterId } },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chapterQueryKey() });
    },
  });
}

export function useUpdateChapter() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const activeChapterId = useActiveChapterId();
  return useMutation({
    mutationFn: async (body: {
      name?: string;
      university?: string;
      accent_color?: string;
      donation_url?: string;
    }) => {
      const { data, error } = await client.PATCH("/v1/chapters/current", {
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chapterQueryKey() });
      queryClient.invalidateQueries({
        queryKey: chapterQueryKey("current", activeChapterId ?? null),
      });
    },
  });
}
