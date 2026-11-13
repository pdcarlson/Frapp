import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASK_COPY, askSavedLine } from "@repo/validation";

/**
 * The Ask panel's own rules: consent before the first question leaves, and
 * the saved notice shown before a question may be kept (#4315).
 */

const state = vi.hoisted(() => ({
  ask: vi.fn(),
  retry: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
  refetchStatus: vi.fn(),
  exchanges: [] as unknown[],
  savedUntil: null as string | null,
  consent: vi.fn(),
  permissions: ["ai:use", "ai:act"],
  actions: null as string[] | null,
  suggestions: [] as Array<{ kind: string; text: string; request: boolean }>,
  suggestionsEnabled: [] as boolean[],
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAsk: () => ({
    exchanges: state.exchanges,
    working: state.exchanges.some(
      (exchange) => (exchange as { phase: string }).phase === "working",
    ),
    ask: state.ask,
    retry: state.retry,
    setProposal: vi.fn(),
    resolveProposal: vi.fn(),
    stop: state.stop,
    reset: state.reset,
  }),
  useActStatus: () => ({ data: state.actions }),
  useAskSuggestions: (options?: { enabled?: boolean }) => {
    state.suggestionsEnabled.push(options?.enabled ?? true);
    return { suggestions: state.suggestions };
  },
  useActEventAudience: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMyPermissions: () => ({ data: { permissions: state.permissions } }),
  useAskStatus: () => ({
    refetch: state.refetchStatus,
    data: {
      saved_until: state.savedUntil,
      diagnostics: {
        offered: false,
        can_change: false,
        ends_at: state.savedUntil,
      },
    },
  }),
}));

vi.mock("@/components/ai/ai-consent-sheet", () => ({
  useAiConsentGate: () => ({
    ensureConsent: state.consent,
    consentDialog: null,
  }),
}));

const { AskPanel } = await import("./ask-panel");

const open = (isOpen = true) =>
  render(<AskPanel open={isOpen} onOpenChange={() => undefined} />);

const DONE = {
  id: "turn-1",
  question: "When is the budget vote?",
  phase: "done",
  step: null,
  preview: "",
  failure: null,
  proposal: null,
  resolution: null,
  answer: {
    status: "answered",
    reason: null,
    text: "The budget vote is in the minutes.",
    citations: [],
    sources: [
      {
        id: "s1",
        kind: "meeting_minutes",
        title: "Chapter meeting",
        detail: null,
        date: "2026-11-09T00:00:00.000Z",
        target: { type: "meeting", meeting_id: "m1" },
      },
    ],
    left_out_messages: 0,
    unverified_citations: 0,
    truncated: false,
    saved: false,
  },
};

/** What a question is sent with, for a member Frapp cannot act for. */
const sent = (over: Record<string, unknown> = {}) => ({
  savedNoticeShown: false,
  actions: false,
  gate: state.consent,
  ...over,
});

