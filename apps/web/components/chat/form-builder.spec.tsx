import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyFormDraft } from "@repo/chat-core/form-draft";
import { FormBuilder } from "./form-builder";

describe("FormBuilder (#3926 step 3)", () => {
  it("posts the questions in order, with their options and required setting", async () => {
    const user = userEvent.setup();
    const onPost = vi.fn(async () => ({ ok: true as const }));
    const onDone = vi.fn();
    render(
      <FormBuilder
        initialDraft={emptyFormDraft()}
        onPost={onPost}
        onDone={onDone}
        onDiscard={vi.fn()}
      />,
    );
    const post = screen.getByRole("button", { name: "Post form" });
    expect(post).toBeDisabled();

    await user.type(screen.getByPlaceholderText("Formal housing"), "Housing");
    await user.type(screen.getByLabelText("Question 1"), "What room?");
    await user.type(screen.getByLabelText("Question 1, option 1"), "Single");
    await user.type(screen.getByLabelText("Question 1, option 2"), "Double");
    await user.click(screen.getByLabelText("Required"));
    await user.click(screen.getByRole("button", { name: "+ Add a question" }));
    await user.type(screen.getByLabelText("Question 2"), "Roommate?");
    // A multiple-choice question with no option can't be posted.
    expect(post).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Give this question at least one option.",
    );
    await user.type(screen.getByLabelText("Question 2, option 1"), "Anyone");
    await user.click(
      screen.getByRole("button", { name: "Move question 2 up" }),
    );
    await user.click(post);

    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [sent] = onPost.mock.calls[0] as unknown as [
      {
        content: string;
        payload: {
          questions: {
            title: string;
            required: boolean;
            options?: { label: string }[];
          }[];
        };
      },
    ];
    expect(sent.content).toBe("Housing");
    expect(
      sent.payload.questions.map((q) => ({
        title: q.title,
        required: q.required,
        options: q.options?.map((o) => o.label),
      })),
    ).toEqual([
      { title: "Roommate?", required: false, options: ["Anyone"] },
      { title: "What room?", required: true, options: ["Single", "Double"] },
    ]);
  });

  it("discards without posting, even when the draft could be posted", async () => {
    const user = userEvent.setup();
    const onPost = vi.fn(async () => ({ ok: true as const }));
    const onDiscard = vi.fn();
    render(
      <FormBuilder
        initialDraft={emptyFormDraft()}
        onPost={onPost}
        onDone={vi.fn()}
        onDiscard={onDiscard}
      />,
    );
    await user.type(screen.getByPlaceholderText("Formal housing"), "Housing");
    await user.type(screen.getByLabelText("Question 1"), "What room?");
    await user.type(screen.getByLabelText("Question 1, option 1"), "Single");
    expect(screen.getByRole("button", { name: "Post form" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(onDiscard).toHaveBeenCalled();
    expect(onPost).not.toHaveBeenCalled();
  });
});
