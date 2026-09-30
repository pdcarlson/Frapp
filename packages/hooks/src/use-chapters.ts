"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { markLegalAcceptanceRecorded } from "./legal-acceptance";
import { putSignedUpload } from "./put-signed-upload";
import { readSignedUpload } from "@repo/validation";

export interface ChapterMembershipSummary {
  chapter_id: string;
  member_id: string;
  role_ids: string[];
  has_completed_onboarding: boolean;
  /**
   * `MODULE_CATALOG` keys whose ops-setup nudge this member has dismissed in
   * this chapter (#492). Optional here for the same reason the rest of this
   * interface warns about: `useListChapters` *asserts* the response into this
   * type, so a server older than the column returns `undefined` at runtime with
   * nothing failing to say so. `selectOpsNudge` defaults it.
   */
  dismissed_ops_nudges?: string[];
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

/**
 * The cache key `useCurrentChapter` reads. Exported for writers that change a
 * field the member view carries: `usePatchOrgConfig` patches `enabled_modules`
 * here too, because the web shell's module gate reads it from this payload.
 */
export function currentChapterQueryKey(chapterId: string | null | undefined) {
  return chapterQueryKey("current", chapterId);
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
    short_name?: string;
    show_greek_letters?: boolean;
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
      // The wizard's checkbox is also the officer's own acceptance (#2302).
      markLegalAcceptanceRecorded(queryClient);
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

/**
 * What every write to the current chapter does on success: refetch the
 * chapter queries, so the shell (the nav tile, the accent) repaints. The
 * `["chapters"]` prefix covers `["chapters", "current", id]` and the
 * memberships list alike.
 */
function useInvalidateCurrentChapter() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: chapterQueryKey() });
  };
}

export function useUpdateChapter() {
  const client = useFrappClient();
  const invalidate = useInvalidateCurrentChapter();
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
    onSuccess: invalidate,
  });
}

/** A logo file, already through `inspectUploadFile("image", …)`. */
export interface ChapterLogoUpload {
  body: Blob;
  filename: string;
  /** The type `inspectUploadFile` resolved, not the browser's `file.type`. */
  contentType: string;
}


/**
 * Upload or replace the active chapter's logo (#2591): mint a signed URL, PUT
 * the bytes, then confirm the path, which is the step that changes what the
 * chapter shows and writes the audit row.
 *
 * Every mint is a fresh key (#2592), so a replacement never collides with the
 * logo it replaces and the PUT needs no upsert; confirm deletes the old object.
 * A failure at any step leaves the current logo in place. On success the
 * current-chapter query is invalidated, so the shell repaints with the new
 * signed `logo_url`, a different URL from the old one because the key changed.
 */
export function useUploadChapterLogo() {
  const client = useFrappClient();
  const invalidate = useInvalidateCurrentChapter();
  return useMutation({
    mutationFn: async ({ body, filename, contentType }: ChapterLogoUpload) => {
      const { data: signed, error: mintError } = await client.POST(
        "/v1/chapters/current/logo-url",
        { body: { filename, content_type: contentType } },
      );
      if (mintError) throw mintError;
      const { signedUrl, storagePath } = readSignedUpload(signed);
      await putSignedUpload({
        signedUrl,
        body,
        contentType,
        describeRejection: (status) => `Logo upload failed (${status})`,
      });
      const { data, error } = await client.POST("/v1/chapters/current/logo", {
        body: { storage_path: storagePath },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}

/** Remove the active chapter's logo; the mark falls back to its text. */
export function useRemoveChapterLogo() {
  const client = useFrappClient();
  const invalidate = useInvalidateCurrentChapter();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await client.DELETE("/v1/chapters/current/logo");
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });
}
