import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  consent: undefined as Record<string, unknown> | null | undefined,
  answer: vi.fn(),
  toast: vi.fn(),
  offline: false,
}));

const SHEET = {
  version: 2,
  providers: [
    { key: "anthropic", name: "Anthropic" },
    { key: "google", name: "Google" },
  ],
  data: [{ key: "questions", label: "Questions you ask" }],
};

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAiConsent: () => ({
    data: state.consent,
    isPending: false,
    isError: false,
    fetchStatus: "idle",
    refetch: vi.fn(),
  }),
  useAnswerAiConsent: () => ({ mutateAsync: state.answer, isPending: false }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: state.toast }),
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: state.offline, probeOnce: vi.fn() }),
}));

const { AiSection } = await import("./ai-section");

const consent = (overrides: Record<string, unknown> = {}) => ({
  sheet: SHEET,
  answer: null,
  answered_at: null,
  sheet_changed: false,
  ...overrides,
});

/**
 * Settings → AI (#4308): a member changing their answer on the AI sheet
 * weeks after they first saw it, with the same rows in front of them.
 */
describe("the member's AI answer in Settings", () => {
  beforeEach(() => {
    state.answer.mockReset().mockResolvedValue(consent());
    state.toast.mockReset();
    state.offline = false;
  });

  it("shows an unanswered sheet as off, and says it counts as no", () => {
    state.consent = consent();
    render(<AiSection />);
    expect(
      screen.getByRole("switch", { name: "Use AI features" }),
    ).not.toBeChecked();
    expect(screen.getByText(/haven't answered yet/i)).toBeInTheDocument();
    expect(screen.getByText("Anthropic and Google")).toBeInTheDocument();
    expect(screen.getByText("Questions you ask")).toBeInTheDocument();
  });

  it("turning it on records a Yes for the sheet shown", async () => {
    const user = userEvent.setup();
    state.consent = consent();
    render(<AiSection />);
    await user.click(screen.getByRole("switch", { name: "Use AI features" }));
    expect(state.answer).toHaveBeenCalledWith({
      sheet_version: 2,
      answer: "yes",
    });
    expect(state.toast).toHaveBeenCalledWith({
      title: "AI features are on for you",
    });
  });

  it("shows a Yes as on with its date, and turning it off records a No", async () => {
    const user = userEvent.setup();
    state.consent = consent({
      answer: "yes",
      answered_at: "2026-11-12T12:00:00.000Z",
    });
    render(<AiSection />);
    const control = screen.getByRole("switch", { name: "Use AI features" });
    expect(control).toBeChecked();
    expect(
      screen.getByText("You said yes on November 12, 2026."),
    ).toBeInTheDocument();
    await user.click(control);
    expect(state.answer).toHaveBeenCalledWith({
      sheet_version: 2,
      answer: "no",
    });
  });

  it("shows a No as off with its date", () => {
    state.consent = consent({
      answer: "no",
      answered_at: "2026-11-12T12:00:00.000Z",
    });
    render(<AiSection />);
    expect(
      screen.getByRole("switch", { name: "Use AI features" }),
    ).not.toBeChecked();
    expect(
      screen.getByText("You said no on November 12, 2026."),
    ).toBeInTheDocument();
  });

  it("says why when the answer can't be saved", async () => {
    const user = userEvent.setup();
    state.consent = consent();
    state.answer.mockRejectedValue({ statusCode: 500 });
    render(<AiSection />);
    await user.click(screen.getByRole("switch", { name: "Use AI features" }));
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't save your answer",
        variant: "destructive",
      }),
    );
  });

  it("can't be changed offline", () => {
    state.consent = consent();
    state.offline = true;
    render(<AiSection />);
    expect(
      screen.getByRole("switch", { name: "Use AI features" }),
    ).toBeDisabled();
  });

  it("draws nothing on a server with no AI", () => {
    state.consent = null;
    const { container } = render(<AiSection />);
    expect(container).toBeEmptyDOMElement();
  });
});
