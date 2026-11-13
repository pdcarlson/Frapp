import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  consent: undefined as Record<string, unknown> | null | undefined,
  turnOn: vi.fn(),
  notNow: vi.fn(),
  toast: vi.fn(),
  offline: false,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAiConsent: () => ({
    data: state.consent,
    isPending: false,
    isError: false,
    fetchStatus: "idle",
    refetch: vi.fn(),
  }),
  useFrappAiChoice: () => ({
    consent: state.consent,
    consentFailed: false,
    readConsent: () => Promise.resolve(state.consent ?? null),
    providers: ["Anthropic", "Google"],
    forChapter: false,
    turnOn: state.turnOn,
    notNow: state.notNow,
    pending: false,
  }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: state.toast }),
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: state.offline, probeOnce: vi.fn() }),
}));

const { AiSection } = await import("./ai-section");

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

/**
 * Settings → Frapp AI (#4790): one switch. On opens Meet Frapp AI, where
 * the companies are named; off is immediate.
 */
describe("the member's Frapp AI switch in Settings", () => {
  beforeEach(() => {
    state.turnOn.mockReset().mockResolvedValue(true);
    state.notNow.mockReset().mockResolvedValue(undefined);
    state.toast.mockReset();
    state.offline = false;
  });

  it("shows it off until the member said yes, and names the companies", () => {
    state.consent = consent();
    render(<AiSection />);
    expect(screen.getByRole("switch", { name: "Frapp AI" })).not.toBeChecked();
    expect(
      screen.getByText("Works with Anthropic and Google."),
    ).toBeInTheDocument();
  });

  it("turning it on opens Meet Frapp AI, and Continue there turns it on", async () => {
    const user = userEvent.setup();
    state.consent = consent({ answer: "no" });
    render(<AiSection />);
    await user.click(screen.getByRole("switch", { name: "Frapp AI" }));
    expect(state.turnOn).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Meet Frapp AI");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(state.turnOn).toHaveBeenCalledTimes(1);
    expect(state.toast).toHaveBeenCalledWith({ title: "Frapp AI is on" });
  });

  it("turning it off records a No at once", async () => {
    const user = userEvent.setup();
    state.consent = consent({ answer: "yes" });
    render(<AiSection />);
    const control = screen.getByRole("switch", { name: "Frapp AI" });
    expect(control).toBeChecked();
    await user.click(control);
    expect(state.notNow).toHaveBeenCalledTimes(1);
    expect(state.toast).toHaveBeenCalledWith({ title: "Frapp AI is off" });
  });

  it("says why when turning it off can't be saved", async () => {
    const user = userEvent.setup();
    state.consent = consent({ answer: "yes" });
    state.notNow.mockRejectedValue({ statusCode: 500 });
    render(<AiSection />);
    await user.click(screen.getByRole("switch", { name: "Frapp AI" }));
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't turn off Frapp AI",
        variant: "destructive",
      }),
    );
  });

  it("can't be changed offline", () => {
    state.consent = consent();
    state.offline = true;
    render(<AiSection />);
    expect(screen.getByRole("switch", { name: "Frapp AI" })).toBeDisabled();
  });

  it("draws nothing on a server with no AI", () => {
    state.consent = null;
    const { container } = render(<AiSection />);
    expect(container).toBeEmptyDOMElement();
  });
});
