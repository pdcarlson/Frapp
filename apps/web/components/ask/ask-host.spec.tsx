import type React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ask Frapp's front door on web (#4904, Paul's pick of 2026-11-13): no
 * control of its own. The host hands the top bar's field a way in
 * (`useAskEntry`) and draws the conversation over whatever page is up.
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
// to be opened, closed and handed a question by the host.
const card = vi.hoisted(() => ({ mounts: 0 }));
vi.mock("@/components/ask/ask-card", async () => {
  const { useEffect } = await import("react");
  return {
    AskCard: (props: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      asking: string | null;
      onAsked: () => void;
    }) => {
      useEffect(() => {
        card.mounts += 1;
      }, []);
      if (!props.open) return null;
      return (
        <div data-testid="ask-card" data-asking={props.asking ?? ""}>
          <button onClick={() => props.onOpenChange(false)}>close card</button>
          <button onClick={props.onAsked}>take question</button>
        </div>
      );
    },
  };
});

const { AskHost, useAskEntry } = await import("./ask-host");

/** A page with the top bar's field on it, as `find-bar.tsx` reaches Ask. */
function Page({ name = "chat" }: { name?: string }) {
  const ask = useAskEntry();
  return (
    <section aria-label={name}>
      {ask ? (
        <>
          <button onClick={() => ask.openWith()}>open</button>
          <button onClick={() => ask.openWith("  When is formal?  ")}>
            ask
          </button>
          <output>{ask.open ? "open" : "closed"}</output>
        </>
      ) : null}
    </section>
  );
}
const entry = () => screen.queryByRole("button", { name: "open" });

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
        <Page />
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
        <Page />
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
        <Page />
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
    "is nobody else: no way in and no conversation when %s",
    (_, set, access) => {
      set();
      render(
        <AskHost>
          <Page />
        </AskHost>,
      );
      expect(entry()).toBeNull();
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
        <Page />
      </AskHost>,
    );
    expect(who.settingsEnabled.every((enabled) => !enabled)).toBe(true);
  });

  it("has no way in outside a host: a field on a page with no Ask only searches", () => {
    render(<Page />);
    expect(entry()).toBeNull();
  });
});

describe("the way in", () => {
  it("opens the conversation, and follows its own close", async () => {
    render(
      <AskHost>
        <Page />
      </AskHost>,
    );
    const user = userEvent.setup();
    expect(screen.getByRole("status")).toHaveTextContent("closed");
    expect(screen.queryByTestId("ask-card")).toBeNull();

    await user.click(entry()!);
    expect(screen.getByRole("status")).toHaveTextContent("open");
    expect(screen.getByTestId("ask-card")).toHaveAttribute("data-asking", "");

    await user.click(screen.getByRole("button", { name: "close card" }));
    expect(screen.getByRole("status")).toHaveTextContent("closed");
  });

  it("hands the conversation a question typed into the field, trimmed, until it is taken", async () => {
    render(
      <AskHost>
        <Page />
      </AskHost>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "ask" }));
    expect(screen.getByTestId("ask-card")).toHaveAttribute(
      "data-asking",
      "When is formal?",
    );
    await user.click(screen.getByRole("button", { name: "take question" }));
    expect(screen.getByTestId("ask-card")).toHaveAttribute("data-asking", "");
  });

  it("keeps one conversation across pages: the page changes, the conversation does not remount", async () => {
    const view = render(
      <AskHost>
        <Page key="chat" name="chat" />
      </AskHost>,
    );
    await userEvent.setup().click(entry()!);
    view.rerender(
      <AskHost>
        <Page key="settings" name="settings" />
      </AskHost>,
    );
    expect(screen.getByTestId("ask-card")).toBeInTheDocument();
    expect(card.mounts).toBe(1);
  });

  it("drops a question waiting to be asked when the member loses Ask", async () => {
    const view = render(
      <AskHost>
        <Page />
      </AskHost>,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "ask" }));
    who.previewing = true;
    view.rerender(
      <AskHost>
        <Page />
      </AskHost>,
    );
    who.previewing = false;
    view.rerender(
      <AskHost>
        <Page />
      </AskHost>,
    );
    // It does not open itself, and it does not ask what was typed before.
    expect(screen.queryByTestId("ask-card")).toBeNull();
    await userEvent.setup().click(entry()!);
    expect(screen.getByTestId("ask-card")).toHaveAttribute("data-asking", "");
  });
});
