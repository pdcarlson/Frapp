"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "@repo/api-sdk";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";
import { aiSuggestionKeys } from "./use-ai-suggestions";

/** One row of `GET /v1/meetings`. */
export type MeetingSummary = components["schemas"]["MeetingSummaryDto"];
/** One meeting's minutes, as `GET /v1/meetings/:id` and every write return them. */
export type MeetingMinutes = components["schemas"]["MeetingDto"];
export type StartMeetingBody = components["schemas"]["StartMeetingDto"];
export type UpdateMeetingBody = components["schemas"]["UpdateMeetingDto"];
export type MeetingTemplateSections =
  components["schemas"]["MeetingTemplateDto"]["sections"];

const meetingsKey = (chapterId: string | null | undefined) =>
  ["meetings", chapterId] as const;
const meetingKey = (chapterId: string | null | undefined, id: string) =>
  ["meetings", chapterId, "one", id] as const;
const templateKey = (chapterId: string | null | undefined) =>
  ["meetings", chapterId, "template"] as const;

/**
 * The minutes the viewer may read, newest meeting first
 * (`spec/behavior/meetings.md` § Who can read minutes): posted minutes whose
 * event invites them, and drafts they started. With `eventId`, only that
 * event's minutes, which the event sheet uses to offer "Open minutes".
 */
export function useMeetings(options?: { enabled?: boolean; eventId?: string }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const eventId = options?.eventId;
  return useQuery({
    queryKey: eventId
      ? ([...meetingsKey(chapterId), "event", eventId] as const)
      : meetingsKey(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/meetings", {
        params: { query: eventId ? { event_id: eventId } : {} },
      });
      if (error) throw error;
      return data;
    },
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/** One meeting's minutes. A 404 means they are not there for this viewer. */
export function useMeeting(id: string | null | undefined) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: meetingKey(chapterId, id ?? ""),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/meetings/{id}", {
        params: { path: { id: id! } },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!chapterId && !!id,
  });
}

/** The sections the chapter's minutes show, in order. */
export function useMeetingTemplate(options?: { enabled?: boolean }) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: templateKey(chapterId),
    queryFn: async () => {
      const { data, error } = await client.GET("/v1/meetings/template");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60_000,
    enabled: (options?.enabled ?? true) && !!chapterId,
  });
}

/** Choose the template's sections. Needs `chapter-config:manage`. */
export function useSetMeetingTemplate() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["meetings", "template"],
    mutationFn: async (sections: MeetingTemplateSections) => {
      const { data, error } = await client.PUT("/v1/meetings/template", {
        body: { sections },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(templateKey(chapterId), data);
      return queryClient.invalidateQueries({
        queryKey: meetingsKey(chapterId),
      });
    },
  });
}

/**
 * Start minutes for a meeting's event, or for a meeting with none. A 409
 * `meeting.already_started` carries the id of the minutes that exist.
 */
export function useStartMeeting() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["meetings", "start"],
    // A lost answer to a start leaves the retry a 409 for minutes that exist.
    retry: false,
    mutationFn: async (body: StartMeetingBody) => {
      const { data, error } = await client.POST("/v1/meetings", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(meetingKey(chapterId, data.id), data);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: meetingsKey(chapterId) }),
        // A meeting with no event got one.
        queryClient.invalidateQueries({ queryKey: ["events", chapterId] }),
      ]);
    },
  });
}

/** Save minutes. A 409 `meeting.stale` means someone else saved since. */
export function useUpdateMeeting() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["meetings", "update"],
    // A save is compare-and-set: a retry after a lost answer is refused as stale.
    retry: false,
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: UpdateMeetingBody;
    }) => {
      const { data, error } = await client.PATCH("/v1/meetings/{id}", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(meetingKey(chapterId, data.id), data);
      // Suggested tasks follow the action items of posted minutes (#4313).
      if (data.status === "posted") {
        void queryClient.invalidateQueries({
          queryKey: aiSuggestionKeys.all(chapterId),
        });
      }
      return queryClient.invalidateQueries({
        queryKey: meetingsKey(chapterId),
        // The open minutes were just set from the answer.
        predicate: (query) => query.queryKey[2] !== "one",
      });
    },
  });
}

