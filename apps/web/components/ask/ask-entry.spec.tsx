import type React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASK_COPY } from "@repo/validation";

/**
 * The real host, field stand-in and conversation together (#4904). `ask-host.spec.tsx`
 * and `ask-card.spec.tsx` each stand the other in, so neither sees what
 * passes between them: which element opened the conversation, where focus
 * goes when it closes, and what the conversation does when Ask itself comes
 * and goes under it.
 */

const who = vi.hoisted(() => ({ previewing: false }));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  AskConversationProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  useActiveChapterId: () => "chapter-1",
  useAiConsent: () => ({ data: null }),
  aiAvailableFrom: () => true,
  useAiChapterSettings: () => ({ data: { ask: true } }),
  useMyPermissions: () => ({ data: { permissions: ["ai:use"] } }),
  useAsk: () => ({
    exchanges: [],
    working: false,
    ask: vi.fn(),
    retry: vi.fn(),
    setProposal: vi.fn(),
    resolveProposal: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  }),
  useActStatus: () => ({ data: null }),
  useAskSuggestions: () => ({ suggestions: [] }),
  useActEventAudience: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAskStatus: () => ({
    refetch: vi.fn(),
    data: {
      saved_until: null,
      diagnostics: { offered: false, can_change: false, ends_at: null },
    },
  }),
}));
vi.mock("@/lib/stores/role-preview-store", () => ({
  useIsRolePreviewActive: () => who.previewing,
}));
vi.mock("@/components/ai/meet-frapp-ai", () => ({
  useAiConsentGate: () => ({
    ensureConsent: vi.fn().mockResolvedValue(true),
    consentDialog: null,
  }),
}));

const { AskHost, useAskEntry } = await import("./ask-host");

/** The top bar's field, as `find-bar.tsx` reaches Ask and takes focus back. */
function Field() {
  const ask = useAskEntry();
  if (!ask) return null;
  return (
    <button
      data-ask-entry=""
      onClick={(event) => ask.openWith(undefined, event.currentTarget)}
    >
      Search or ask Frapp
    </button>
  );
}

function Page() {
  return (
    <AskHost>
      <Field />
      <input aria-label="Message" />
    </AskHost>
  );
}

const entry = () => screen.getByRole("button", { name: "Search or ask Frapp" });
const card = () => screen.queryByRole("dialog", { name: ASK_COPY.name });
const field = () => screen.getByRole("textbox", { name: ASK_COPY.placeholder });

beforeEach(() => {
  who.previewing = false;
});

describe("the entry and the conversation together", () => {
  it("opens from the field with the cursor in the conversation, and gives focus back to the field", async () => {
    const user = userEvent.setup();
    render(<Page />);
    expect(card()).toBeNull();
    await user.click(entry());
    expect(field()).toHaveFocus();
    await user.click(screen.getByRole("button", { name: ASK_COPY.close }));
    expect(card()).toBeNull();
    await waitFor(() => expect(entry()).toHaveFocus());
  });

  it("closes on Escape, wherever in it the cursor is", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(entry());
    await user.keyboard("{Escape}");
    expect(card()).toBeNull();
    await waitFor(() => expect(entry()).toHaveFocus());
  });

  it("closes for good when the member loses Ask: it does not open itself when Ask returns", async () => {
    const user = userEvent.setup();
    const view = render(<Page />);
    await user.click(entry());
    expect(card()).toBeInTheDocument();
    // An officer starts viewing the chapter as a role.
    who.previewing = true;
    view.rerender(<Page />);
    expect(card()).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Search or ask Frapp" }),
    ).toBeNull();
    who.previewing = false;
    view.rerender(<Page />);
    expect(entry()).toBeInTheDocument();
    expect(card()).toBeNull();
  });
});
