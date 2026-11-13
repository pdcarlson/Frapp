import { render, screen } from "@testing-library/react";
import type { ChatMessage } from "@repo/chat-core/types";
import { describe, expect, it } from "vitest";
import { AskAnswerCard } from "./ask-answer-card";

/**
 * An Ask Frapp answer posted to a channel, as everyone who reads the channel
 * sees it (#4713).
 */

const ASKER = "user-sam";
const nameFor = (id: string) => (id === ASKER ? "Sam Abernathy" : null);

const message = (payload: unknown, content = "Quorum is two thirds.") =>
  ({
    id: "m1",
    channel_id: "c1",
    sender_id: "00000000-0000-0000-0000-000000000000",
    kind: "ask_answer",
    content,
    payload,
    created_at: "2026-11-13T18:00:00.000Z",
    is_deleted: false,
    _status: "confirmed",
  }) as unknown as ChatMessage;

const POSTED = {
  v: 1,
  ask_id: "ask-1",
  asked_by: ASKER,
  question: "What is **quorum**?",
  citations: [{ source: 0, at: 21 }],
  sources: [
    {
      kind: "document",
      title: "Bylaws",
      detail: "Article IV",
      date: "2026-09-01T00:00:00.000Z",
      target: { type: "document", document_id: "doc-1", page: 3 },
    },
  ],
};

describe("AskAnswerCard", () => {
  it("says who asked and what, then the answer with its marker and source", () => {
    render(<AskAnswerCard message={message(POSTED)} nameFor={nameFor} />);
    expect(screen.getByText("Sam Abernathy asked Frapp")).toBeVisible();
    // The asker's words as they typed them, never drawn as markdown.
    expect(screen.getByText("What is **quorum**?")).toBeVisible();
    expect(screen.getByText("Quorum is two thirds.")).toBeVisible();
    const marker = screen.getByRole("link", { name: "Source 1: Bylaws" });
    expect(marker).toHaveAttribute(
      "href",
      expect.stringContaining("/documents?"),
    );
    // The marker names its source and carries no quoted passage.
    expect(marker).toHaveAttribute("title", "Bylaws");
    expect(
      screen.getByRole("list", { name: "Sources" }).querySelectorAll("li"),
    ).toHaveLength(1);
    expect(
      screen.queryByText("Some of these may not open for you."),
    ).toBeNull();
  });

  it("names the asker's own records as theirs, and opens nothing from them", () => {
    render(
      <AskAnswerCard
        message={message({
          ...POSTED,
          citations: [],
          sources: [
            {
              kind: "tasks",
              title: "Your tasks",
              detail: null,
              date: null,
              target: null,
              own: true,
              limited: true,
            },
          ],
        })}
        nameFor={nameFor}
      />,
    );
    const sources = screen.getByRole("list", { name: "Sources" });
    expect(sources).toHaveTextContent("Sam Abernathy's tasks");
    expect(sources).not.toHaveTextContent("Your tasks");
    expect(sources.querySelector("a")).toBeNull();
    expect(
      screen.getByText("Some of these may not open for you."),
    ).toBeVisible();
  });

  it("still reads when the roster cannot name the asker", () => {
    render(
      <AskAnswerCard
        message={message({ ...POSTED, asked_by: "user-gone" })}
        nameFor={() => null}
      />,
    );
    expect(screen.getByText(/asked Frapp$/)).toBeVisible();
    expect(screen.getByText("Quorum is two thirds.")).toBeVisible();
  });

  it("says when the answer was cut short", () => {
    render(
      <AskAnswerCard
        message={message({ ...POSTED, truncated: true })}
        nameFor={nameFor}
      />,
    );
    expect(
      screen.getByText(
        "This answer was cut short. Ask a narrower question for the rest.",
      ),
    ).toBeVisible();
  });

  it.each([null, {}, { v: 1, question: 7 }])(
    "falls back to the answer's words for a payload it cannot read (%j)",
    (payload) => {
      render(<AskAnswerCard message={message(payload)} nameFor={nameFor} />);
      expect(screen.getByText("Quorum is two thirds.")).toBeVisible();
      expect(screen.queryByText(/asked Frapp/)).toBeNull();
    },
  );
});
