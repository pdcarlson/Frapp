import { describe, expect, it } from "vitest";
import {
  ASK_CORPUS,
  answerQuestion,
  SUGGESTED_QUESTIONS,
  type AskAnswer,
} from "./corpus";

/**
 * These pin the three rules `spec/behavior/ai.md` states, which are the rules a
 * mock is most tempted to break: every answer cites, low confidence refuses
 * rather than fabricates, and silence is "I don't know" rather than a guess.
 *
 * The corpus is synthetic and its copy will change; the assertions below are
 * written against *shape and routing*, not against wording, so editing an
 * answer does not fail a test that was never about the answer.
 */

function answered(
  question: string,
): Extract<AskAnswer, { status: "answered" }> {
  const answer = answerQuestion(question);
  if (answer.status !== "answered") {
    throw new Error(
      `expected "${question}" to be answered, got ${answer.status}`,
    );
  }
  return answer;
}

describe("answerQuestion", () => {
  it("answers the drawn s17 question with the drawn key figure in a span", () => {
    const answer = answered("How much are dues this semester?");
    const key = answer.spans.filter((span) => span.emphasis === "key");

    // Exactly one key figure: §11 gives the card a single gold emphasis and a
    // second one would read as two competing answers.
    expect(key).toHaveLength(1);
    expect(key[0].text).toBe("$425 per semester");
  });

  it("keeps the answer whole when the spans are concatenated", () => {
    // The renderer draws the spans in order inside one Text; if a span carried
    // its own leading/trailing markup the sentence would come out mangled.
    const answer = answered("How much are dues this semester?");
    const prose = answer.spans.map((span) => span.text).join("");
    expect(prose).toBe(
      "Dues are $425 per semester, due Sept 15. Payment plans need treasurer approval one week before the deadline.",
    );
  });

  it("matches on keywords rather than on the exact drawn wording", () => {
    // A member types their own sentence, not the suggestion chip's.
    expect(answerQuestion("do we have a study hour requirement").status).toBe(
      "answered",
    );
    expect(answerQuestion("WHAT DID WE VOTE ON").status).toBe("answered");
  });

  it("refuses rather than picking a side when two sources disagree", () => {
    const answer = answerQuestion("how much are dues next semester?");
    expect(answer.status).toBe("refused");
    if (answer.status !== "refused") return;
    // The refusal has to name the conflict, or it reads as an outage.
    expect(answer.message).toContain("two different answers");
  });

  it("lets the more specific entry win over the general one it overlaps", () => {
    // "dues next" must not fall through to the plain dues answer, which would
    // state one of the two conflicting figures as fact.
    expect(answerQuestion("what are dues?").status).toBe("answered");
    expect(answerQuestion("what are dues next term?").status).toBe("refused");
  });

  it("says I don't know when the corpus is silent, and that is the default", () => {
    for (const question of [
      "",
      "   ",
      "who is the current risk chair?",
      "can I bring a guest to formal?",
    ]) {
      const answer = answerQuestion(question);
      expect(answer.status).toBe("unknown");
      if (answer.status !== "unknown") continue;
      expect(answer.message).toContain("I don't know");
    }
  });
});

describe("the citation contract", () => {
  it("cites at least one source on every answer the corpus can give", () => {
    const uncited = ASK_CORPUS.filter(
      (entry) =>
        entry.answer.status === "answered" && entry.answer.sources.length === 0,
    );
    expect(uncited).toEqual([]);
  });

  it("gives every citation a kind and a label to render", () => {
    for (const entry of ASK_CORPUS) {
      if (entry.answer.status !== "answered") continue;
      for (const source of entry.answer.sources) {
        expect(["document", "minutes", "channel"]).toContain(source.kind);
        expect(source.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("carries no sources on a refusal — there is nothing it is willing to cite", () => {
    const answer = answerQuestion("how much are dues next semester?");
    expect(answer).not.toHaveProperty("sources");
  });
});

describe("SUGGESTED_QUESTIONS", () => {
  it("draws the two chips s17 draws", () => {
    expect(SUGGESTED_QUESTIONS).toHaveLength(2);
  });

  it("never suggests a question the corpus cannot answer", () => {
    // A chip that lands on "I don't know" is worse than no chip at all.
    for (const question of SUGGESTED_QUESTIONS) {
      expect(
        answerQuestion(question).status,
        `suggestion "${question}" is unanswerable`,
      ).toBe("answered");
    }
  });
});

describe("keyword specificity", () => {
  it("does not let 'mandatory' swallow a study-hours question", () => {
    // The regression this pins: `["mandatory"]` as a lone keyword sat above
    // `["study"]` and answered "Are study hours mandatory?" with the chapter
    // meeting — citing Bylaws §2.1 at a question about study hours.
    const answer = answerQuestion("Are study hours mandatory?");
    expect(answer.status).toBe("answered");
    if (answer.status !== "answered") return;
    const text = answer.spans.map((span) => span.text).join("");
    expect(text).toMatch(/study hours/i);
    expect(text).not.toMatch(/chapter meeting/i);
  });

  it("still answers the drawn suggestion", () => {
    const answer = answerQuestion("When's the next mandatory event?");
    expect(answer.status).toBe("answered");
    if (answer.status !== "answered") return;
    expect(answer.spans.map((s) => s.text).join("")).toMatch(
      /chapter meeting/i,
    );
  });
});
