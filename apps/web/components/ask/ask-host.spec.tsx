import type React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createPortal } from "react-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASK_COPY } from "@repo/validation";

/**
 * Ask Frapp's front door on web (#4702, Paul 2026-11-13): no button in the
 * top bar and no panel beside the page. The entry is a button in the chat
 * composer, and the conversation is drawn in the slot chat puts above it.
 */

const who = vi.hoisted(() => ({
  available: true as boolean | undefined,
  ask: true as boolean | undefined,
  permissions: ["ai:use"] as string[] | undefined,
  previewing: false,
  chapterId: "chapter-1",
  settingsEnabled: [] as boolean[],
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  // The conversation and the channel's side of it have their own specs
  // (`use-ask.spec.tsx`, `ask-in-channel.spec.tsx`). Here it only has to be
  // the one conversation, over everything that reads it, and this chapter's.
  AskConversationProvider: ({
    scope,
    children,
  }: {
    scope: string | null;
    children: React.ReactNode;
  }) => (
    <div data-testid="ask-conversation" data-scope={scope ?? ""}>
      {children}
    </div>
  ),
  askAccessFrom: (await importOriginal<typeof import("@repo/hooks")>())
    .askAccessFrom,
  useActiveChapterId: () => who.chapterId,
  useAiConsent: () => ({ data: null }),
  aiAvailableFrom: () => who.available,
  useAiChapterSettings: (options: { enabled: boolean }) => {
    who.settingsEnabled.push(options.enabled);
    return { data: who.ask === undefined ? undefined : { ask: who.ask } };
  },
  useMyPermissions: () => ({
    data: who.permissions ? { permissions: who.permissions } : undefined,
  }),
}));
vi.mock("@/lib/stores/role-preview-store", () => ({
  useIsRolePreviewActive: () => who.previewing,
}));
const bridge = vi.hoisted(() => ({ access: [] as string[] }));
vi.mock("@/components/ask/ask-in-channel", () => ({
  AskInChannelBridge: (props: {
    access: string;
    children: React.ReactNode;
  }) => {
    bridge.access.push(props.access);
    return <div data-testid="ask-bridge">{props.children}</div>;
  },
}));

// The conversation has its own spec (`ask-card.spec.tsx`). Here it only has
// to be drawn where the host says, open or not.
const card = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("@/components/ask/ask-card", async () => {
  const { useEffect } = await import("react");
  return {
    AskCard: (props: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      container: HTMLElement | null;
    }) => {
      useEffect(() => {
        card.mounts += 1;
      }, []);
      if (!props.open || !props.container) return null;
      return createPortal(
        <div data-testid="ask-card">
          <button onClick={() => props.onOpenChange(false)}>close card</button>
        </div>,
        props.container,
      );
    },
  };
});

const { AskComposerButton, AskHost, AskSlot } = await import("./ask-host");

/** A chat column: the slot above a composer that carries the button. */
function Chat({ channel = "general" }: { channel?: string }) {
  return (
    <section aria-label={channel}>
      <AskSlot />
      <form>
        <AskComposerButton />
      </form>
    </section>
  );
}
const entry = () => screen.queryByRole("button", { name: ASK_COPY.name });

beforeEach(() => {
  who.available = true;
  who.ask = true;
  who.permissions = ["ai:use"];
  who.previewing = false;
  who.chapterId = "chapter-1";
  who.settingsEnabled = [];
  card.mounts = 0;
  bridge.access = [];
});

