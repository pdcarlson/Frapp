import { describe, expect, it } from "vitest";
import {
  asNewChannel,
  defaultChoice,
  defaultChoices,
  mappingIssues,
  normaliseChannelName,
  restageChoices,
} from "./mapping-issues";

const open = (id: string, name: string, category: string | null = null) => ({
  channelId: id,
  channelName: name,
  category,
  readable: true,
  privateInDiscord: false,
});

describe("defaultChoice", () => {
  it("starts a readable channel as a new channel with its Discord name, readable by the chapter", () => {
    expect(defaultChoice(open("1", "memes"))).toEqual({
      action: "create_new",
      newName: "memes",
      visibility: "chapter",
    });
  });

  it("leaves a private channel's visibility unchosen, never public by default", () => {
    expect(
      defaultChoice({ ...open("1", "cabinet"), privateInDiscord: true }),
    ).toEqual({
      action: "create_new",
      newName: "cabinet",
      visibility: undefined,
    });
  });

  it("skips a channel the bot cannot read", () => {
    expect(defaultChoice({ ...open("1", "jboard"), readable: false })).toEqual({
      action: "skip",
    });
  });

  it("treats privacy the scan could not read as private, not public", () => {
    // The roles read that answers "private?" can fail on its own; the API
    // refuses the default for the same channel.
    expect(
      defaultChoice({ ...open("1", "exec"), privateInDiscord: null }),
    ).toMatchObject({ action: "create_new", visibility: undefined });
  });

  it("asks about a public channel that holds a private thread, since the thread lands in it", () => {
    expect(
      defaultChoice({ ...open("1", "general"), privateThreads: 2 }),
    ).toMatchObject({ visibility: undefined });
  });

  it("asks about every channel of an uploaded export, which says nothing about privacy", () => {
    const exported = { channelId: "1", channelName: "general", category: null };
    expect(defaultChoice(exported)).toMatchObject({
      action: "create_new",
      visibility: undefined,
    });
    expect(
      mappingIssues([exported], defaultChoices([exported]), []).map(
        (issue) => issue.message,
      ),
    ).toEqual([
      "An export does not say whether #general was private in Discord. Choose who can read it in Frapp.",
    ]);
  });
});

describe("mappingIssues", () => {
  const channels = [open("1", "memes"), open("2", "links"), open("3", "rush")];

  it("finds nothing to fix in the defaults when no name clashes", () => {
    expect(mappingIssues(channels, defaultChoices(channels), [])).toEqual([]);
  });

  it("flags a clash with an existing Frapp channel, ignoring case and a leading #", () => {
    const issues = mappingIssues(channels, defaultChoices(channels), [
      "#Memes",
    ]);
    expect(issues).toEqual([
      {
        channelId: "1",
        message: expect.stringContaining("#memes already exists in Frapp"),
      },
    ]);
  });

  it("flags two channels given the same new name", () => {
    const choices = defaultChoices(channels);
    choices["2"] = { ...choices["2"]!, newName: "MEMES" };
    const issues = mappingIssues(channels, choices, []);
    expect(issues.map((issue) => issue.channelId)).toEqual(["1", "2"]);
    expect(issues[0]!.message).toContain("is the new name for 2 channels");
  });

  it("flags an empty name, a merge with no target, and a restricted channel with no permission", () => {
    const choices = defaultChoices(channels);
    choices["1"] = { ...choices["1"]!, newName: "  " };
    choices["2"] = { action: "use_existing" };
    choices["3"] = {
      action: "create_new",
      newName: "rush",
      visibility: "restricted",
      requiredPermissions: [],
    };
    expect(
      mappingIssues(channels, choices, []).map((issue) => issue.message),
    ).toEqual([
      "Name the new channel for #memes.",
      "Pick the Frapp channel to merge #links into.",
      "Choose who can read the new channel for #rush.",
    ]);
  });

  it("flags a private channel until its visibility is chosen", () => {
    const cabinet = { ...open("9", "cabinet"), privateInDiscord: true };
    const choices = defaultChoices([cabinet]);
    expect(mappingIssues([cabinet], choices, [])).toEqual([
      {
        channelId: "9",
        message:
          "#cabinet was private in Discord. Choose who can read it in Frapp.",
      },
    ]);
    choices["9"] = { ...choices["9"]!, visibility: "chapter" };
    expect(mappingIssues([cabinet], choices, [])).toEqual([]);
  });

  it("says why a channel needs its visibility chosen", () => {
    const unknown = { ...open("7", "exec"), privateInDiscord: null };
    const threaded = { ...open("8", "general"), privateThreads: 1 };
    expect(
      mappingIssues(
        [unknown, threaded],
        defaultChoices([unknown, threaded]),
        [],
      ).map((issue) => issue.message),
    ).toEqual([
      "Frapp could not tell whether #exec was private in Discord. Choose who can read it in Frapp.",
      "#general holds 1 private thread in Discord, which will land in it. Choose who can read it in Frapp.",
    ]);
  });

  it("does not count a skipped or unreadable channel as a problem, but refuses to import nothing", () => {
    const skipped = { "1": { action: "skip" as const } };
    expect(mappingIssues([open("1", "memes")], skipped, ["memes"])).toEqual([
      {
        channelId: null,
        message: "Every channel is skipped. Choose at least one to import.",
      },
    ]);
  });
});

