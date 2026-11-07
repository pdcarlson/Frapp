import * as Sentry from "@sentry/react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  channelsErrorCopy,
  reportChannelsRefused,
  resetChannelsRefusedReport,
} from "./channels-error";

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("channelsErrorCopy", () => {
  it("names the role and the officer for a 403, with the chapter's name", () => {
    const copy = channelsErrorCopy(httpError(403), "Phi Gamma Delta");
    expect(copy.title).toBe("Chat isn't open to you yet");
    expect(copy.body).toBe(
      "Your role in Phi Gamma Delta doesn't include chat. Ask an officer to give you the Member role, then pull down to refresh.",
    );
  });

  it("falls back to 'this chapter' when the name hasn't loaded", () => {
    expect(channelsErrorCopy(httpError(403), null).body).toContain(
      "Your role in this chapter",
    );
  });

  it("keeps the network copy for anything else", () => {
    for (const error of [httpError(500), new Error("fetch failed")]) {
      expect(channelsErrorCopy(error, "X")).toEqual({
        title: "Couldn't load channels",
        body: "Chat couldn't reach the server.",
      });
    }
  });
});

describe("reportChannelsRefused", () => {
  beforeEach(() => {
    resetChannelsRefusedReport();
    vi.mocked(Sentry.captureMessage).mockClear();
  });

  it("reports a 403 once per run, as one grouped warning", () => {
    reportChannelsRefused(httpError(403));
    reportChannelsRefused(httpError(403));
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "Chat home: channel list refused (403)",
      expect.objectContaining({
        level: "warning",
        fingerprint: ["chat-home-channels-refused"],
      }),
    );
  });

  it("leaves other failures to the shared query-error reporter", () => {
    reportChannelsRefused(httpError(500));
    reportChannelsRefused(new Error("fetch failed"));
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
