import { describe, expect, it } from "vitest";
import {
  TASK_PROOF_LINK_MAX,
  normalizeProofLink,
  taskNeedsSignOff,
  taskMarkDoneCheck,
  taskSignedOffAutomatically,
} from "./task-proof";

describe("normalizeProofLink", () => {
  it.each([
    ["https://docs.google.com/x", "https://docs.google.com/x"],
    ["http://example.com", "http://example.com"],
    ["  https://example.com/a?b=c  ", "https://example.com/a?b=c"],
    ["HTTPS://Example.com/x", "HTTPS://Example.com/x"],
  ])("keeps %j as %j", (raw, kept) => {
    expect(normalizeProofLink(raw)).toBe(kept);
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["no scheme", "docs.google.com/x"],
    ["a scheme without slashes", "https:docs.google.com/x"],
    ["a scheme with one slash", "http:/foo.com"],
    ["javascript", "javascript:alert(1)"],
    ["ftp", "ftp://example.com/x"],
    ["mailto", "mailto:a@example.com"],
    ["no host", "https://"],
    ["plain words", "not a link"],
    ["too long", `https://example.com/${"a".repeat(TASK_PROOF_LINK_MAX)}`],
  ])("refuses %s", (_, raw) => {
    expect(normalizeProofLink(raw)).toBeNull();
  });
});

describe("taskNeedsSignOff", () => {
  it.each([
    [{ point_reward: 5, proof_kind: "none" }, true],
    [{ point_reward: null, proof_kind: "photo" }, true],
    [{ point_reward: 0, proof_kind: "link" }, true],
    [{ point_reward: null, proof_kind: "none" }, false],
    [{ point_reward: 0, proof_kind: null }, false],
    [{}, false],
  ])("%j → %s", (task, expected) => {
    expect(taskNeedsSignOff(task)).toBe(expected);
  });
});

describe("taskSignedOffAutomatically", () => {
  const AT = "2026-02-26T18:30:00.000Z";
  const auto = {
    points_awarded: true,
    completed_at: AT,
    confirmed_at: AT,
    point_reward: null,
    proof_kind: "none",
  };

  it("is true when signed off as it was marked done", () => {
    expect(taskSignedOffAutomatically(auto)).toBe(true);
  });

  it("compares instants, not strings", () => {
    expect(
      taskSignedOffAutomatically({
        ...auto,
        confirmed_at: "2026-02-26T18:30:00+00:00",
      }),
    ).toBe(true);
  });

  it.each([
    [
      "an officer confirmed it later",
      { confirmed_at: "2026-02-27T09:00:00.000Z" },
    ],
    ["nothing was signed off", { points_awarded: false }],
    ["it has no completion time", { completed_at: null }],
    ["it has no confirmation time", { confirmed_at: null }],
    ["it carries points", { point_reward: 5 }],
    ["it asks for proof", { proof_kind: "photo" }],
  ])("is false when %s", (_, overrides) => {
    expect(taskSignedOffAutomatically({ ...auto, ...overrides })).toBe(false);
  });
});

describe("taskMarkDoneCheck mirrors the server's refusals (#4635)", () => {
  const draft = { photoCount: 0, link: "", note: "" };

  it("needs at least one photo on a Photo task", () => {
    expect(
      taskMarkDoneCheck({ proofKind: "photo", sentBack: false }, draft),
    ).toEqual({
      ok: false,
      problem: "Add at least one photo of the finished job.",
    });
    expect(
      taskMarkDoneCheck(
        { proofKind: "photo", sentBack: false },
        { ...draft, photoCount: 2 },
      ),
    ).toEqual({ ok: true, proof: {} });
  });

  it("needs a valid http(s) link on a Link task", () => {
    expect(
      taskMarkDoneCheck({ proofKind: "link", sentBack: false }, draft),
    ).toMatchObject({ ok: false, problem: "Add a link to show it's done." });
    expect(
      taskMarkDoneCheck(
        { proofKind: "link", sentBack: false },
        { ...draft, link: "javascript:alert(1)" },
      ),
    ).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/https:\/\//),
    });
    expect(
      taskMarkDoneCheck(
        { proofKind: "link", sentBack: false },
        { ...draft, link: "  https://docs.example.com/x  " },
      ),
    ).toEqual({ ok: true, proof: { proofLink: "https://docs.example.com/x" } });
  });

  it("needs proof or a reply on a sent-back task", () => {
    expect(
      taskMarkDoneCheck({ proofKind: "none", sentBack: true }, draft),
    ).toMatchObject({
      ok: false,
      problem: "Add proof or reply to the officer before marking it done.",
    });
    expect(
      taskMarkDoneCheck(
        { proofKind: "none", sentBack: true },
        { ...draft, note: "  Mopped it again  " },
      ),
    ).toEqual({ ok: true, proof: { completionNote: "Mopped it again" } });
    expect(
      taskMarkDoneCheck(
        { proofKind: "none", sentBack: true },
        { ...draft, photoCount: 1 },
      ),
    ).toEqual({ ok: true, proof: {} });
  });

  it("lets a task that asks for nothing go with nothing", () => {
    expect(
      taskMarkDoneCheck({ proofKind: "none", sentBack: false }, draft),
    ).toEqual({ ok: true, proof: {} });
  });
});