/** Post minutes to the members their event invites. */
export function usePostMeeting() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["meetings", "post"],
    // Posting is compare-and-set, and a retry would be refused as stale.
    retry: false,
    mutationFn: async ({
      id,
      expectedUpdatedAt,
    }: {
      id: string;
      expectedUpdatedAt: string;
    }) => {
      const { data, error } = await client.POST("/v1/meetings/{id}/post", {
        params: { path: { id } },
        body: { expected_updated_at: expectedUpdatedAt },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(meetingKey(chapterId, data.id), data);
      // Posting is what turns the action items into suggested tasks (#4313).
      void queryClient.invalidateQueries({
        queryKey: aiSuggestionKeys.all(chapterId),
      });
      return queryClient.invalidateQueries({
        queryKey: meetingsKey(chapterId),
        predicate: (query) => query.queryKey[2] !== "one",
      });
    },
  });
}

/** Delete minutes. */
export function useDeleteMeeting() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["meetings", "delete"],
    // A retry after a lost answer finds nothing to delete.
    retry: false,
    mutationFn: async (id: string) => {
      const { error } = await client.DELETE("/v1/meetings/{id}", {
        params: { path: { id } },
      });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) => {
      queryClient.removeQueries({ queryKey: meetingKey(chapterId, id) });
      // Its suggested tasks went with it (#4313).
      void queryClient.invalidateQueries({
        queryKey: aiSuggestionKeys.all(chapterId),
      });
      return queryClient.invalidateQueries({
        queryKey: meetingsKey(chapterId),
      });
    },
  });
}

// ── Drafting from notes (#4312) ──────────────────────────────────────────────

/** Where a meeting's draft from notes stands. */
export type MeetingDraftState = components["schemas"]["MeetingDraftDto"];
export type RequestMeetingDraftBody =
  components["schemas"]["RequestMeetingDraftDto"];

const meetingDraftKey = (chapterId: string | null | undefined, id: string) =>
  ["meetings", chapterId, "draft", id] as const;

/** How often the page asks while a draft is being written. */
const DRAFTING_POLL_MS = 1500;

/**
 * Where the draft from notes stands for one meeting's minutes, for someone
 * who may edit them. `null` means this server has no AI drafting (the route
 * answers 404 `ai.not_available`, or the meetings module is off), and the
 * caller shows the hand-written flow alone. While a draft is being written
 * the query asks again every second and a half, and stops when it ends.
 */
export function useMeetingDraft(
  id: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: meetingDraftKey(chapterId, id ?? ""),
    queryFn: async (): Promise<MeetingDraftState | null> => {
      const { data, error, response } = await client.GET(
        "/v1/meetings/{id}/draft",
        { params: { path: { id: id! } } },
      );
      // Not here for this viewer, whatever the reason: no AI on this server,
      // minutes they can't edit, a module that is off.
      if (response.status === 404 || response.status === 403) return null;
      if (error) throw error;
      return data;
    },
    enabled: (options?.enabled ?? true) && !!chapterId && !!id,
    refetchInterval: (query) =>
      query.state.data?.status === "drafting" ? DRAFTING_POLL_MS : false,
  });
}

/**
 * Ask for minutes drafted from notes. Refusals carry a code: `ai.chapter_off`,
 * `ai.consent.required`, `meeting.stale`, `meeting.draft_posted`,
 * `meeting.standards_refused`.
 */
export function useRequestMeetingDraft() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["meetings", "draft", "request"],
    // A retry after a lost answer would start a second draft.
    retry: false,
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: RequestMeetingDraftBody;
    }) => {
      const { data, error } = await client.POST("/v1/meetings/{id}/draft", {
        params: { path: { id } },
        body,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data, { id }) => {
      queryClient.setQueryData(meetingDraftKey(chapterId, id), data);
    },
  });
}

/**
 * Put a draft that waited into the minutes, at the version the editor has.
 * Refused with `meeting.stale` when the minutes moved again.
 */
export function useUseMeetingDraft() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["meetings", "draft", "use"],
    retry: false,
    mutationFn: async ({
      id,
      expectedUpdatedAt,
    }: {
      id: string;
      expectedUpdatedAt: string;
    }) => {
      const { data, error } = await client.POST("/v1/meetings/{id}/draft/use", {
        params: { path: { id } },
        body: { expected_updated_at: expectedUpdatedAt },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data, { id }) => {
      queryClient.setQueryData(meetingDraftKey(chapterId, id), data);
    },
  });
}

