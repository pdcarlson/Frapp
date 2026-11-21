import { describe, expect, it } from "vitest";

import { parseAskStreamEvent, type AskStreamEvent } from "./ask";
import {
  askStepChips,
  askStepFoundLine,
  askStepKind,
  askStepKinds,
  askStepLabel,
  askStepPast,
  askStepsOn,
  askStepSpoken,
  askStepsSummary,
  type AskWorkStep,
} from "./ask-steps";

const status = (
  fields: Omit<Extract<AskStreamEvent, { type: "status" }>, "v" | "type">,
): AskStreamEvent => ({ v: 1, type: "status", ...fields });

const ended = (
  fields: Omit<Extract<AskStreamEvent, { type: "step" }>, "v" | "type">,
): AskStreamEvent => ({ v: 1, type: "step", ...fields });

const play = (events: AskStreamEvent[]) =>
  events.reduce<AskWorkStep[]>((steps, event) => askStepsOn(steps, event), []);

const DONE: AskStreamEvent = {
  v: 1,
  type: "done",
  answer: {
    status: "answered",
    text: "x",
    citations: [],
    sources: [],
    left_out_messages: 0,
  },
} as AskStreamEvent;

describe("askStepsOn: the tool loop (#5427)", () => {
  const slow = [
    status({ step: "searching" }),
    status({
      step: "reading",
      tool: "search_messages",
      label: "Searching messages",
      call: 1,
      kind: "chat",
    }),
    status({
      step: "reading",
      tool: "search_records",
      label: "Searching documents and minutes",
      call: 2,
      kind: "records",
    }),
  ];

  it("replaces the opening search with the first read, then adds one step per read", () => {
    const steps = play(slow);
    expect(steps.map((step) => [step.key, step.kind, step.state])).toEqual([
      ["call:1", "chat", "working"],
      ["call:2", "records", "working"],
    ]);
  });

  it("ends each read by its number, in whatever order they come back", () => {
    const steps = play([
      ...slow,
      ended({
        call: 2,
        tool: "search_records",
        kind: "records",
        outcome: "found",
        found: 2,
        names: ["Budget 2026", "Chapter meeting, Mar 3"],
      }),
    ]);
    expect(steps.map((step) => step.state)).toEqual(["working", "done"]);
    expect(askStepLabel(steps[1]!)).toBe("Searched documents and minutes");
    expect(askStepChips(steps[1]!)).toEqual([
      "Budget 2026",
      "Chapter meeting, Mar 3",
    ]);
    expect(askStepFoundLine(steps[1]!)).toBeNull();
    expect(askStepLabel(steps[0]!)).toBe("Searching messages");
  });

  it("writes a chat read as a count of messages and where, with no chips", () => {
    const [chat] = play([
      ...slow,
      ended({
        call: 1,
        tool: "search_messages",
        outcome: "found",
        found: 3,
        names: ["#exec-board"],
      }),
    ]);
    expect(askStepFoundLine(chat!)).toBe("3 messages in #exec-board");
    expect(askStepChips(chat!)).toEqual([]);
    expect(askStepSpoken(chat!)).toBe(
      "Searched messages, done, 3 messages in #exec-board",
    );
  });

  it("says when a read found nothing or failed", () => {
    const steps = play([
      ...slow,
      ended({
        call: 1,
        tool: "search_messages",
        outcome: "nothing",
        found: 0,
        names: [],
      }),
      ended({
        call: 2,
        tool: "search_records",
        outcome: "failed",
        found: 0,
        names: [],
      }),
    ]);
    expect(steps.map((step) => step.state)).toEqual(["nothing", "failed"]);
    expect(steps.map(askStepFoundLine)).toEqual([
      "Nothing found",
      "Couldn't read this",
    ]);
  });

  it("folds at the first word: everything still working is over", () => {
    const steps = play([...slow, status({ step: "writing" })]);
    expect(steps.map((step) => step.state)).toEqual(["done", "done"]);
    expect(askStepsSummary(steps)).toBe("Worked through 2 steps");
    expect(askStepKinds(steps)).toEqual(["chat", "records"]);
  });

  it("shows no list for a turn that read nothing", () => {
    expect(play([status({ step: "searching" }), DONE])).toEqual([]);
  });

  it("names a single step by its own words", () => {
    const steps = play([
      status({ step: "searching" }),
      status({
        step: "reading",
        tool: "events",
        label: "Reading the events calendar",
        call: 1,
      }),
      DONE,
    ]);
    expect(askStepsSummary(steps)).toBe("Read the events calendar");
  });

  it("draws a kind it does not know as the plain mark", () => {
    const [step] = play([
      status({
        step: "reading",
        tool: "brand_new",
        label: "Reading something new",
        call: 1,
        kind: "galaxies",
      }),
    ]);
    expect(step!.kind).toBe("other");
  });
});

