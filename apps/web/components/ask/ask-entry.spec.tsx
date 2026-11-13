import type React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASK_COPY } from "@repo/validation";

/**
 * The real host, slot, button and card together (#4702). `ask-host.spec.tsx`
 * and `ask-card.spec.tsx` each stand the other in, so neither sees what
 * passes between them: which element opened the conversation, where focus
 * goes when it closes, and what the card does when chat or Ask itself comes
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

const { AskComposerButton, AskHost, AskSlot } = await import("./ask-host");

/**
 * The dashboard as chat draws it: the slot stays, and the composer (with the
 * button in it) is a new one for each channel, as `chat-shell.tsx` keys it.
 * With `chat` off a tool page has taken chat's place.
 */
function Page({
  channel = "general",
  chat = true,
}: {
  channel?: string;
  chat?: boolean;
}) {
  return (
    <AskHost>
      <input aria-label="Search" />
      {chat ? (
        <section>
          <AskSlot />
          <form key={channel}>
            <AskComposerButton />
          </form>
        </section>
      ) : null}
    </AskHost>
  );
}

const entry = () => screen.getByRole("button", { name: ASK_COPY.name });
const card = () => screen.queryByRole("region", { name: ASK_COPY.name });
const field = () => screen.getByRole("textbox", { name: ASK_COPY.placeholder });

beforeEach(() => {
  who.previewing = false;
});

describe("the entry and the conversation together", () => {
  it("opens from the composer's button with the cursor in the field, and gives focus back to that button", async () => {
    const user = userEvent.setup();
    render(<Page />);
    expect(card()).toBeNull();
    await user.click(entry());
    expect(entry()).toHaveAttribute("aria-expanded", "true");
    expect(field()).toHaveFocus();
    await user.click(screen.getByRole("button", { name: ASK_COPY.close }));
    expect(card()).toBeNull();
    expect(entry()).toHaveFocus();
  });

  it("gives focus to the button on screen now when the one that opened it went with its channel", async () => {
    const user = userEvent.setup();
    const view = render(<Page channel="general" />);
    const opener = entry();
    await user.click(opener);
    view.rerender(<Page channel="rush" />);
    // The composer is a new one; the conversation is the same one.
    expect(opener).not.toBeInTheDocument();
    expect(card()).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(card()).toBeNull();
    expect(entry()).toHaveFocus();
  });

  it("does not pull focus back to the entry from somewhere the member went on purpose", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(entry());
    const search = screen.getByRole("textbox", { name: "Search" });
    await user.click(search);
    // Closed by its own button, from the keyboard's point of view elsewhere.
    await user.click(entry());
    expect(card()).toBeNull();
    expect(entry()).toHaveFocus();
    await user.click(entry());
    await user.click(search);
    expect(search).toHaveFocus();
  });

  it("comes back with chat without taking the cursor from the page the member is on", async () => {
    const user = userEvent.setup();
    const view = render(<Page />);
    await user.click(entry());
    view.rerender(<Page chat={false} />);
    expect(card()).toBeNull();
    const search = screen.getByRole("textbox", { name: "Search" });
    await user.click(search);
    view.rerender(<Page />);
    expect(card()).toBeInTheDocument();
    expect(entry()).toHaveAttribute("aria-expanded", "true");
    expect(search).toHaveFocus();
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
    expect(screen.queryByRole("button", { name: ASK_COPY.name })).toBeNull();
    who.previewing = false;
    view.rerender(<Page />);
    expect(entry()).toHaveAttribute("aria-expanded", "false");
    expect(card()).toBeNull();
  });
});
