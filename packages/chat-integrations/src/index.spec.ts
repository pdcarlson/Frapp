import { describe, expect, it } from "vitest";
import {
  filterSlashCommands,
  getSlashCommand,
  parseNumericArg,
  parseSlashInput,
  SLASH_COMMANDS,
} from "./index";

describe("getSlashCommand", () => {
  it("finds a known command by exact name", () => {
    expect(getSlashCommand("event")?.name).toBe("event");
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(getSlashCommand("  EVENT  ")?.name).toBe("event");
  });

  it("returns undefined for an unknown name", () => {
    expect(getSlashCommand("nope")).toBeUndefined();
  });
});

describe("filterSlashCommands", () => {
  const allEnabled = () => true;
  const noneEnabled = () => false;

  it("returns every command, unmodified, for an empty query when all modules are enabled", () => {
    const result = filterSlashCommands("", allEnabled);
    expect(result).toEqual(SLASH_COMMANDS);
  });

  it("excludes commands whose required module is disabled", () => {
    const result = filterSlashCommands("", (moduleKey) => moduleKey !== "events");
    expect(result.some((command) => command.name === "event")).toBe(false);
    // announce has no requiredModule, so it survives every module gate.
    expect(result.some((command) => command.name === "announce")).toBe(true);
  });

  it("always includes commands with a null requiredModule regardless of gating", () => {
    const result = filterSlashCommands("", noneEnabled);
    expect(result.every((command) => command.requiredModule === null)).toBe(true);
    expect(result.some((command) => command.name === "announce")).toBe(true);
  });

  it("matches by name prefix/substring", () => {
    const result = filterSlashCommands("poi", allEnabled);
    expect(result.map((command) => command.name)).toEqual(["points"]);
  });

  it("matches by description substring", () => {
    const result = filterSlashCommands("interactive card", allEnabled);
    expect(result.map((command) => command.name)).toEqual(["event"]);
  });

  it("is case-insensitive and trims the query", () => {
    const result = filterSlashCommands("  EVENT  ", allEnabled);
    expect(result.map((command) => command.name)).toEqual(["event"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterSlashCommands("zzz-no-match", allEnabled)).toEqual([]);
  });

  it("applies module gating before the query filter, not instead of it", () => {
    // "event" matches the query but its module is disabled.
    const result = filterSlashCommands("event", (moduleKey) => moduleKey !== "events");
    expect(result).toEqual([]);
  });
});

describe("parseSlashInput", () => {
  it("parses a command with arguments", () => {
    expect(parseSlashInput("/event Formal 8pm")).toEqual({
      isSlash: true,
      command: "event",
      args: "Formal 8pm",
      raw: "/event Formal 8pm",
    });
  });

  it("parses a bare command with no arguments", () => {
    expect(parseSlashInput("/announce")).toEqual({
      isSlash: true,
      command: "announce",
      args: "",
      raw: "/announce",
    });
  });

  it("lowercases the command token", () => {
    expect(parseSlashInput("/EVENT foo").command).toBe("event");
  });

  it("treats a lone slash as an open palette with no command", () => {
    expect(parseSlashInput("/")).toEqual({
      isSlash: true,
      command: null,
      args: "",
      raw: "/",
    });
  });

  it("treats a digit-led token as no command (SLASH_PATTERN requires a leading letter), falling back to the rest as args", () => {
    expect(parseSlashInput("/123abc")).toEqual({
      isSlash: true,
      command: null,
      args: "123abc",
      raw: "/123abc",
    });
  });

  it("treats plain text as non-slash input", () => {
    expect(parseSlashInput("hello world")).toEqual({
      isSlash: false,
      command: null,
      args: "hello world",
      raw: "hello world",
    });
  });

  it("treats empty input as non-slash input", () => {
    expect(parseSlashInput("")).toEqual({
      isSlash: false,
      command: null,
      args: "",
      raw: "",
    });
  });

  it("trims surrounding whitespace from the argument string", () => {
    expect(parseSlashInput("/poll   question   opt1 opt2   ").args).toBe(
      "question   opt1 opt2",
    );
  });
});

describe("parseNumericArg", () => {
  it("parses a plain integer", () => {
    expect(parseNumericArg("5")).toBe(5);
  });

  it("parses a negative number", () => {
    expect(parseNumericArg("-3")).toBe(-3);
  });

  it("parses a decimal", () => {
    expect(parseNumericArg("2.5")).toBe(2.5);
  });

  it("trims surrounding whitespace", () => {
    expect(parseNumericArg("  7  ")).toBe(7);
  });

  it("returns null for non-numeric input", () => {
    expect(parseNumericArg("abc")).toBeNull();
  });

  it("returns null for an empty or whitespace-only string", () => {
    expect(parseNumericArg("")).toBeNull();
    expect(parseNumericArg("   ")).toBeNull();
  });

  it("returns null for undefined and null input", () => {
    expect(parseNumericArg(undefined)).toBeNull();
    expect(parseNumericArg(null)).toBeNull();
  });

  it("returns null for non-finite numeric strings", () => {
    expect(parseNumericArg("Infinity")).toBeNull();
    expect(parseNumericArg("NaN")).toBeNull();
  });
});
