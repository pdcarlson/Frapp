import { useEffect } from "react";
import { Alert } from "react-native";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  errorCopy,
  GOOGLE_CALENDAR_RETURN_COPY,
  googleCalendarDisconnectCopy,
  readGoogleCalendarReturn,
  useConfirmGoogleCalendarConnect,
  useDisconnectGoogleCalendar,
  useGoogleCalendarStatus,
  useStartGoogleCalendarConnect,
} from "@repo/hooks";

export const GOOGLE_CALENDAR_WEB = "https://calendar.google.com/calendar/r";

/**
 * Sign-ins this app has already finished, by return address and by sign-in.
 * Kept for the life of the process, not a screen: `Linking.useURL` hands
 * every new mount the address that launched the app, so a screen that mounts
 * again (a chapter switch, signing in again) would post a spent code and say
 * the connection failed. Shared by every screen that connects (the Events
 * sheet and Settings), so the two never both finish one sign-in.
 */
const finishedSignIns = new Set<string>();

/**
 * Google Calendar's connect, finish and disconnect on the phone (#3322,
 * #5407), for the Events Subscribe sheet and Settings → Linked apps.
 * `returnPath` is the screen Google's sign-in comes back to, the one the
 * member started on. `beforeOpen` runs as the sign-in opens (the sheet closes
 * itself).
 */
export function useGoogleCalendarConnection({
  returnPath,
  beforeOpen,
}: {
  returnPath: string;
  beforeOpen?: () => void;
}) {
  const status = useGoogleCalendarStatus();
  const start = useStartGoogleCalendarConnect();
  const confirm = useConfirmGoogleCalendarConnect().mutateAsync;
  const disconnectMutation = useDisconnectGoogleCalendar();
  const returnUrl = Linking.useURL();

  /**
   * Finish a sign-in Google sent back. The same address can arrive twice (the
   * sign-in sheet's result, and the system handing it to the app), and the
   * code is single use, so each sign-in is finished once.
   */
  function finish(url: string) {
    const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
    const outcome = readGoogleCalendarReturn(new URLSearchParams(query));
    if (!outcome || finishedSignIns.has(url)) return;
    finishedSignIns.add(url);
    if (outcome.kind !== "confirm") {
      if (outcome.kind !== "denied") {
        Alert.alert(
          "Google Calendar wasn't connected",
          outcome.kind === "expired"
            ? GOOGLE_CALENDAR_RETURN_COPY.expired
            : GOOGLE_CALENDAR_RETURN_COPY.failed,
        );
      }
      return;
    }
    if (finishedSignIns.has(outcome.state)) return;
    finishedSignIns.add(outcome.state);
    void confirm({ code: outcome.code, state: outcome.state })
      .then(() =>
        Alert.alert(
          "Google Calendar connected",
          "Your chapter's events and your tasks show up there within a minute.",
        ),
      )
      .catch((error: unknown) =>
        Alert.alert(
          "Google Calendar wasn't connected",
          errorCopy(error, GOOGLE_CALENDAR_RETURN_COPY.failed, {
            serverWritesForMembers: true,
          }),
        ),
      );
  }

  useEffect(() => {
    if (returnUrl) finish(returnUrl);
    // finish reads only module state and stable mutations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnUrl]);

  async function connect() {
    const back = Linking.createURL(returnPath);
    beforeOpen?.();
    try {
      const url = await start.mutateAsync({
        client: "mobile",
        returnUrl: back,
      });
      const result = await WebBrowser.openAuthSessionAsync(url, back);
      if (result.type === "success") finish(result.url);
    } catch (error) {
      Alert.alert(
        "Couldn't open Google",
        errorCopy(error, "Try again in a moment."),
      );
    }
  }

  function confirmDisconnect() {
    const copy = googleCalendarDisconnectCopy(status.data?.google_email);
    Alert.alert(copy.title, copy.description, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: () =>
          void disconnectMutation
            .mutateAsync()
            .catch((error: unknown) =>
              Alert.alert(
                "Couldn't disconnect",
                errorCopy(error, "Try again in a moment."),
              ),
            ),
      },
    ]);
  }

  return {
    status,
    connect,
    confirmDisconnect,
    connecting: start.isPending,
    disconnecting: disconnectMutation.isPending,
  };
}
