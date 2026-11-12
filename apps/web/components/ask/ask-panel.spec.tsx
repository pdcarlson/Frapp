import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACT_COPY, ASK_COPY, askSavedLine } from "@repo/validation";

/**
 * The Ask panel's own rules: consent before the first question leaves, and
 * the saved notice shown before a question may be kept (#4315).
 */

const state = vi.hoisted(() => ({
  ask: vi.fn(),
  reset: vi.fn(),
  exchange: null as unknown,
  savedUntil: null as string | null,
  consent: vi.fn(),
  actions: null as string[] | null,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAsk: () => ({
    exchange: state.exchange,
    ask: state.ask,
    stop: vi.fn(),
    reset: state.reset,
  }),
  useActStatus: () => ({ data: state.actions }),
  useMyPermissions: () => ({ data: { permissions: ["ai:use", "ai:act"] } }),
  useAskStatus: () => ({
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

vi.mock("@/components/ask/act-pane", () => ({
  useActSession: () => ({ turn: null, setTurn: vi.fn(), latestRef: { current: 0 } }),
  ActPane: ({ actions }: { actions: string[] }) => (
    <p>Do pane: {actions.join(", ")}</p>
  ),
}));

const { AskPanel } = await import("./ask-panel");

const open = () => render(<AskPanel open onOpenChange={() => undefined} />);

const DONE = {
  question: "When is the budget vote?",
  phase: "done",
  step: null,
  preview: "",
  failure: null,
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

describe("AskPanel", () => {
  beforeEach(() => {
    state.ask.mockReset().mockResolvedValue(undefined);
    state.consent.mockReset().mockResolvedValue(true);
    state.exchange = null;
    state.savedUntil = null;
  });

  it("asks what was typed on Enter, and clears the field", async () => {
    open();
    const field = screen.getByRole("textbox", { name: ASK_COPY.placeholder });
    await userEvent.setup().type(field, "Who is the treasurer?{Enter}");
    expect(state.ask).toHaveBeenCalledWith("Who is the treasurer?", {
      savedNoticeShown: false,
    });
    expect(field).toHaveValue("");
  });

  it("asks an example when it is picked", async () => {
    open();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: ASK_COPY.examples[0] }));
    expect(state.ask).toHaveBeenCalledWith(ASK_COPY.examples[0], {
      savedNoticeShown: false,
    });
  });

  it("sends nothing for a member who does not say yes, and says what to do", async () => {
    state.consent.mockResolvedValue(false);
    open();
    await userEvent
      .setup()
      .type(
        screen.getByRole("textbox", { name: ASK_COPY.placeholder }),
        "Who is the treasurer?{Enter}",
      );
    expect(state.ask).not.toHaveBeenCalled();
    expect(
      await screen.findByText(ASK_COPY.unavailable.consent_required),
    ).toBeInTheDocument();
    expect(screen.getByText("Who is the treasurer?")).toBeInTheDocument();
  });

  it("says so when it could not check the member's answer", async () => {
    state.consent.mockRejectedValue(new TypeError("Failed to fetch"));
    open();
    await userEvent
      .setup()
      .type(
        screen.getByRole("textbox", { name: ASK_COPY.placeholder }),
        "Who is the treasurer?{Enter}",
      );
    expect(state.ask).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("button", { name: ASK_COPY.try_again }),
    ).toBeInTheDocument();
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
    expect(state.ask).toHaveBeenCalledWith("Who is the treasurer?", {
      savedNoticeShown: true,
    });
  });

  it("says each question stands alone when nothing is kept", () => {
    open();
    expect(screen.getByText(ASK_COPY.single_shot)).toBeInTheDocument();
    expect(screen.queryByText(/saved for the Frapp team/)).toBeNull();
  });

  it("takes no second question while one is being answered", async () => {
    state.exchange = {
      question: "First?",
      phase: "working",
      step: "searching",
      preview: "",
      answer: null,
      failure: null,
    };
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

    it("drops a question still being answered when it closes, however it was closed", () => {
      state.exchange = { ...DONE, phase: "working", answer: null };
      state.reset.mockClear();
      const view = render(<AskPanel open onOpenChange={() => undefined} />);
      expect(state.reset).not.toHaveBeenCalled();
      // Closed from outside, as the pill does.
      view.rerender(<AskPanel open={false} onOpenChange={() => undefined} />);
      expect(state.reset).toHaveBeenCalledTimes(1);
    });

    it("keeps a finished answer across a close, and gives focus back to what opened it", () => {
      state.exchange = DONE;
      state.reset.mockClear();
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
      expect(screen.getByRole("button", { name: "Ask" })).toHaveFocus();
      view.rerender(tree(true));
      expect(
        screen.getByText("The budget vote is in the minutes."),
      ).toBeInTheDocument();
    });

    it("gets out of the way of a followed source where there is no room for both", async () => {
      state.exchange = DONE;
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

describe("Ask and Do (#718)", () => {
  beforeEach(() => {
    state.exchange = null;
    state.actions = null;
  });

  it("shows no switch to a member who cannot have Ask take actions", () => {
    open();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByPlaceholderText(ASK_COPY.placeholder)).toBeDefined();
  });

  it("shows no switch when the member holds the permission but no action", () => {
    state.actions = [];
    open();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  });

  it("opens on Ask, and Do swaps the question field for the request pane", async () => {
    state.actions = ["give_points", "create_task"];
    open();
    expect(
      screen
        .getByRole("radio", { name: ACT_COPY.mode_ask })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByPlaceholderText(ASK_COPY.placeholder)).toBeDefined();

    await userEvent.click(
      screen.getByRole("radio", { name: ACT_COPY.mode_do }),
    );
    expect(screen.getByText("Do pane: give_points, create_task")).toBeDefined();
    expect(screen.queryByPlaceholderText(ASK_COPY.placeholder)).toBeNull();

    await userEvent.click(
      screen.getByRole("radio", { name: ACT_COPY.mode_ask }),
    );
    expect(screen.getByPlaceholderText(ASK_COPY.placeholder)).toBeDefined();
  });
});