describe("AskPanel", () => {
  beforeEach(() => {
    state.ask.mockReset().mockResolvedValue(undefined);
    state.retry.mockReset().mockResolvedValue(undefined);
    state.stop.mockReset();
    state.reset.mockReset();
    state.refetchStatus.mockReset();
    state.consent.mockReset().mockResolvedValue(true);
    state.exchanges = [];
    state.savedUntil = null;
    state.permissions = ["ai:use"];
    state.actions = null;
    state.suggestions = [];
    state.suggestionsEnabled = [];
  });

  it("sends what was typed on Enter, behind the consent gate, and clears the field", async () => {
    open();
    const field = screen.getByRole("textbox", { name: ASK_COPY.placeholder });
    await userEvent.setup().type(field, "Who is the treasurer?{Enter}");
    // The gate is the hook's to run: the question is on screen first, and
    // nothing leaves for a member who says no (`use-ask.spec.tsx`).
    expect(state.ask).toHaveBeenCalledWith("Who is the treasurer?", sent());
    expect(field).toHaveValue("");
  });

  describe("what it opens with (#4700)", () => {
    const EVENT = {
      kind: "event",
      text: "When and where is Formal on Friday?",
      request: false,
    };
    const REQUEST = {
      kind: "request",
      text: "Make a task for me to get ready for Sunday's event, due Saturday",
      request: true,
    };

    it("offers what the server built from the member's own account, and no preset", () => {
      state.suggestions = [EVENT];
      open();
      expect(
        screen.getAllByRole("button").map((button) => button.textContent),
      ).toContain(EVENT.text);
      // Nothing but the server's list is ever offered.
      expect(screen.getAllByRole("listitem")).toHaveLength(1);
    });

    it("opens plain for a member with nothing to ask about: the two lines and the field", () => {
      open();
      expect(screen.getByText(ASK_COPY.empty_title)).toBeInTheDocument();
      expect(screen.queryByRole("list")).toBeNull();
      expect(
        screen.getByRole("textbox", { name: ASK_COPY.placeholder }),
      ).toBeInTheDocument();
    });

    it("reads them only once the panel is open", () => {
      const view = open(false);
      expect(state.suggestionsEnabled.every((enabled) => !enabled)).toBe(true);
      view.unmount();
      state.suggestionsEnabled = [];
      open();
      expect(state.suggestionsEnabled.at(-1)).toBe(true);
    });

    it("sends a tapped question as a suggestion, never as words the member typed", async () => {
      state.permissions = ["ai:use", "ai:act"];
      state.suggestions = [EVENT, REQUEST];
      open();
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: EVENT.text }));
      expect(state.ask).toHaveBeenCalledWith(
        EVENT.text,
        sent({ actions: true, suggested: true }),
      );
    });

    it("sends the one request like typed words, so it comes back as a card", async () => {
      state.permissions = ["ai:use", "ai:act"];
      state.suggestions = [EVENT, REQUEST];
      open();
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: REQUEST.text }));
      expect(state.ask).toHaveBeenCalledWith(
        REQUEST.text,
        sent({ actions: true, suggested: false }),
      );
    });
  });

  it("reads whether answers are being saved again each time it opens", () => {
    const { rerender } = render(
      <AskPanel open={false} onOpenChange={vi.fn()} />,
    );
    expect(state.refetchStatus).not.toHaveBeenCalled();
    rerender(<AskPanel open onOpenChange={vi.fn()} />);
    expect(state.refetchStatus).toHaveBeenCalledTimes(1);
  });

  it("shows the saved line while answers are kept, and only then says it was shown", async () => {
    state.savedUntil = "2026-11-26T12:00:00.000Z";
    open();
    expect(
      screen.getByText(askSavedLine("November 26, 2026")),
    ).toBeInTheDocument();
    await userEvent
      .setup()
      .type(
        screen.getByRole("textbox", { name: ASK_COPY.placeholder }),
        "Who is the treasurer?{Enter}",
      );
    expect(state.ask).toHaveBeenCalledWith(
      "Who is the treasurer?",
      sent({ savedNoticeShown: true }),
    );
  });

  it("says nothing under the field, and nothing about saving when nothing is kept", () => {
    open();
    expect(screen.queryByText(/answered on its own/)).toBeNull();
    expect(screen.queryByText(/saved for the Frapp team/)).toBeNull();
  });

  it("takes no second question while one is being answered", async () => {
    state.exchanges = [
      { ...DONE, phase: "working", step: "searching", answer: null },
    ];
    open();
    await userEvent
      .setup()
      .type(
        screen.getByRole("textbox", { name: ASK_COPY.placeholder }),
        "Second?{Enter}",
      );
    expect(state.ask).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: ASK_COPY.send })).toBeDisabled();
  });

  describe("one conversation", () => {
    const SECOND = {
      ...DONE,
      id: "turn-2",
      question: "And who ran it?",
      answer: { ...DONE.answer, text: "Dana Reyes ran it.", sources: [] },
    };

    it("keeps every turn on screen, in order, with the field still under them", () => {
      state.exchanges = [DONE, SECOND];
      state.suggestions = [
        { kind: "event", text: "When and where is Formal on Friday?", request: false },
      ];
      open();
      const turns = screen.getAllByRole("article");
      expect(turns).toHaveLength(2);
      expect(turns[0]).toHaveTextContent("When is the budget vote?");
      expect(turns[1]).toHaveTextContent("Dana Reyes ran it.");
      expect(
        screen.getByRole("textbox", { name: ASK_COPY.placeholder }),
      ).toBeInTheDocument();
      // Suggestions are for an empty thread.
      expect(
        screen.queryByRole("button", { name: "When and where is Formal on Friday?" }),
      ).toBeNull();
    });

    it("starts a new conversation from the header, and offers that only once there is one", async () => {
      const view = open();
      expect(
        screen.queryByRole("button", { name: ASK_COPY.new_conversation }),
      ).toBeNull();
      view.unmount();
      state.exchanges = [DONE];
      open();
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: ASK_COPY.new_conversation }));
      expect(state.reset).toHaveBeenCalledTimes(1);
    });

    it("retries a failed turn in place, with what a question is sent with", async () => {
      state.exchanges = [
        {
          ...DONE,
          phase: "failed",
          answer: null,
          failure: { message: ASK_COPY.failed, retryable: true },
        },
      ];
      open();
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: ASK_COPY.try_again }));
      expect(state.retry).toHaveBeenCalledWith("turn-1", sent());
    });

    it("holds Try again on an earlier turn while another is being answered: asking again would drop it", () => {
      state.exchanges = [
        {
          ...DONE,
          phase: "failed",
          answer: null,
          failure: { message: ASK_COPY.failed, retryable: true },
        },
        { ...DONE, id: "turn-2", phase: "working", answer: null },
      ];
      open();
      expect(
        screen
          .getByRole("button", { name: ASK_COPY.try_again })
          .hasAttribute("disabled"),
      ).toBe(true);
    });

    it("opens the AI sheet again from a turn that was refused for it", async () => {
      state.exchanges = [
        {
          ...DONE,
          answer: {
            ...DONE.answer,
            status: "unavailable",
            reason: "consent_required",
            text: "",
            sources: [],
          },
        },
      ];
      open();
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: ASK_COPY.consent_action }));
      expect(state.retry).toHaveBeenCalledWith("turn-1", sent());
    });
  });

  describe("beside the page", () => {
    it("is not a dialog over the page: it marks the shell to make room while open", () => {
      const view = render(<AskPanel open onOpenChange={() => undefined} />);
      expect(
        screen.getByRole("complementary", { name: ASK_COPY.name }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.documentElement).toHaveAttribute("data-ask-open");
      view.rerender(<AskPanel open={false} onOpenChange={() => undefined} />);
      expect(document.documentElement).not.toHaveAttribute("data-ask-open");
      expect(screen.queryByRole("complementary")).toBeNull();
    });

    it("closes on Escape pressed inside it, and by its close button", async () => {
      const onOpenChange = vi.fn();
      render(<AskPanel open onOpenChange={onOpenChange} />);
      const user = userEvent.setup();
      // Focus starts in the field.
      expect(
        screen.getByRole("textbox", { name: ASK_COPY.placeholder }),
      ).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(onOpenChange).toHaveBeenLastCalledWith(false);
      onOpenChange.mockClear();
      await user.click(screen.getByRole("button", { name: ASK_COPY.close }));
      expect(onOpenChange).toHaveBeenLastCalledWith(false);
    });

    it("leaves Escape to the page when focus is on the page", async () => {
      const onOpenChange = vi.fn();
      const onPageEscape = vi.fn();
      render(
        <>
          <input
            aria-label="Message"
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.defaultPrevented) {
                onPageEscape();
              }
            }}
          />
          <AskPanel open onOpenChange={onOpenChange} />
        </>,
      );
      const user = userEvent.setup();
      await user.click(screen.getByRole("textbox", { name: "Message" }));
      await user.keyboard("{Escape}");
      expect(onPageEscape).toHaveBeenCalledTimes(1);
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("drops a question still being answered when it closes, however it was closed, and keeps the turns before it", () => {
      state.exchanges = [
        DONE,
        { ...DONE, id: "turn-2", phase: "working", answer: null },
      ];
      const view = render(<AskPanel open onOpenChange={() => undefined} />);
      expect(state.stop).not.toHaveBeenCalled();
      // Closed from outside, as the pill does.
      view.rerender(<AskPanel open={false} onOpenChange={() => undefined} />);
      expect(state.stop).toHaveBeenCalledTimes(1);
      expect(state.reset).not.toHaveBeenCalled();
    });

    it("keeps a finished answer across a close, and gives focus back to what opened it", () => {
      state.exchanges = [DONE];
      const opener = { current: null as HTMLButtonElement | null };
      const tree = (isOpen: boolean) => (
        <>
          <button ref={(node) => void (opener.current = node)}>Ask</button>
          <AskPanel
            open={isOpen}
            onOpenChange={() => undefined}
            returnFocus={opener}
          />
        </>
      );
      const view = render(tree(true));
      view.rerender(tree(false));
      expect(state.reset).not.toHaveBeenCalled();
      expect(state.stop).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Ask" })).toHaveFocus();
      view.rerender(tree(true));
      expect(
        screen.getByText("The budget vote is in the minutes."),
      ).toBeInTheDocument();
    });

    it("gets out of the way of a followed source where there is no room for both", async () => {
      state.exchanges = [DONE];
      const onOpenChange = vi.fn();
      const matchMedia = vi.fn(() => ({ matches: false }));
      vi.stubGlobal("matchMedia", matchMedia);
      try {
        render(<AskPanel open onOpenChange={onOpenChange} />);
        const user = userEvent.setup();
        const source = screen.getByRole("link", { name: /Chapter meeting/ });
        source.addEventListener("click", (event) => event.preventDefault());
        await user.click(source);
        expect(onOpenChange).toHaveBeenLastCalledWith(false);
        // From `lg` up the shell has made room, so the answer stays.
        onOpenChange.mockClear();
        matchMedia.mockReturnValue({ matches: true });
        await user.click(source);
        expect(onOpenChange).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});

describe("a member Frapp can act for (#718)", () => {
  beforeEach(() => {
    state.ask.mockReset().mockResolvedValue(undefined);
    state.exchanges = [];
    state.savedUntil = null;
    state.permissions = ["ai:use", "ai:act"];
    state.actions = null;
    state.suggestions = [];
  });

  it("has no Ask and Do switch, whoever the member is: one field takes both", () => {
    state.actions = ["give_points", "create_task"];
    open();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("says Frapp can do things for them, and sends what they type as something that may end in a card", async () => {
    state.actions = ["create_task", "give_points"];
    open();
    expect(screen.getByText(new RegExp(ASK_COPY.empty_body_act))).toBeDefined();
    await userEvent
      .setup()
      .type(
        screen.getByRole("textbox", { name: ASK_COPY.placeholder }),
        "Give Jordan 5 points{Enter}",
      );
    expect(state.ask).toHaveBeenCalledWith(
      "Give Jordan 5 points",
      sent({ actions: true }),
    );
  });

  it("asks for a card on the permission alone: a request typed before the list of actions has loaded, or with none to list, is still read as one", async () => {
    for (const actions of [null, [] as string[]]) {
      state.ask.mockClear();
      state.actions = actions;
      const view = open();
      // The list only words the opening.
      expect(
        screen.queryByText(new RegExp(ASK_COPY.empty_body_act)),
      ).toBeNull();
      await userEvent
        .setup()
        .type(
          screen.getByRole("textbox", { name: ASK_COPY.placeholder }),
          "Give Jordan 5 points{Enter}",
        );
      expect(state.ask).toHaveBeenCalledWith(
        "Give Jordan 5 points",
        sent({ actions: true }),
      );
      view.unmount();
    }
  });

  it("answers only, for a member who does not hold the permission", async () => {
    state.permissions = ["ai:use"];
    open();
    expect(screen.queryByText(new RegExp(ASK_COPY.empty_body_act))).toBeNull();
    await userEvent
      .setup()
      .type(
        screen.getByRole("textbox", { name: ASK_COPY.placeholder }),
        "Give Jordan 5 points{Enter}",
      );
    expect(state.ask).toHaveBeenCalledWith("Give Jordan 5 points", sent());
  });
});
