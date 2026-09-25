import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { QuotedMessage, UNAVAILABLE_QUOTE } from "./reply-quote";

describe("QuotedMessage", () => {
  it("renders as static text when it has nowhere to navigate", () => {
    render(<QuotedMessage author="Alice Chen" preview="hey there" />);
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.getByText("hey there")).toBeInTheDocument();
    // The composer's staged-reply strip quotes a message with no thread to
    // open. Rendering a button there would be an inert control.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is a button when it can open the quoted message", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <QuotedMessage author="Alice Chen" preview="hey there" onOpen={onOpen} />,
    );
    await user.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("says so when the quoted message is outside the loaded window", () => {
    // Not an edge case: nothing backfills older history (#1571), so every reply
    // to a message older than the one loaded window lands here. Rendering
    // nothing would make such a reply indistinguishable from a plain message.
    render(<QuotedMessage author={null} preview={null} />);
    expect(screen.getByText(UNAVAILABLE_QUOTE)).toBeInTheDocument();
  });

  it("never becomes a control when the message is unavailable", () => {
    // The parent it would navigate to is the thing that is missing, so offering
    // `onOpen` must not produce a button that opens an empty panel.
    render(
      <QuotedMessage author={null} preview={null} onOpen={vi.fn()} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("prints only the placeholder for a parent the block list hides, and is never a control (#2313)", () => {
    // The parent is loaded (it has an author), so only `hidden` keeps its words
    // off screen and keeps the quote from jumping to a row the viewer may not
    // see: a held parent is not in the timeline to scroll to.
    render(
      <QuotedMessage
        author="Blake Moss"
        preview="the insult"
        hidden="Message from a member you blocked"
        onOpen={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Message from a member you blocked"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Blake Moss")).not.toBeInTheDocument();
    expect(screen.queryByText("the insult")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shares one rule and indent across both variants", () => {
    // The unavailable branch used to re-type the class string, in the one file
    // whose stated purpose is that the two cannot drift — and it is the branch
    // nobody re-screenshots, because it only appears for old parents.
    const { container: loaded } = render(
      <QuotedMessage author="Alice Chen" preview="hey" />,
    );
    const { container: missing } = render(
      <QuotedMessage author={null} preview={null} />,
    );
    for (const cls of ["border-l-2", "border-border", "pl-2", "text-[12.5px]"]) {
      expect(loaded.firstElementChild).toHaveClass(cls);
      expect(missing.firstElementChild).toHaveClass(cls);
    }
  });
});
