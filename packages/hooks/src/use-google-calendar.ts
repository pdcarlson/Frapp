import { throwUnlessOk } from "@repo/api-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createChapterQueryKeys } from "./chapter-query-keys";
import { useActiveChapterId, useFrappClient } from "./use-frapp-client";

/**
 * The member's Google Calendar connection (#3322, step 2): Frapp writes the
 * chapter's events they can see and their open tasks into a calendar of its
 * own in their Google account. Behavior: `spec/behavior/events.md` § Google
 * Calendar. The subscription link (`use-calendar-feed.ts`) stays the way in
 * for Apple Calendar and Outlook, and for Google when this isn't offered.
 */
export const googleCalendarKeys = createChapterQueryKeys("google-calendar");

export interface GoogleCalendarStatus {
  /** False until the server's Google settings are set: hide the option. */
  available: boolean;
  connected: boolean;
  status: "active" | "needs_reconnect" | null;
  google_email: string | null;
  last_synced_at: string | null;
}

/** The query params Google's sign-in comes back to the client with. */
export const GOOGLE_CALENDAR_RETURN_PARAMS = [
  "gcal",
  "gcal_code",
  "gcal_state",
] as const;

/**
 * What a return from Google's sign-in says: finish it (`confirm`, with the
 * code and the sign-in it belongs to), the member cancelled (`denied`), or it
 * can't be finished (`failed`, `expired`). Null when the URL carries none.
 */
export type GoogleCalendarReturn =
  | { kind: "confirm"; code: string; state: string }
  | { kind: "denied" | "failed" | "expired" };

export function readGoogleCalendarReturn(
  params: URLSearchParams,
): GoogleCalendarReturn | null {
  const outcome = params.get("gcal");
  if (outcome === "confirm") {
    const code = params.get("gcal_code");
    const state = params.get("gcal_state");
    return code && state
      ? { kind: "confirm", code, state }
      : { kind: "failed" };
  }
  if (outcome === "denied" || outcome === "expired") return { kind: outcome };
  return outcome ? { kind: "failed" } : null;
}

/**
 * What the member reads when a sign-in comes back without connecting (#4676):
 * one copy for the web menu's toast and the phone sheet's alert. The
 * success line stays per client, because each names what it syncs.
 */
export const GOOGLE_CALENDAR_RETURN_COPY: Record<
  Exclude<GoogleCalendarReturn["kind"], "confirm">,
  string
> = {
  denied: "Google Calendar wasn't connected.",
  expired: "That Google sign-in expired. Connect Google Calendar again.",
  failed: "Google didn't finish the sign-in. Connect Google Calendar again.",
};

/**
 * The line under the Subscribe menu or sheet: how fresh each calendar stays.
 * `connection` is the status when Google is offered, null when it isn't.
 */
export function googleCalendarFootnote(
  connection: Pick<GoogleCalendarStatus, "connected" | "google_email"> | null,
): string {
  if (connection?.connected && connection.google_email) {
    return `Google Calendar is connected as ${connection.google_email} and updates within minutes. Other calendar apps check on their own schedule.`;
  }
  return connection
    ? "Google Calendar updates within minutes once connected. Other calendar apps check on their own schedule."
    : "Your calendar app checks for changes on its own schedule. Google Calendar can take several hours.";
}

/** The Disconnect confirm, naming the account when it's known. */
export function googleCalendarDisconnectCopy(
  account: string | null | undefined,
): {
  title: string;
  description: string;
} {
  return {
    title: "Disconnect Google Calendar?",
    description: `Frapp's calendar is removed from ${
      account ? `your Google account (${account})` : "your Google account"
    }. Your other calendars aren't touched.`,
  };
}

export function useGoogleCalendarStatus(options: { enabled?: boolean } = {}) {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  return useQuery({
    queryKey: googleCalendarKeys.chapter(chapterId!),
    queryFn: async ({ signal }): Promise<GoogleCalendarStatus> => {
      const result = await client.GET("/v1/google-calendar", { signal });
      throwUnlessOk(result);
      return result.data!;
    },
    staleTime: 60_000,
    enabled: (options.enabled ?? true) && !!chapterId,
  });
}

/**
 * Start a sign-in. Resolves to Google's consent page: web sends the browser
 * there, and the phone opens it in an auth session that returns to
 * `returnUrl`, the app's own `frapp://` address.
 */
export function useStartGoogleCalendarConnect() {
  const client = useFrappClient();
  return useMutation({
    mutationKey: ["google-calendar", "connect"],
    mutationFn: async (
      input: { client: "web" } | { client: "mobile"; returnUrl: string },
    ): Promise<string> => {
      const result = await client.POST("/v1/google-calendar/connect", {
        body:
          input.client === "mobile"
            ? { client: "mobile", return_url: input.returnUrl }
            : { client: "web" },
      });
      throwUnlessOk(result);
      return result.data!.authorize_url;
    },
  });
}

/** Finish a sign-in with what Google returned. Only its starter can. */
export function useConfirmGoogleCalendarConnect() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["google-calendar", "confirm"],
    mutationFn: async (input: {
      code: string;
      state: string;
    }): Promise<GoogleCalendarStatus> => {
      const result = await client.POST("/v1/google-calendar/confirm", {
        body: input,
      });
      throwUnlessOk(result);
      return result.data!;
    },
    onSuccess: (status) => {
      if (chapterId) {
        queryClient.setQueryData(googleCalendarKeys.chapter(chapterId), status);
      }
    },
  });
}

/** Remove Frapp's calendar from Google and revoke Frapp's access. */
export function useDisconnectGoogleCalendar() {
  const client = useFrappClient();
  const chapterId = useActiveChapterId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ["google-calendar", "disconnect"],
    mutationFn: async (): Promise<void> => {
      const result = await client.DELETE("/v1/google-calendar");
      throwUnlessOk(result);
    },
    onSuccess: () => {
      if (!chapterId) return;
      queryClient.setQueryData<GoogleCalendarStatus>(
        googleCalendarKeys.chapter(chapterId),
        (current) => ({
          available: current?.available ?? true,
          connected: false,
          status: null,
          google_email: null,
          last_synced_at: null,
        }),
      );
    },
  });
}
