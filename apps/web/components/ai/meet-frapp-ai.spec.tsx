import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  consent: undefined as Record<string, unknown> | null | undefined,
  forChapter: false,
  turnOn: vi.fn(),
  notNow: vi.fn(),
  readError: null as unknown,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useFrappAiChoice: () => ({
    consent: state.consent,
    consentFailed: false,
    readConsent: () =>
      state.readError
        ? Promise.reject(state.readError)
        : Promise.resolve(state.consent ?? null),
    providers: ["Anthropic", "Google"],
    forChapter: state.forChapter,
    turnOn: state.turnOn,
    notNow: state.notNow,
    pending: false,
  }),
}));

const { useAiConsentGate } = await import("./meet-frapp-ai");

const consent = (overrides: Record<string, unknown> = {}) => ({
  sheet: {
    version: 2,
    providers: [
      { key: "anthropic", name: "Anthropic" },
      { key: "google", name: "Google" },
    ],
    data: [],
  },
  answer: null,
  answered_at: null,
  sheet_changed: false,
  ...overrides,
});

/** A screen with one AI entry point, as Ask has. */
function Entry({ onResult }: { onResult: (ok: boolean) => void }) {
  const { ensureConsent, consentDialog } = useAiConsentGate();
  return (
    <>
      <button
        type="button"
        onClick={() => void ensureConsent().then(onResult)}
      >
        Ask
      </button>
      {consentDialog}
    </>
  );
}

/**
 * Meet Frapp AI at an AI entry point (#4790): a member who chose Not now
 * reaches for Ask and is offered the same screen once more.
 */
describe("Meet Frapp AI at an AI entry point", () => {
  beforeEach(() => {
    state.turnOn.mockReset();
    state.notNow.mockReset();
    state.readError = null;
    state.forChapter = false;
  });

  it("goes straight through for a member who has Frapp AI on", async () => {
    const user = userEvent.setup();
    state.consent = consent({ answer: "yes" });
    const onResult = vi.fn();
    render(<Entry onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says what it does in three lines and names the companies in one", async () => {
    const user = userEvent.setup();
    state.consent = consent({ answer: "no" });
    render(<Entry onResult={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Meet Frapp AI");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(dialog).toHaveTextContent(
      "Frapp AI works with Anthropic and Google. Continuing turns it on for your account.",
    );
    expect(
      screen.getByRole("link", { name: "Privacy policy" }),
    ).toHaveAttribute("href", expect.stringMatching(/\/privacy$/));
  });

  it("tells a president whose chapter never set its switches that Continue turns it on for the chapter too", async () => {
    const user = userEvent.setup();
    state.consent = consent();
    state.forChapter = true;
    render(<Entry onResult={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Continuing turns it on for you and your chapter.",
    );
  });

  it("turns it on with Continue, and lets the feature go ahead", async () => {
    const user = userEvent.setup();
    state.consent = consent();
    state.turnOn.mockResolvedValue(true);
    const onResult = vi.fn();
    render(<Entry onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(state.turnOn).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it("records Not now, which stops the feature", async () => {
    const user = userEvent.setup();
    state.consent = consent();
    state.notNow.mockResolvedValue(undefined);
    const onResult = vi.fn();
    render(<Entry onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    expect(state.notNow).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("treats closing it as no answer, so nothing is recorded", async () => {
    const user = userEvent.setup();
    state.consent = consent();
    const onResult = vi.fn();
    render(<Entry onResult={onResult} />);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await screen.findByRole("dialog");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(state.turnOn).not.toHaveBeenCalled();
    expect(state.notNow).not.toHaveBeenCalled();
  });

  it("stays open with the reason when Continue can't be saved", async () => {
    const user = userEvent.setup();
    state.consent = consent();
    state.turnOn.mockRejectedValue({ statusCode: 503 });
    render(<Entry onResult={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Ask" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent(/try again/i),
    );
  });

  it("does nothing on a server with no AI", async () => {
    state.consent = null;
    const onResult = vi.fn();
    render(<Entry onResult={onResult} />);
    await act(async () => {
      screen.getByRole("button", { name: "Ask" }).click();
    });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("rejects, rather than reading as a No, when the answer can't be read", async () => {
    state.consent = undefined;
    state.readError = { statusCode: 503 };
    const onResult = vi.fn();
    const onFailure = vi.fn();
    function FailingEntry() {
      const { ensureConsent, consentDialog } = useAiConsentGate();
      return (
        <>
          <button
            type="button"
            onClick={() => void ensureConsent().then(onResult, onFailure)}
          >
            Ask
          </button>
          {consentDialog}
        </>
      );
    }
    render(<FailingEntry />);
    await act(async () => {
      screen.getByRole("button", { name: "Ask" }).click();
    });
    await waitFor(() =>
      expect(onFailure).toHaveBeenCalledWith({ statusCode: 503 }),
    );
    expect(onResult).not.toHaveBeenCalled();
  });
});
