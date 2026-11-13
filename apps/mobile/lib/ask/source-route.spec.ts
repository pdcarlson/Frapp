import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskSource } from "@repo/validation";

const betaOff = vi.hoisted(() => ({ keys: ["dues"] as string[] }));
vi.mock("@repo/validation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/validation")>()),
  isBetaOffModule: (key: string) => betaOff.keys.includes(key),
}));

import { askSourceOpening } from "./source-route";

function source(target: AskSource["target"]): AskSource {
  return {
    id: "s1",
    kind: "document",
    title: "Bylaws",
    detail: null,
    date: null,
    target,
  };
}

afterEach(() => {
  betaOff.keys = ["dues"];
});

describe("askSourceOpening", () => {
  it("opens a document as a document, not a route", () => {
    expect(
      askSourceOpening(source({ type: "document", document_id: "d1", page: 3 })),
    ).toEqual({ kind: "document", documentId: "d1" });
  });

  it("opens minutes on the minutes screen", () => {
    expect(
      askSourceOpening(source({ type: "meeting", meeting_id: "m1" })),
    ).toEqual({
      kind: "route",
      target: { pathname: "/minutes-details", params: { id: "m1" } },
    });
  });

  it("opens a channel message's channel", () => {
    expect(
      askSourceOpening(
        source({ type: "message", channel_id: "c1", message_id: "x1" }),
      ),
    ).toEqual({
      kind: "route",
      target: { pathname: "/chat-thread", params: { channelId: "c1" } },
    });
  });

  it.each([
    ["members", "/directory"],
    ["events", "/events"],
    ["points", "/tasks"],
    ["tasks", "/tasks"],
  ])("opens live %s data on its screen", (page, pathname) => {
    expect(askSourceOpening(source({ type: "page", page }))).toEqual({
      kind: "route",
      target: { pathname },
    });
  });

  it("has no link to Dues while Dues is off for the beta", () => {
    expect(askSourceOpening(source({ type: "page", page: "dues" }))).toBeNull();
    betaOff.keys = [];
    expect(askSourceOpening(source({ type: "page", page: "dues" }))).toEqual({
      kind: "route",
      target: { pathname: "/dues" },
    });
  });

  it("has no link for what this build can't open", () => {
    expect(askSourceOpening(source(null))).toBeNull();
    // A target a newer server added.
    expect(askSourceOpening(source({ type: "poll", poll_id: "p1" }))).toBeNull();
    // A known target missing its id.
    expect(askSourceOpening(source({ type: "meeting" }))).toBeNull();
    expect(askSourceOpening(source({ type: "page", page: "vault" }))).toBeNull();
  });
});
