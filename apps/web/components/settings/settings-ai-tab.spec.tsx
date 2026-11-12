import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: undefined as Record<string, unknown> | null | undefined,
  update: vi.fn(),
  toast: vi.fn(),
  offline: false,
  saving: false,
}));

const SHEET = {
  version: 1,
  providers: [
    { key: "anthropic", name: "Anthropic" },
    { key: "google", name: "Google" },
  ],
  data: [],
};

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAiChapterSettings: () => ({
    data: state.settings,
    isPending: state.settings === undefined,
    isError: false,
    fetchStatus: "idle",
    refetch: vi.fn(),
  }),
  useAiConsent: () => ({
    data: { sheet: SHEET, answer: null, answered_at: null, sheet_changed: false },
  }),
  useUpdateAiChapterSettings: () => ({
    mutateAsync: state.update,
    isPending: state.saving,
    variables: undefined,
  }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: state.toast }),
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: state.offline, probeOnce: vi.fn() }),
}));

const { SettingsAiTab } = await import("./settings-ai-tab");

const settings = (overrides: Record<string, unknown> = {}) => ({
  ask: false,
  meeting_notes: false,
  chat_source: false,
  updated_at: null,
  can_change: true,
  ...overrides,
});

/**
 * Chapter settings → AI (#4308): a president of a 100-member chapter turning
 * on minutes from notes for the officers, and every other officer seeing
 * what is on without being able to change it.
 */
describe("the chapter's AI switches", () => {
  beforeEach(() => {
    state.update.mockReset().mockResolvedValue(settings());
    state.toast.mockReset();
    state.offline = false;
    state.saving = false;
  });

  it("names who the chapter's information goes to", () => {
    state.settings = settings();
    render(<SettingsAiTab />);
    expect(
      screen.getByText(/send chapter information to anthropic and google/i),
    ).toBeInTheDocument();
  });

  it("lets the president turn a feature on, and says so", async () => {
    const user = userEvent.setup();
    state.settings = settings();
    render(<SettingsAiTab />);
    await user.click(screen.getByRole("switch", { name: /minutes from notes/i }));
    expect(state.update).toHaveBeenCalledWith({ meeting_notes: true });
    expect(state.toast).toHaveBeenCalledWith({
      title: "Minutes from notes turned on",
    });
  });

  it("draws every switch read-only for an officer who isn't the president", () => {
    state.settings = settings({ can_change: false, meeting_notes: true });
    render(<SettingsAiTab />);
    for (const control of screen.getAllByRole("switch")) {
      expect(control).toBeDisabled();
    }
    expect(
      screen.getByRole("switch", { name: /minutes from notes/i }),
    ).toBeChecked();
    expect(
      screen.getByText(/only the chapter president can turn these on or off/i),
    ).toBeInTheDocument();
  });

  it("keeps channel messages waiting until Ask is on", () => {
    state.settings = settings();
    const { rerender } = render(<SettingsAiTab />);
    expect(
      screen.getByRole("switch", { name: /include channel messages/i }),
    ).toBeDisabled();
    expect(screen.getByText(/turn on ask frapp first/i)).toBeInTheDocument();

    state.settings = settings({ ask: true });
    rerender(<SettingsAiTab />);
    expect(
      screen.getByRole("switch", { name: /include channel messages/i }),
    ).toBeEnabled();
  });

  it("puts the switch back and says why when the save is refused", async () => {
    const user = userEvent.setup();
    state.settings = settings();
    state.update.mockRejectedValue({
      statusCode: 403,
      code: "ai.settings.president_only",
    });
    render(<SettingsAiTab />);
    await user.click(screen.getByRole("switch", { name: /ask frapp/i }));
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Couldn't change the AI setting",
        description:
          "Only your chapter's president can turn AI features on or off.",
        variant: "destructive",
      }),
    );
    expect(screen.getByRole("switch", { name: /ask frapp/i })).not.toBeChecked();
  });

  it("can't be changed offline", () => {
    state.settings = settings();
    state.offline = true;
    render(<SettingsAiTab />);
    expect(
      screen.getByRole("switch", { name: /minutes from notes/i }),
    ).toBeDisabled();
  });

  it("still lets the president turn channel messages off after Ask went off", async () => {
    const user = userEvent.setup();
    state.settings = settings({ ask: false, chat_source: true });
    render(<SettingsAiTab />);
    const nested = screen.getByRole("switch", {
      name: /include channel messages/i,
    });
    expect(nested).toBeChecked();
    expect(nested).toBeEnabled();
    expect(screen.queryByText(/turn on ask frapp first/i)).toBeNull();
    await user.click(nested);
    expect(state.update).toHaveBeenCalledWith({ chat_source: false });
  });

  it("holds every switch while one saves", () => {
    state.settings = settings();
    state.saving = true;
    render(<SettingsAiTab />);
    for (const control of screen.getAllByRole("switch")) {
      expect(control).toBeDisabled();
    }
  });
});
