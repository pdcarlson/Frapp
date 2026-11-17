import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

/**
 * Unsaved drafts outlive a tab switch (#3272).
 *
 * `TabsContent` carries no `forceMount`, so Radix unmounts the tab an officer
 * leaves. The Accent draft and the rollover form are held by the page
 * (`useAccentDraft`, `useRolloverForm`) for exactly that reason; moving either
 * hook into its tab component would compile, pass every other settings spec,
 * and silently wipe a half-typed colour or semester on the first glance at
 * another tab.
 */

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

vi.mock("@repo/hooks", async () =>
  (await import("@/tests/settings-harness")).settingsHooks({
    currentChapter: () => mockCurrentChapter(),
    permissions: () => ["*"],
  }),
);

vi.mock("@/lib/stores/chapter-store", async () =>
  (await import("@/tests/settings-harness")).chapterStore(),
);

vi.mock("next/navigation", async () =>
  (await import("@/tests/settings-harness")).navigation(),
);

vi.mock("@/components/shared/can", async () =>
  (await import("@/tests/settings-harness")).canPassThrough(),
);

vi.mock("@/lib/hooks/use-toast", async () =>
  (await import("@/tests/settings-harness")).toastStub(),
);

const { SettingsPage } = await import("./settings-page");

const chapter = chapterSubscription(mockCurrentChapter);

describe("the Settings page keeps unsaved drafts across tab switches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  it("keeps a typed accent draft", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: /^chapter$/i }));
    const hex = screen.getByLabelText(/accent color hex value/i);
    await user.clear(hex);
    await user.type(hex, "#5AA9E6");

    await user.click(screen.getByRole("tab", { name: /^privacy$/i }));
    expect(screen.queryByLabelText(/accent color hex value/i)).toBeNull();
    await user.click(screen.getByRole("tab", { name: /^chapter$/i }));

    expect(screen.getByLabelText(/accent color hex value/i)).toHaveValue(
      "#5AA9E6",
    );
  });

  it("keeps a picked organization swatch as the draft", async () => {
    // The page passes the chapter's name so its organization's colors lead
    // the swatches, and a pick writes the same draft the hex field edits.
    // Dropping either prop compiles and leaves every swatch spec passing.
    mockCurrentChapter.mockReturnValue({
      data: {
        subscription_status: "active",
        past_due_since: null,
        name: "Phi Gamma Delta",
        accent_color: "#1D2F6F",
      },
      isPending: false,
      isError: false,
    });
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: /^chapter$/i }));
    const org = screen.getByRole("group", {
      name: "Your organization's colors",
    });
    const purple = within(org).getByRole("button", { name: "Royal Purple" });
    expect(purple).toHaveAttribute("aria-pressed", "false");
    await user.click(purple);

    expect(screen.getByLabelText(/accent color hex value/i)).toHaveValue(
      "#4F2683",
    );
    expect(purple).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("tab", { name: /^privacy$/i }));
    await user.click(screen.getByRole("tab", { name: /^chapter$/i }));
    expect(screen.getByLabelText(/accent color hex value/i)).toHaveValue(
      "#4F2683",
    );
  });

  it("keeps a half-filled rollover form", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole("tab", { name: /semester/i }));
    await user.type(screen.getByLabelText(/^label$/i), "Fall 2026");

    await user.click(screen.getByRole("tab", { name: /^privacy$/i }));
    expect(screen.queryByLabelText(/^label$/i)).toBeNull();
    await user.click(screen.getByRole("tab", { name: /semester/i }));

    expect(screen.getByLabelText(/^label$/i)).toHaveValue("Fall 2026");
  });
});