describe("steps the server never counted, and turns that broke", () => {
  it("settles a one-shot live read and a card with a tick and no count", () => {
    const steps = play([
      status({ step: "searching" }),
      status({ step: "reading", reads: ["events"], found: 3 }),
      status({ step: "proposing" }),
      DONE,
    ]);
    expect(steps.map((step) => [step.key, step.state])).toEqual([
      ["search", "done"],
      ["read:events", "done"],
      ["propose", "done"],
    ]);
    expect(steps.map(askStepFoundLine)).toEqual(["3 sources", null, null]);
    expect(askStepLabel(steps[2]!)).toBe("Worked out what that would change");
    expect(askStepSpoken(steps[1]!)).toBe("Read the events calendar, done");
  });

  it("draws no list once the stream broke", () => {
    expect(
      play([
        ...[status({ step: "searching" })],
        status({
          step: "reading",
          tool: "events",
          label: "Reading the events calendar",
          call: 1,
        }),
        { v: 1, type: "error", code: "x", retryable: true },
      ]),
    ).toEqual([]);
  });

  it("gives a server from before #5427 a row per read, with no count", () => {
    const steps = play([
      status({ step: "searching" }),
      status({
        step: "reading",
        tool: "search_messages",
        label: "Searching messages",
      }),
      status({
        step: "reading",
        tool: "events",
        label: "Reading the events calendar",
      }),
      DONE,
    ]);
    expect(steps.map((step) => [step.key, step.kind, step.state])).toEqual([
      ["tool:1", "chat", "done"],
      ["tool:2", "events", "done"],
    ]);
    expect(steps.map(askStepFoundLine)).toEqual([null, null]);
  });
});

describe("askStepsOn: the one-shot path", () => {
  it("ends the search with its count and adds the live reads it picked", () => {
    const steps = play([
      status({ step: "searching" }),
      status({ step: "reading", reads: ["events", "unknown_read"], found: 3 }),
    ]);
    expect(
      steps.map((step) => [askStepLabel(step), step.state, step.kind]),
    ).toEqual([
      ["Searched your chapter's sources", "done", "records"],
      ["Reading the events calendar", "working", "events"],
    ]);
    expect(askStepFoundLine(steps[0]!)).toBe("3 sources");
  });

  it("says the search found nothing", () => {
    const [search] = play([
      status({ step: "searching" }),
      status({ step: "reading", reads: ["my_dues"], found: 0 }),
      DONE,
    ]);
    expect(search!.state).toBe("nothing");
  });
});

describe("the wire", () => {
  it("reads a step event and the new keys on a status", () => {
    expect(
      parseAskStreamEvent(
        JSON.stringify({
          v: 1,
          type: "step",
          call: 1,
          tool: "events",
          kind: "events",
          outcome: "found",
          found: 1,
          names: ["Spring Formal"],
        }),
      ),
    ).toMatchObject({ type: "step", call: 1, names: ["Spring Formal"] });
    expect(
      parseAskStreamEvent(
        JSON.stringify({
          v: 1,
          type: "status",
          step: "reading",
          call: 2,
          kind: "chat",
        }),
      ),
    ).toMatchObject({ call: 2, kind: "chat" });
  });

  it("keeps at most three names, once each, from a server that sends more", () => {
    const [step] = play([
      status({ step: "reading", tool: "x", label: "Reading x", call: 1 }),
      ended({
        call: 1,
        tool: "x",
        outcome: "found",
        found: 5,
        names: ["A", "A", "B", "C", "D"],
      }),
    ]);
    expect(step!.names).toEqual(["A", "B", "C"]);
    expect(askStepFoundLine(step!)).toBe("5 found");
  });
});

describe("words", () => {
  it.each([
    ["Searching messages", "Searched messages"],
    ["Reading the roster", "Read the roster"],
    ["Looking at your channels", "Looked at your channels"],
    ["Looking up a member", "Looked up a member"],
    ["Looking through backwork", "Looked through backwork"],
    ["Adding up attendance", "Added up attendance"],
    ["Opening an event", "Opened an event"],
    ["Something new", "Something new"],
  ])("%s becomes %s", (now, then) => {
    expect(askStepPast(now)).toBe(then);
  });

  it("knows no kind for an inherited key", () => {
    expect(askStepKind("toString")).toBe("other");
    expect(askStepKind(undefined)).toBe("other");
  });
});
