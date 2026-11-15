import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_BADGE,
  groupNotificationsBySource,
  isTileKind,
  notificationConversation,
  notificationEntryCount,
  notificationLook,
  notificationPreview,
  notificationTitle,
  notificationWhen,
  titleAroundName,
} from "./notification-rows";

const MEMBERS = [
  { user_id: "me", display_name: "Marcus Ellison" },
  { user_id: "ryan", display_name: "Ryan Castellano" },
  { user_id: "devin", display_name: "Devin Okafor" },
];

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
    expect(notificationLook(chat({ chatKind: "dm" }))).toEqual({
      kind: "dm",
      personId: "ryan",
      mentioned: false,
    });
    expect(notificationLook(chat({ chatKind: "announcement" })).kind).toBe(
      "announcement",
    );
  });

  it("draws a row that mentions the viewer as a mention, whatever its conversation", () => {
    expect(
      notificationLook(chat({ chatKind: "channel", mentioned: true })),
    ).toEqual({ kind: "mention", personId: "ryan", mentioned: true });
  });

  it("takes the mention from the server alone, never the body re-read", () => {
    // components.md § A row that mentions you: "The list is the server's".
    // A row written before #4346 doesn't say, so it is a plain message even
    // when its body names the viewer.
    const old = chat({}, "@Marcus Ellison @Devin Okafor can you cover?");
    expect(notificationLook(old)).toEqual({
      kind: "chat",
      personId: "ryan",
      mentioned: false,
    });
    const said = chat(
      { chatKind: "channel" },
      "@Marcus Ellison can you cover?",
    );
    expect(notificationLook(said).mentioned).toBe(false);
  });

  it("draws the system sender as a notice, not an unknown person", () => {
    const row = chat({ senderId: "00000000-0000-0000-0000-000000000000" });
    expect(notificationLook(row)).toEqual({
      kind: "other",
      personId: null,
      mentioned: false,
    });
  });

  it("draws a join as the member who joined", () => {
    const look = notificationLook({
      title: "Owen Delacroix joined",
      body: "New member of the chapter",
      data: { target: { screen: "members" }, memberUserId: "owen" },
    });
    expect(look).toEqual({ kind: "join", personId: "owen", mentioned: false });
  });

  it("draws a notice no person is behind as its screen's tile", () => {
    const tile = (screen: string) =>
      notificationLook({
        title: "t",
        body: null,
        data: { target: { screen } },
      });
    expect(tile("tasks")).toEqual({
      kind: "tasks",
      personId: null,
      mentioned: false,
    });
    expect(tile("events").kind).toBe("events");
    expect(tile("billing").kind).toBe("billing");
    expect(tile("chat_reports").kind).toBe("reports");
    expect(tile("something-new").kind).toBe("other");
    expect(notificationLook({ title: "t", body: null, data: null }).kind).toBe(
      "other",
    );
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

  it("looks only where the server puts the name, so 'Ann' never lights 'Announcement'", () => {
    expect(titleAroundName("Announcement from Ann", "Ann")).toEqual({
      before: "Announcement from ",
      name: "Ann",
      after: "",
    });
    expect(titleAroundName("Big news from Ann's team", "Ann")).toBeNull();
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

describe("notificationTitle", () => {
  it("drops U+FFFC from a title, which carries typed text too (a task's, an event's)", () => {
    expect(notificationTitle("Book the venue \uFFFC")).toBe("Book the venue");
  });
});

describe("notificationWhen", () => {
  const NOW = new Date(2026, 7, 17, 20);
  it("shows a clock time today, a weekday this week, and a date before that", () => {
    const today = notificationWhen(new Date(2026, 7, 17, 9).toISOString(), NOW);
    expect(today?.isToday).toBe(true);
    expect(today?.time).toMatch(/9:00/);
    const week = notificationWhen(new Date(2026, 7, 15, 9).toISOString(), NOW);
    expect(week).toEqual({
      isToday: false,
      time: new Date(2026, 7, 15).toLocaleDateString(undefined, {
        weekday: "short",
      }),
    });
    const older = notificationWhen(new Date(2026, 6, 1, 9).toISOString(), NOW);
    expect(older?.time).toBe(
      new Date(2026, 6, 1).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    );
  });

  it("drops a timestamp that doesn't parse", () => {
    expect(notificationWhen("not a date", NOW)).toBeNull();
  });
});

describe("groupNotificationsBySource (#3948)", () => {
  type Row = { id: string; data: unknown; unread: boolean };
  const row = (id: string, data: unknown, unread = true): Row => ({
    id,
    data,
    unread,
  });
  const inChannel = (
    channelId: string,
    extra: Record<string, unknown> = {},
  ) => ({
    target: { screen: "chat", channelId },
    senderId: "ryan",
    ...extra,
  });
  const isUnread = (r: Row) => r.unread;

  it("collapses one channel's rows into its newest", () => {
    const entries = groupNotificationsBySource(
      [
        row("a", inChannel("c1")),
        row("b", { target: { screen: "events" } }),
        row("c", inChannel("c1"), false),
        row("d", inChannel("c2")),
        row("e", inChannel("c1")),
      ],
      { isUnread },
    );
    expect(entries.map((e) => e.key)).toEqual(["chat:c1", "b", "chat:c2"]);
    expect(entries[0]).toMatchObject({
      lead: { id: "a" },
      messageCount: 3,
      bundled: false,
      unreadIds: ["a", "e"],
    });
    expect(entries[0]!.rows.map((r) => r.id)).toEqual(["a", "c", "e"]);
    expect(notificationEntryCount(entries[0]!)).toBe("3 messages");
    expect(notificationEntryCount(entries[1]!)).toBeNull();
  });

  it("counts a bundled burst as a floor, not on top of the rows it covers", () => {
    // burst-bundler: messages 1 and 2 push a row each, message 3 pushes a
    // bundle of 3 that covers them, and later messages write no row.
    const bundle = (id: string, sender: string, count: number) =>
      row(id, inChannel("c1", { senderId: sender, bundled: true, count }));
    const single = (id: string, sender: string) =>
      row(id, inChannel("c1", { senderId: sender }));
    const [ryan] = groupNotificationsBySource(
      [bundle("r3", "ryan", 3), single("r2", "ryan"), single("r1", "ryan")],
      { isUnread },
    );
    expect(ryan!.messageCount).toBe(3);
    expect(notificationEntryCount(ryan!)).toBe("3+ messages");

    const [two] = groupNotificationsBySource(
      [single("d1", "devin"), bundle("r3", "ryan", 3), single("r1", "ryan")],
      { isUnread },
    );
    expect(two!.messageCount).toBe(4);

    // A bundle on its own already says "3 new messages": no second count.
    const [alone] = groupNotificationsBySource([bundle("r3", "ryan", 3)], {
      isUnread,
    });
    expect(notificationEntryCount(alone!)).toBeNull();
  });

  it("keeps a mention on its own and a thread apart from its channel", () => {
    const entries = groupNotificationsBySource(
      [
        row("a", inChannel("c1", { mentioned: true })),
        row("b", inChannel("c1")),
        row("c", {
          target: { screen: "chat", channelId: "c1", threadRootId: "m1" },
        }),
        row("d", inChannel("c1", { mentioned: true })),
      ],
      { isUnread },
    );
    expect(entries.map((e) => e.key)).toEqual([
      "a",
      "chat:c1",
      "chat:c1:thread:m1",
      "d",
    ]);
  });

  it("never groups rows that aren't chat", () => {
    const entries = groupNotificationsBySource(
      [
        row("a", { target: { screen: "events" } }),
        row("b", { target: { screen: "events" } }),
        row("c", null),
      ],
      { isUnread },
    );
    expect(entries).toHaveLength(3);
  });

  it("under unread, drops read rows before grouping", () => {
    const entries = groupNotificationsBySource(
      [
        row("a", inChannel("c1"), false),
        row("b", inChannel("c1")),
        row("c", { target: { screen: "events" } }, false),
      ],
      { isUnread, filter: "unread" },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ lead: { id: "b" }, messageCount: 1 });
  });
});

describe("notificationConversation (#3948)", () => {
  it("names a channel's or a thread's conversation, and nothing for a row on its own", () => {
    const chat = (target: Record<string, unknown>, extra = {}) => ({
      target: { screen: "chat", channelId: "c1", ...target },
      ...extra,
    });
    expect(notificationConversation(chat({}))).toEqual({ channelId: "c1" });
    expect(notificationConversation(chat({ threadRootId: "m1" }))).toEqual({
      channelId: "c1",
      threadRootId: "m1",
    });
    expect(notificationConversation(chat({}, { mentioned: true }))).toBeNull();
    expect(
      notificationConversation({ target: { screen: "events" } }),
    ).toBeNull();
    expect(notificationConversation(null)).toBeNull();
  });
});

describe("NOTIFICATION_BADGE (#4476)", () => {
  it("gives each person kind one badge, read by web and the phone", () => {
    expect(NOTIFICATION_BADGE.mention).toEqual({ mark: "@" });
    expect(NOTIFICATION_BADGE.channel).toEqual({ mark: "#" });
    expect(NOTIFICATION_BADGE.join).toEqual({ mark: "+" });
    expect(NOTIFICATION_BADGE.announcement).toEqual({ announcement: true });
    // A DM wears Direct messages' glyph on both clients; until #4476 the
    // phone drew the chat bubble for it.
    expect(NOTIFICATION_BADGE.dm).toEqual({ glyph: "direct" });
    expect(NOTIFICATION_BADGE.chat).toEqual({ glyph: "chat" });
    // Every person kind has one, and no tile kind does.
    for (const kind of Object.keys(NOTIFICATION_BADGE)) {
      expect(isTileKind(kind as never)).toBe(false);
    }
  });
});