describe("asNewChannel", () => {
  it("turns a skip into the same new channel the default would have made", () => {
    expect(asNewChannel({ action: "skip" }, open("1", "memes"))).toEqual({
      action: "create_new",
      newName: "memes",
      visibility: "chapter",
    });
    // Never a whole-chapter default for a channel that was private.
    expect(
      asNewChannel(
        { action: "skip" },
        { ...open("2", "cabinet"), privateInDiscord: true },
      ),
    ).toMatchObject({ action: "create_new", visibility: undefined });
  });

  it("keeps what the admin already set", () => {
    expect(
      asNewChannel(
        {
          action: "use_existing",
          newName: "renamed",
          visibility: "restricted",
          requiredPermissions: ["cabinet:read"],
        },
        open("1", "memes"),
      ),
    ).toMatchObject({
      action: "create_new",
      newName: "renamed",
      visibility: "restricted",
      requiredPermissions: ["cabinet:read"],
    });
  });
});

describe("restageChoices", () => {
  it("keeps a decision while the facts it was made under still hold", () => {
    const before = [open("1", "memes")];
    const choices = {
      "1": {
        action: "create_new" as const,
        newName: "dank",
        visibility: "chapter" as const,
      },
    };
    expect(restageChoices(before, choices, [open("1", "memes")])).toEqual(
      choices,
    );
  });

  it("starts a channel the bot can now read at its default, not at the skip it was forced into", () => {
    const hidden = {
      ...open("1", "exec"),
      readable: false,
      privateInDiscord: true,
    };
    const choices = defaultChoices([hidden]);
    expect(choices["1"]).toEqual({ action: "skip" });
    const visible = { ...hidden, readable: true };
    expect(restageChoices([hidden], choices, [visible])["1"]).toEqual({
      action: "create_new",
      newName: "exec",
      visibility: undefined,
    });
  });

  it("skips a channel the bot can no longer read, whatever was chosen", () => {
    const choices = defaultChoices([open("1", "memes")]);
    expect(
      restageChoices([open("1", "memes")], choices, [
        { ...open("1", "memes"), readable: false },
      ])["1"],
    ).toEqual({ action: "skip" });
  });

  it("asks again about a whole-chapter channel that turned out to be private", () => {
    // The default (or the admin) chose "whole chapter" for a channel that
    // looked public. Sent as-is, the API would take it as a real choice.
    const first = [
      { ...open("1", "exec"), privateInDiscord: false },
      { ...open("2", "rush"), privateInDiscord: null },
    ];
    const choices = defaultChoices(first);
    choices["2"] = { ...choices["2"]!, visibility: "chapter" };
    const second = [
      { ...open("1", "exec"), privateInDiscord: true },
      { ...open("2", "rush"), privateInDiscord: true },
    ];
    const next = restageChoices(first, choices, second);
    expect(next["1"]).toMatchObject({ newName: "exec", visibility: undefined });
    expect(next["2"]).toMatchObject({ visibility: undefined });
  });

  it("gives a channel whose privacy was unknown the whole-chapter default once the scan sees it is public", () => {
    // The first scan's roles read failed; the second worked.
    const first = [
      { ...open("1", "memes"), privateInDiscord: null },
      { ...open("2", "links"), privateInDiscord: null },
    ];
    const choices = defaultChoices(first);
    choices["2"] = { ...choices["2"]!, newName: "resources" };
    const second = [open("1", "memes"), open("2", "links")];
    const next = restageChoices(first, choices, second);
    expect(next["1"]).toMatchObject({ visibility: "chapter" });
    // The rename was a decision, and survives.
    expect(next["2"]).toMatchObject({
      newName: "resources",
      visibility: "chapter",
    });
    expect(mappingIssues(second, next, [])).toEqual([]);
  });

  it("asks again about a merge whose channel turned out to be private", () => {
    const first = [open("1", "exec")];
    const choices = {
      "1": {
        action: "use_existing" as const,
        targetChannelId: "frapp-general",
      },
    };
    const next = restageChoices(first, choices, [
      { ...open("1", "exec"), privateThreads: 1 },
    ]);
    expect(next["1"]).toMatchObject({
      action: "create_new",
      visibility: undefined,
    });
    // A merge made for a channel that is still public is kept.
    expect(restageChoices(first, choices, [open("1", "exec")])).toEqual(
      choices,
    );
  });

  it("keeps a restricted choice when the channel turns out private, since it is already safe", () => {
    const first = [open("1", "exec")];
    const choices = {
      "1": {
        action: "create_new" as const,
        newName: "exec",
        visibility: "restricted" as const,
        requiredPermissions: ["cabinet:read"],
      },
    };
    expect(
      restageChoices(first, choices, [
        { ...open("1", "exec"), privateInDiscord: true },
      ]),
    ).toEqual(choices);
  });
});

describe("normaliseChannelName", () => {
  it("compares names the way an admin reads them", () => {
    expect(normaliseChannelName("  #General ")).toBe("general");
    expect(normaliseChannelName("##x")).toBe("x");
  });
});
