import { describe, expect, it, vi } from "vitest";
import {
  cardExportFilenamePrefix,
  fetchFormResponses,
  formAnswerText,
  formChoicePercent,
  formResponsesExportRows,
  formResponsesKey,
  isFormCreator,
  summarizeFormResponses,
  type FormResponseEntry,
} from "./form-responses";
import type { FormPayload } from "./forms";
import type { FrappApiClient } from "./chat-client";

const card: FormPayload = {
  title: "Room picks",
  questions: [
    {
      id: "room",
      type: "multiple_choice",
      title: "Room",
      required: true,
      options: [
        { id: "single", label: "Single" },
        { id: "double", label: "Double" },
      ],
    },
    {
      id: "nights",
      type: "checkboxes",
      title: "Nights",
      required: false,
      options: [
        { id: "fri", label: "Friday" },
        { id: "sat", label: "Saturday" },
      ],
    },
    { id: "staying", type: "yes_no", title: "Staying?", required: false },
    { id: "why", type: "paragraph", title: "Room", required: false },
  ],
};

const entry = (
  user_id: string,
  answers: FormResponseEntry["answers"],
  created_at = "2026-11-13T10:00:00.000Z",
): FormResponseEntry => ({
  user_id,
  answers,
  created_at,
  updated_at: created_at,
});

const responses = [
  entry("ann", {
    room: "single",
    nights: ["fri", "sat"],
    staying: "yes",
    why: "Quiet",
  }),
  entry("bo", { room: "double", nights: ["sat"] }, "2026-11-13T11:00:00.000Z"),
  entry("cy", { room: "single", staying: "no", why: "  " }),
];

describe("form responses (#3926 step 4)", () => {
  it("opens responses only to the member who posted the form", () => {
    expect(isFormCreator({ sender_id: "u1" }, "u1")).toBe(true);
    expect(isFormCreator({ sender_id: "u1" }, "u2")).toBe(false);
    expect(isFormCreator({ sender_id: null }, null)).toBe(false);
  });

  it("reads each answer as words: labels, ticked boxes, Yes or No, text", () => {
    const [room, nights, staying, why] = card.questions;
    expect(formAnswerText(room!, "double")).toBe("Double");
    expect(formAnswerText(nights!, ["fri", "sat"])).toBe("Friday, Saturday");
    expect(formAnswerText(staying!, "no")).toBe("No");
    expect(formAnswerText(why!, "Quiet")).toBe("Quiet");
    expect(formAnswerText(room!, undefined)).toBe("");
    expect(formAnswerText(room!, "gone")).toBe("");
  });

  it("counts each option per question, and lists text answers in order", () => {
    const summary = summarizeFormResponses(card, responses);
    expect(summary[0]).toMatchObject({
      answered: 3,
      choices: [
        { id: "single", count: 2 },
        { id: "double", count: 1 },
      ],
      texts: null,
    });
    // A checkboxes response counts once per box, the question once.
    expect(summary[1]).toMatchObject({
      answered: 2,
      choices: [
        { id: "fri", count: 1 },
        { id: "sat", count: 2 },
      ],
    });
    expect(summary[2]).toMatchObject({
      answered: 2,
      choices: [
        { id: "yes", label: "Yes", count: 1 },
        { id: "no", label: "No", count: 1 },
      ],
    });
    // A blank text answer isn't an answer.
    expect(summary[3]).toMatchObject({ answered: 1, texts: ["Quiet"] });
    expect(formChoicePercent(2, 3)).toBe(67);
    expect(formChoicePercent(0, 0)).toBe(0);
  });

  it("exports one row per response with a numbered column per question", () => {
    const rows = formResponsesExportRows(card, responses, (id) =>
      id === "ann" ? "Ann Lee" : id === "bo" ? "Bo Park" : `Member ${id}`,
    );
    expect(rows).toHaveLength(3);
    // Two questions titled "Room" stay two columns, in the form's order.
    expect(Object.keys(rows[0]!)).toEqual([
      "Name",
      "Answered at",
      "Last changed",
      "1. Room",
      "2. Nights",
      "3. Staying?",
      "4. Room",
    ]);
    expect(rows[0]).toMatchObject({
      Name: "Ann Lee",
      "1. Room": "Single",
      "2. Nights": "Friday, Saturday",
      "3. Staying?": "Yes",
      "4. Room": "Quiet",
    });
    expect(rows[1]!["Answered at"]).toBe("2026-11-13T11:00:00.000Z");
    // The label is the caller's, so a row reads as the member does on screen.
    expect(rows[2]!.Name).toBe(`Member ${responses[2]!.user_id}`);
  });

  it("names the export file from the card's kind and title", () => {
    expect(cardExportFilenamePrefix("form", "Room picks: Spring '27!")).toBe(
      "form-room-picks-spring-27",
    );
    expect(cardExportFilenamePrefix("signup", "🎉")).toBe("signup");
  });

  it("reads the responses route and throws the server's refusal", async () => {
    const ok = {
      GET: vi.fn().mockResolvedValue({
        data: { responses, not_responded: ["dee"] },
      }),
    } as unknown as FrappApiClient;
    await expect(fetchFormResponses(ok, "m1")).resolves.toEqual({
      responses,
      not_responded: ["dee"],
    });
    expect(ok.GET).toHaveBeenCalledWith(
      "/v1/channels/messages/{messageId}/form-responses",
      { params: { path: { messageId: "m1" } } },
    );
    const refused = {
      GET: vi.fn().mockResolvedValue({
        error: {
          message: "Only the member who posted this form can see its responses",
        },
      }),
    } as unknown as FrappApiClient;
    await expect(fetchFormResponses(refused, "m1")).rejects.toThrow(
      "Only the member who posted this form can see its responses",
    );
    expect(formResponsesKey("m1")).toEqual(["chat", "form-responses", "m1"]);
  });
});