/**
 * Clear the notes and the draft, and stop one still being written. With
 * `keepNotes`, only stop it: the notes stay stored for another ask.
 */
export function useDiscardMeetingDraft() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["meetings", "draft", "discard"],
    mutationFn: async ({
      id,
      keepNotes = false,
    }: {
      id: string;
      keepNotes?: boolean;
    }) => {
      const { error } = await client.DELETE("/v1/meetings/{id}/draft", {
        params: { path: { id }, query: { keep_notes: keepNotes } },
      });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) =>
      queryClient.invalidateQueries({
        queryKey: meetingDraftKey(chapterId, id),
      }),
  });
}

// ── Uploading a recording (#712) ─────────────────────────────────────────────

/** Where a meeting's uploaded recording stands. */
export type MeetingRecordingState =
  components["schemas"]["MeetingRecordingDto"];
export type StartMeetingRecordingBody =
  components["schemas"]["StartMeetingRecordingDto"];

const meetingRecordingKey = (
  chapterId: string | null | undefined,
  id: string,
) => ["meetings", chapterId, "recording", id] as const;

/** How often the page asks while a recording is being transcribed. */
const TRANSCRIBING_POLL_MS = 4000;

/**
 * Where one meeting's recording stands, for someone who may edit its
 * minutes. `null` means there is no recording upload here for this viewer
 * (no AI on this server, minutes they can't edit, a module that is off), and
 * the caller shows the notes box alone. While a recording is being
 * transcribed the query asks again every four seconds, and stops when it
 * ends, so the state survives a reload or a closed tab.
 */
export function useMeetingRecording(
  id: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: meetingRecordingKey(chapterId, id ?? ""),
    queryFn: async (): Promise<MeetingRecordingState | null> => {
      const { data, error, response } = await client.GET(
        "/v1/meetings/{id}/recording",
        { params: { path: { id: id! } } },
      );
      if (response.status === 404 || response.status === 403) return null;
      if (error) throw error;
      return data;
    },
    enabled: (options?.enabled ?? true) && !!chapterId && !!id,
    refetchInterval: (query) =>
      query.state.data?.status === "transcribing"
        ? TRANSCRIBING_POLL_MS
        : false,
  });
}

/**
 * Start an upload: the server checks the file and answers with where to send
 * it (`upload`). Refusals carry a code: `meeting.recording_notice_required`,
 * `meeting.recording_format`, `meeting.recording_too_large`,
 * `meeting.recording_too_short`, `meeting.recording_too_long`,
 * `meeting.recording_unavailable`, `meeting.standards_refused`,
 * `meeting.draft_posted`, `ai.chapter_off`, `ai.consent.required`.
 */
export function useStartMeetingRecording() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["meetings", "recording", "start"],
    // A retry after a lost answer would replace the upload it just started.
    retry: false,
    mutationFn: async ({
      id,
      body,
    }: {
      id: string;
      body: StartMeetingRecordingBody;
    }) => {
      const { data, error } = await client.POST(
        "/v1/meetings/{id}/recording",
        { params: { path: { id } }, body },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (data, { id }) => {
      // The signature is for the uploader alone, not for the cache.
      queryClient.setQueryData(meetingRecordingKey(chapterId, id), {
        ...data,
        upload: null,
      });
    },
  });
}

/** The file is in storage: transcribe it. Safe to send twice. */
export function useConfirmMeetingRecording() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["meetings", "recording", "uploaded"],
    mutationFn: async ({ id, uploadId }: { id: string; uploadId: string }) => {
      const { data, error } = await client.POST(
        "/v1/meetings/{id}/recording/uploaded",
        { params: { path: { id } }, body: { upload_id: uploadId } },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (data, { id }) => {
      queryClient.setQueryData(meetingRecordingKey(chapterId, id), data);
    },
  });
}

/** Remove the recording and its transcript, and stop a transcription. */
export function useRemoveMeetingRecording() {
  const client = useFrappClient();
  const queryClient = useQueryClient();
  const chapterId = useActiveChapterId();
  return useMutation({
    mutationKey: ["meetings", "recording", "remove"],
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await client.DELETE("/v1/meetings/{id}/recording", {
        params: { path: { id } },
      });
      if (error) throw error;
      return id;
    },
    onSuccess: (id) =>
      queryClient.invalidateQueries({
        queryKey: meetingRecordingKey(chapterId, id),
      }),
  });
}
