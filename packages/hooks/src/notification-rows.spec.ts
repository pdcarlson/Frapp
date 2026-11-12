import { describe, expect, it } from "vitest";
import {
  isTileKind,
  notificationLook,
  notificationPreview,
  titleAroundName,
} from "./notification-rows";

const MEMBERS = [
  { user_id: "me", display_name: "Marcus Ellison" },
  { user_id: "ryan", display_name: "Ryan Castellano" },
  { user_id: "devin", display_name: "Devin Okafor" },
];
const VIEWER = { viewerId: "me", members: MEMBERS };

const chat = (data: Record<string, unknown>, body = "hello") => ({
  title: "Ryan Castellano in #general",
  body,
  data: {
    target: { screen: "chat", channelId: "c1" },
    senderId: "ryan",
    ...data,
  },
});

describe("notificationLook", () => {
  it("reads a chat row's kind and sender from its data", () => {
    expect(notificationLook(chat({ chatKind: "dm" }), VIEWER)).toEqual({
      kind: "dm",
      personId: "ryan",
      mentioned: false,
    });
    expect(
      notificationLook(chat({ chatKind: "announcement" }), VIEWER).kind,
    ).toBe("announcement");
  });

  it("draws a row that mentions the viewer as a mention, whatever its conversation", () => {
    expect(
      notificationLook(chat({ chatKind: "channel", mentioned: true }), VIEWER),
    ).toEqual({ kind: "mention", personId: "ryan", mentioned: true });
  });

  it("trusts the API's answer over the body once a row carries one", () => {
    // A row written since #4346 says whether it mentioned the viewer, so a
    // body naming them (a quote, a code span) doesn't override it.
    const row = chat({ chatKind: "channel" }, "@Marcus Ellison can you cover?");
    expect(notificationLook(row, VIEWER).mentioned).toBe(false);
  });

  it("finds a name mention in the body of a row written before #4346", () => {
    const row = chat({}, "@Marcus Ellison @Devin Okafor can you cover?");
    expect(notificationLook(row, VIEWER)).toEqual({
      kind: "mention",
      personId: "ryan",
      mentioned: true,
    });
    expect(
      notificationLook(chat({}, "@Devin Okafor can you?"), VIEWER).kind,
    ).toBe("chat");
    // Without a roster yet, nothing is guessed.
    expect(
      notificationLook(row, { viewerId: "me", members: null }).mentioned,
    ).toBe(false);
  });

  it("draws a join as the member who joined", () => {
    const look = notificationLook(
      {
        title: "Owen Delacroix joined",
        body: "New member of the chapter",
        data: { target: { screen: "members" }, memberUserId: "owen" },
      },
      VIEWER,
    );
    expect(look).toEqual({ kind: "join", personId: "owen", mentioned: false });
  });

  it("draws a notice no person is behind as its screen's tile", () => {
    const tile = (screen: string) =>
      notificationLook(
        { title: "t", body: null, data: { target: { screen } } },
        VIEWER,
      );
    expect(tile("tasks")).toEqual({
      kind: "tasks",
      personId: null,
      mentioned: false,
    });
    expect(tile("events").kind).toBe("events");
    expect(tile("billing").kind).toBe("billing");
    expect(tile("chat_reports").kind).toBe("reports");
    expect(tile("something-new").kind).toBe("other");
    expect(
      notificationLook({ title: "t", body: null, data: null }, VIEWER).kind,
    ).toBe("other");
    expect(isTileKind("tasks")).toBe(true);
    expect(isTileKind("join")).toBe(false);
  });
});

describe("titleAroundName", () => {
  it("splits the title around the person's name", () => {
    expect(
      titleAroundName("Ryan Castellano in #general", "Ryan Castellano"),
    ).toEqual({
      before: "",
      name: "Ryan Castellano",
      after: " in #general",
    });
    expect(
      titleAroundName("Announcement from Aaron Whitfield", "Aaron Whitfield"),
    ).toEqual({
      before: "Announcement from ",
      name: "Aaron Whitfield",
      after: "",
    });
  });

  it("gives up when the name isn't in the title", () => {
    expect(titleAroundName("New Message", "Ryan Castellano")).toBeNull();
    expect(titleAroundName("Ryan in #general", null)).toBeNull();
  });
});

describe("notificationPreview", () => {
  it("chips @-names that resolve to a member, spaces included, and leaves the rest as text", () => {
    expect(
      notificationPreview("@Marcus Ellison @bigsigma can you cover?", MEMBERS),
    ).toEqual([
      { text: "@Marcus Ellison", mention: true },
      { text: " @bigsigma can you cover?", mention: false },
    ]);
  });

  it("drops U+FFFC, the OBJ box", () => {
    expect(notificationPreview("take a look ￼", MEMBERS)).toEqual([
      { text: "take a look", mention: false },
    ]);
    expect(notificationPreview("￼", MEMBERS)).toEqual([]);
  });

  it("chips nothing before the roster has loaded", () => {
    expect(notificationPreview("@Marcus Ellison hi", null)).toEqual([
      { text: "@Marcus Ellison hi", mention: false },
    ]);
  });
});
