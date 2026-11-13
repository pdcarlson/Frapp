import { describe, expect, it } from "vitest";
import { FORM_OPTIONS_MAX, FORM_QUESTIONS_MAX } from "@repo/validation";
import {
  FORM_END_PASSED_PROBLEM,
  FORM_END_TOO_FAR_PROBLEM,
  addFormOption,
  addFormQuestion,
  canAddFormOption,
  canAddFormQuestion,
  checkFormDraft,
  emptyFormDraft,
  formQuestionTypeLabel,
  moveFormQuestion,
  removeFormOption,
  removeFormQuestion,
  setFormOption,
  setFormQuestion,
  type FormDraft,
} from "./form-draft";
import { buildFormMessage } from "./forms";

const NOW = Date.parse("2026-11-13T12:00:00.000Z");

/** A draft with a title and its first question written, two options named. */
function written(): FormDraft {
  let draft = emptyFormDraft();
  const q = draft.questions[0]!;
  draft = { ...draft, title: "Formal housing" };
  draft = setFormQuestion(draft, q.key, { title: "What room?" });
  draft = setFormOption(draft, q.key, q.options[0]!.key, "Single");
  draft = setFormOption(draft, q.key, q.options[1]!.key, "Double");
  return draft;
}

describe("emptyFormDraft", () => {
  it("starts with one multiple-choice question and two blank options", () => {
    const draft = emptyFormDraft();
    expect(draft.questions).toHaveLength(1);
    expect(draft.questions[0]!.type).toBe("multiple_choice");
    expect(draft.questions[0]!.options).toHaveLength(2);
    expect(draft.closesAt).toBeNull();
  });
});

describe("editing questions", () => {
  it("adds a question of the last one's type, up to the API's limit", () => {
    let draft = emptyFormDraft();
    draft = setFormQuestion(draft, draft.questions[0]!.key, {
      type: "paragraph",
    });
    draft = addFormQuestion(draft);
    expect(draft.questions[1]!.type).toBe("paragraph");
    while (canAddFormQuestion(draft)) draft = addFormQuestion(draft);
    expect(draft.questions).toHaveLength(FORM_QUESTIONS_MAX);
    expect(addFormQuestion(draft)).toBe(draft);
  });

  it("keeps the last question", () => {
    const draft = emptyFormDraft();
    expect(removeFormQuestion(draft, draft.questions[0]!.key)).toBe(draft);
  });

  it("moves a question up and down, and not past either end", () => {
    let draft = addFormQuestion(emptyFormDraft());
    const [a, b] = draft.questions.map((q) => q.key);
    draft = moveFormQuestion(draft, b!, -1);
    expect(draft.questions.map((q) => q.key)).toEqual([b, a]);
    expect(moveFormQuestion(draft, b!, -1)).toBe(draft);
    expect(moveFormQuestion(draft, a!, 1)).toBe(draft);
  });

  it("gives a question switched to a choice type an option row to type in", () => {
    let draft = emptyFormDraft();
    const key = draft.questions[0]!.key;
    draft = removeFormOption(draft, key, draft.questions[0]!.options[0]!.key);
    draft = removeFormOption(draft, key, draft.questions[0]!.options[0]!.key);
    expect(draft.questions[0]!.options).toHaveLength(1);
    draft = setFormQuestion(draft, key, { type: "short_answer" });
    // Kept while the type takes none, so switching back loses nothing.
    expect(draft.questions[0]!.options).toHaveLength(1);
  });

  it("caps a question's options at the API's limit", () => {
    let draft = emptyFormDraft();
    const key = draft.questions[0]!.key;
    while (canAddFormOption(draft.questions[0]!)) {
      draft = addFormOption(draft, key);
    }
    expect(draft.questions[0]!.options).toHaveLength(FORM_OPTIONS_MAX);
  });

  it("names each type as the builder offers it", () => {
    expect(formQuestionTypeLabel("yes_no")).toBe("Yes or no");
  });
});

describe("checkFormDraft", () => {
  it("holds an unfinished draft without blaming the member", () => {
    expect(checkFormDraft(emptyFormDraft(), NOW)).toEqual({
      ok: false,
      problem: null,
    });
    const untitled = { ...written(), title: "  " };
    expect(checkFormDraft(untitled, NOW)).toEqual({ ok: false, problem: null });
  });

  it("posts the written questions, trimmed, skipping blank ones and blank options", () => {
    let draft = addFormQuestion(written());
    draft = addFormQuestion(draft);
    const third = draft.questions[2]!.key;
    draft = setFormQuestion(draft, third, {
      type: "short_answer",
      title: "  Anything else? ",
      required: true,
    });
    const check = checkFormDraft(draft, NOW);
    expect(check).toEqual({
      ok: true,
      input: {
        title: "Formal housing",
        questions: [
          {
            type: "multiple_choice",
            title: "What room?",
            required: false,
            options: ["Single", "Double"],
          },
          { type: "short_answer", title: "Anything else?", required: true },
        ],
      },
    });
  });

  it("points at a question with options but no text", () => {
    let draft = written();
    const key = draft.questions[0]!.key;
    draft = setFormQuestion(draft, key, { title: "" });
    expect(checkFormDraft(draft, NOW)).toEqual({
      ok: false,
      problem: "Write this question, or remove it.",
      questionKey: key,
    });
  });

  it("refuses a choice question with no option, or two the same", () => {
    let draft = written();
    const q = draft.questions[0]!;
    const noOptions = setFormOption(
      setFormOption(draft, q.key, q.options[0]!.key, ""),
      q.key,
      q.options[1]!.key,
      " ",
    );
    expect(checkFormDraft(noOptions, NOW)).toMatchObject({
      ok: false,
      problem: "Give this question at least one option.",
      questionKey: q.key,
    });
    draft = setFormOption(draft, q.key, q.options[1]!.key, " single ");
    expect(checkFormDraft(draft, NOW)).toMatchObject({
      ok: false,
      questionKey: q.key,
    });
  });

  it("refuses an end time that has passed or is more than a year out", () => {
    const past = { ...written(), closesAt: new Date(NOW - 1) };
    expect(checkFormDraft(past, NOW)).toEqual({
      ok: false,
      problem: FORM_END_PASSED_PROBLEM,
    });
    const far = {
      ...written(),
      closesAt: new Date(NOW + 400 * 24 * 60 * 60 * 1000),
    };
    expect(checkFormDraft(far, NOW)).toEqual({
      ok: false,
      problem: FORM_END_TOO_FAR_PROBLEM,
    });
  });

  it("builds the card the API takes", () => {
    const closesAt = new Date(NOW + 60 * 60 * 1000);
    const check = checkFormDraft({ ...written(), closesAt }, NOW);
    if (!check.ok) throw new Error("expected a postable draft");
    let n = 0;
    const message = buildFormMessage(check.input, () => `id${++n}`);
    expect(message).toEqual({
      content: "Formal housing",
      payload: {
        title: "Formal housing",
        questions: [
          {
            id: "id1",
            type: "multiple_choice",
            title: "What room?",
            required: false,
            options: [
              { id: "id2", label: "Single" },
              { id: "id3", label: "Double" },
            ],
          },
        ],
        closes_at: closesAt.toISOString(),
      },
    });
  });
});
