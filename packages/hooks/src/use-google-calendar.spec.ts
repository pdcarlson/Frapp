import { describe, expect, it } from "vitest";
import {
  GOOGLE_CALENDAR_RETURN_COPY,
  googleCalendarDisconnectCopy,
  googleCalendarFootnote,
  readGoogleCalendarReturn,
} from "./use-google-calendar";

const read = (query: string) =>
  readGoogleCalendarReturn(new URLSearchParams(query));

describe("readGoogleCalendarReturn", () => {
  it("reads a sign-in to finish, with its code and state", () => {
    expect(read("gcal=confirm&gcal_code=c1&gcal_state=s1")).toEqual({
      kind: "confirm",
      code: "c1",
      state: "s1",
    });
  });

  it("reads a cancel and an expired sign-in", () => {
    expect(read("gcal=denied")).toEqual({ kind: "denied" });
    expect(read("gcal=expired")).toEqual({ kind: "expired" });
  });

  it("reads a confirm missing its code, or anything unknown, as failed", () => {
    expect(read("gcal=confirm&gcal_state=s1")).toEqual({ kind: "failed" });
    expect(read("gcal=weird")).toEqual({ kind: "failed" });
  });

  it("reads nothing when the URL carries no return", () => {
    expect(read("event=1")).toBeNull();
  });
});

// #4676: the web menu and the phone sheet both read these; pinned so a change
// is made here, once, and both clients' specs compare against it.
describe("Google Calendar copy", () => {
  it("words each unfinished return", () => {
    expect(GOOGLE_CALENDAR_RETURN_COPY).toEqual({
      denied: "Google Calendar wasn't connected.",
      expired: "That Google sign-in expired. Connect Google Calendar again.",
      failed:
        "Google didn't finish the sign-in. Connect Google Calendar again.",
    });
  });

  it("words the footnote by connection state", () => {
    expect(
      googleCalendarFootnote({ connected: true, google_email: "m@gmail.com" }),
    ).toBe(
      "Google Calendar is connected as m@gmail.com and updates within minutes. Other calendar apps check on their own schedule.",
    );
    expect(
      googleCalendarFootnote({ connected: false, google_email: null }),
    ).toBe(
      "Google Calendar updates within minutes once connected. Other calendar apps check on their own schedule.",
    );
    expect(googleCalendarFootnote(null)).toBe(
      "Your calendar app checks for changes on its own schedule. Google Calendar can take several hours.",
    );
  });

  it("names the account in the Disconnect confirm when it's known", () => {
    expect(googleCalendarDisconnectCopy("m@gmail.com")).toEqual({
      title: "Disconnect Google Calendar?",
      description:
        "Frapp's calendar is removed from your Google account (m@gmail.com). Your other calendars aren't touched.",
    });
    expect(googleCalendarDisconnectCopy(null).description).toBe(
      "Frapp's calendar is removed from your Google account. Your other calendars aren't touched.",
    );
  });
});
