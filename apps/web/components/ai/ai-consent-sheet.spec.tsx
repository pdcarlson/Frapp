import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  consent: undefined as Record<string, unknown> | null | undefined,
  answer: vi.fn(),
}));

const SHEET = {
  version: 3,
  providers: [
    { key: "anthropic", name: "Anthropic" },
    { key: "google", name: "Google" },
  ],
  data: [
    { key: "questions", label: "Questions you ask" },
    {
      key: "channel_messages",
      label: "Your messages in chapter channels. Never direct messages.",
    },
  ],
};

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAiConsent: () => ({
    data: state.consent,
    refetch: () => Promise.resolve({ data: state.consent }),
  }),
  useAnswerAiConsent: () => ({ mutateAsync: state.answer, isPending: false }),
}));

const { useAiConsentGate } = await import("./ai-consent-sheet");

const consent = (overrides: Record<string, unknown> = {}) => ({
  sheet: SHEET,
  answer: null,
  answered_at: null,
  sheet_changed: false,
  ...overrides,
});

/** A screen with one AI entry point, as minutes from notes will have. */
function Entry({ onResult }: { onResult: (ok: boolean) => void }) {
  const { ensureConsent, consentDialog } = useAiConsentGate();
  return (
    <>
      <button
        type="button"
        onClick={() => void ensureConsent().then(onResult)}
      >
        Draft minutes
      </button>
      {consentDialog}
    </>
  );
}

/**
 * The member's AI sheet (#4308, Apple 5.1.2(i)): an officer reaching for
 * "Draft minutes" the first time is asked once, with a real No.
 */
describe("the AI sheet", () => {
  beforeEach(() => {
    state.answer.mockReset();
  });

  it("goes straight through for a member who said yes", async () => {
    const user = userEvent.setup();
    state.consent = consent({ answer: "yes" });
    const onResult = vi.fn();
    render(<Entry onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Draft minutes" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("names every provider and every kind of data from the server's sheet", async () => {
    const user = userEvent.setup();
    state.consent = consent();
    render(<Entry onResult={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Draft minutes" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Use AI features in Frapp?");
    expect(dialog).toHaveTextContent("Anthropic and Google");
    expect(dialog).toHaveTextContent("Questions you ask");
    expect(dialog).toHaveTextContent("Never direct messages.");
    expect(dialog).toHaveTextContent(/minutes that name you/i);
  });

  it("records a Yes for the version shown, and lets the feature go ahead", async () => {
    const user = userEvent.setup();
    state.consent = consent();
    state.answer.mockResolvedValue(consent({ answer: "yes" }));
    const onResult = vi.fn();
    render(<Entry onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Draft minutes" }));
    await user.click(await screen.findByRole("button", { name: "Yes, use AI" }));
    expect(state.answer).toHaveBeenCalledWith({
      sheet_version: 3,
      answer: "yes",
    });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it("has a real No, recorded, which stops the feature", async () => {
    const user = userEvent.setup();
    state.consent = consent();
    state.answer.mockResolvedValue(consent({ answer: "no" }));
    const onResult = vi.fn();
    render(<Entry onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Draft minutes" }));
    await user.click(await screen.findByRole("button", { name: "No" }));
    expect(state.answer).toHaveBeenCalledWith({
      sheet_version: 3,
      answer: "no",
    });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("treats closing it as no answer, so nothing is recorded", async () => {
    const user = userEvent.setup();
    state.consent = consent();
    const onResult = vi.fn();
    render(<Entry onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Draft minutes" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(state.answer).not.toHaveBeenCalled();
  });

  it("says the sheet changed when an earlier answer no longer counts", async () => {
    const user = userEvent.setup();
    state.consent = consent({ sheet_changed: true });
    render(<Entry onResult={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Draft minutes" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      /earlier answer no longer counts/i,
    );
  });

  it("keeps the sheet open with the reason when the answer can't be saved", async () => {
    const user = userEvent.setup();
    state.consent = consent();
    state.answer.mockRejectedValue({
      statusCode: 409,
      code: "ai.consent.stale_sheet",
    });
    render(<Entry onResult={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Draft minutes" }));
    await user.click(await screen.findByRole("button", { name: "Yes, use AI" }));
    expect(
      await screen.findByText(/has changed since you opened this/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does nothing on a server with no AI", async () => {
    state.consent = null;
    const onResult = vi.fn();
    render(<Entry onResult={onResult} />);
    await act(async () => {
      screen.getByRole("button", { name: "Draft minutes" }).click();
    });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
