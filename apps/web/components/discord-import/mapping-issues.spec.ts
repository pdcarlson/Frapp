import { describe, expect, it } from "vitest";
import {
  defaultChoice,
  defaultChoices,
  mappingIssues,
  normaliseChannelName,
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

  it("treats an upload's unknown privacy as public, which the step says out loud", () => {
    expect(
      defaultChoice({ channelId: "1", channelName: "general", category: null }),
    ).toMatchObject({ visibility: "chapter" });
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

describe("normaliseChannelName", () => {
  it("compares names the way an admin reads them", () => {
    expect(normaliseChannelName("  #General ")).toBe("general");
    expect(normaliseChannelName("##x")).toBe("x");
  });
});
