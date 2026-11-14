/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRouter } from "expo-router";
import type { ChatMessage } from "@repo/chat-core/types";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * An Ask Frapp answer posted to a channel, on the phone (#4713): what every
 * reader of the channel is shown, and what each chip does for them.
 */

const hooks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useDocumentDownloadUrl: () => ({ mutateAsync: hooks.download }),
}));

import { AskAnswerCard } from "./ask-answer-card";

const PAYLOAD = {
  v: 1,
  ask_id: "ask-1",
  asked_by: "user-sam",
  question: "What is quorum, and what do I owe?",
  citations: [{ source: 0, at: 15 }],
  sources: [
    {
      kind: "meeting",
      title: "Chapter meeting",
      detail: null,
      date: "2026-11-09T12:00:00Z",
      target: { type: "meeting", meeting_id: "m1" },
    },
    {
      kind: "tasks",
      title: "Your tasks",
      detail: null,
      date: null,
      target: null,
      own: true,
    },
  ],
};

const message = (over: Partial<ChatMessage> = {}) =>
  ({
    id: "msg-1",
    channel_id: "chan-1",
    kind: "ask_answer",
    content: "Quorum is half.",
    payload: PAYLOAD,
    ...over,
  }) as ChatMessage;

const names = (id: string) => (id === "user-sam" ? "Sam Abernathy" : null);

function render(
  row: ChatMessage,
  nameFor: (id: string) => string | null = names,
): ReactTestRenderer {
  let rendered!: ReactTestRenderer;
  act(() => {
    rendered = create(
      <FrappThemeProvider>
        <AskAnswerCard message={row} nameFor={nameFor as never} />
      </FrappThemeProvider>,
    );
  });
  return rendered;
}

const buttons = (rendered: ReactTestRenderer) =>
  rendered.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityRole === "button",
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a posted Ask answer", () => {
  it("says who asked and what, then the answer with its sources", () => {
    const text = screenText(render(message()));
    expect(text).toContain("Sam Abernathy asked Frapp");
    expect(text).toContain("What is quorum, and what do I owe?");
    expect(text).toContain("Quorum is half.");
    expect(text).toContain("Chapter meeting");
  });

  it("names the asker's own records as theirs, and opens nothing for them", () => {
    const rendered = render(message());
    const text = screenText(rendered);
    expect(text).toContain("Sam Abernathy's tasks");
    expect(text).not.toContain("Your tasks");
    // One chip opens: the minutes. The asker's tasks are a name only.
    expect(buttons(rendered)).toHaveLength(1);
  });

  it("opens a source's own screen from its chip", () => {
    const rendered = render(message());
    act(() => buttons(rendered)[0]!.props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith(
      "/minutes-details?id=m1",
    );
  });

  it("says some sources may not open when one was not open to everyone", () => {
    const limited = {
      ...PAYLOAD,
      sources: [{ ...PAYLOAD.sources[0]!, limited: true }],
    };
    expect(
      screenText(render(message({ payload: limited as never }))),
    ).toContain("Some of these may not open for you.");
    expect(screenText(render(message()))).not.toContain(
      "Some of these may not open for you.",
    );
  });

  it("falls back to a member when the roster can't name the asker", () => {
    const text = screenText(render(message(), () => null));
    expect(text).toContain("asked Frapp");
    expect(text).not.toContain("user-sam");
  });

  it("draws the answer's words alone for a payload it can't read", () => {
    const text = screenText(render(message({ payload: { v: 1 } as never })));
    expect(text).toContain("Quorum is half.");
    expect(text).not.toContain("asked Frapp");
  });
});