describe("who gets Ask Frapp", () => {
  it("is a member the server has AI for, in a chapter with Ask on, who may use it", () => {
    render(
      <AskHost>
        <Chat />
      </AskHost>,
    );
    expect(entry()).toBeInTheDocument();
    // And the same member may ask from a channel with `@Frapp` (#4713).
    expect(bridge.access.at(-1)).toBe("yes");
  });

  it("holds one conversation over the card and every channel, and it is this chapter's (#4713)", async () => {
    // Without the one provider above both, a question asked with `@Frapp`
    // would be missing from the card, and "one question at a time" would
    // not hold across them. Scoped, so it starts over in another chapter.
    const view = render(
      <AskHost>
        <Chat />
      </AskHost>,
    );
    const conversation = screen.getByTestId("ask-conversation");
    expect(conversation).toHaveAttribute("data-scope", "chapter-1");
    expect(conversation).toContainElement(screen.getByTestId("ask-bridge"));
    expect(conversation).toContainElement(entry());
    await userEvent.setup().click(entry()!);
    expect(conversation).toContainElement(screen.getByTestId("ask-card"));
    expect(screen.getAllByTestId("ask-conversation")).toHaveLength(1);
    who.chapterId = "chapter-2";
    view.rerender(
      <AskHost>
        <Chat />
      </AskHost>,
    );
    expect(screen.getByTestId("ask-conversation")).toHaveAttribute(
      "data-scope",
      "chapter-2",
    );
  });

  // The last column is what a channel's composer is told (#4713): `no` and
  // a message naming `@Frapp` is ordinary text; `unknown` and it is held,
  // because the member may turn out to have Ask.
  it.each([
    ["the server has no AI", () => (who.available = false), "no"],
    [
      "the server has not answered yet",
      () => (who.available = undefined),
      "unknown",
    ],
    ["the president has Ask off", () => (who.ask = false), "no"],
    [
      "the chapter's switches have not loaded",
      () => (who.ask = undefined),
      "unknown",
    ],
    [
      "the member's role may not use AI",
      () => (who.permissions = ["chat:send"]),
      "no",
    ],
    [
      "the member's permissions have not loaded",
      () => (who.permissions = undefined),
      "unknown",
    ],
    [
      "the member's role may not use AI, before the server has answered",
      () => {
        who.available = undefined;
        who.ask = undefined;
        who.permissions = ["chat:send"];
      },
      "no",
    ],
    [
      "an officer is viewing the chapter as a role",
      () => (who.previewing = true),
      "no",
    ],
  ])(
    "is nobody else: no button, no slot and no conversation when %s",
    (_, set, access) => {
      set();
      const view = render(
        <AskHost>
          <Chat />
        </AskHost>,
      );
      expect(entry()).toBeNull();
      expect(view.container.querySelector("[data-ask-slot]")).toBeNull();
      expect(card.mounts).toBe(0);
      expect(bridge.access.at(-1)).toBe(access);
      // And nothing stands in for it: no "not ready" control anywhere.
      expect(screen.queryByRole("button")).toBeNull();
    },
  );

  it("does not ask for the chapter's AI switches until the server says it has AI", () => {
    who.available = undefined;
    render(
      <AskHost>
        <Chat />
      </AskHost>,
    );
    expect(who.settingsEnabled.every((enabled) => !enabled)).toBe(true);
  });

  it("draws nothing outside a host: a composer on a page with no Ask is just a composer", () => {
    const view = render(<Chat />);
    expect(entry()).toBeNull();
    expect(view.container.querySelector("[data-ask-slot]")).toBeNull();
  });
});

describe("the button in the composer", () => {
  it("says Ask Frapp in words beside the crest, and says what it is for", () => {
    render(
      <AskHost>
        <Chat />
      </AskHost>,
    );
    const button = entry()!;
    expect(button).toHaveTextContent(ASK_COPY.name);
    expect(button).toHaveAttribute("title", ASK_COPY.entry_label);
    // The crest is decoration; the words name the control.
    expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    // Never a submit: it sits inside the composer's form.
    expect(button).toHaveAttribute("type", "button");
  });

  it("opens the conversation in chat's slot, over the thread, and closes it again", async () => {
    const view = render(
      <AskHost>
        <Chat />
      </AskHost>,
    );
    const user = userEvent.setup();
    const slot = view.container.querySelector("[data-ask-slot]")!;
    expect(entry()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("ask-card")).toBeNull();

    await user.click(entry()!);
    expect(entry()).toHaveAttribute("aria-expanded", "true");
    expect(slot).toContainElement(screen.getByTestId("ask-card"));

    await user.click(entry()!);
    expect(entry()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("ask-card")).toBeNull();
  });

  it("follows the conversation's own close", async () => {
    render(
      <AskHost>
        <Chat />
      </AskHost>,
    );
    const user = userEvent.setup();
    await user.click(entry()!);
    await user.click(screen.getByRole("button", { name: "close card" }));
    expect(entry()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("the slot", () => {
  it("takes no room of its own, so the thread and the composer do not move when Ask arrives", () => {
    const view = render(
      <AskHost>
        <Chat />
      </AskHost>,
    );
    const slot = view.container.querySelector("[data-ask-slot]")!;
    expect(slot.className).toContain("h-0");
    expect(slot.className).toContain("shrink-0");
  });

  it("keeps one conversation across a change of channel: the composer remounts, the card does not", async () => {
    const view = render(
      <AskHost>
        <Chat key="general" channel="general" />
      </AskHost>,
    );
    await userEvent.setup().click(entry()!);
    view.rerender(
      <AskHost>
        <Chat key="announcements" channel="announcements" />
      </AskHost>,
    );
    // Still open, drawn in the new channel's slot, and never remounted.
    expect(view.container.querySelector("[data-ask-slot]")).toContainElement(
      screen.getByTestId("ask-card"),
    );
    expect(entry()).toHaveAttribute("aria-expanded", "true");
    expect(card.mounts).toBe(1);
  });

  it("holds the conversation while chat is off screen, and shows it again when chat comes back", async () => {
    const tree = (chat: boolean) => (
      <AskHost>{chat ? <Chat /> : <p>Chapter settings</p>}</AskHost>
    );
    const view = render(tree(true));
    await userEvent.setup().click(entry()!);
    view.rerender(tree(false));
    expect(screen.queryByTestId("ask-card")).toBeNull();
    view.rerender(tree(true));
    expect(screen.getByTestId("ask-card")).toBeInTheDocument();
    expect(card.mounts).toBe(1);
  });
});
