import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

// Tiptap's ProseMirror view does not render document content into jsdom's
// contenteditable node in this repo's test environment (see chat-shell.test.tsx's
// note on the same gap), so there is no DOM text/attribute this suite can read
// back to prove what the *rendered* placeholder says. `composerPlaceholder`
// below is tested directly and needs none of this; only the "fresh mount"
// integration test near the bottom needs `useEditor` stubbed, to capture the
// real `Placeholder` extension Composer wires it into.
const { capturedExtensions } = vi.hoisted(() => ({
  capturedExtensions: [] as unknown[][],
}));

vi.mock("@tiptap/react", async () => {
  const actual =
    await vi.importActual<typeof import("@tiptap/react")>("@tiptap/react");
  return {
    ...actual,
    useEditor: (options: { extensions: unknown[] }) => {
      capturedExtensions.push(options.extensions);
      return null;
    },
    EditorContent: () => null,
  };
});

vi.mock("@repo/hooks", () => ({
  useRequestChatUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useUploadSignedUrl: () => ({ mutateAsync: vi.fn() }),
  useChapterRoster: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { captureException } = vi.hoisted(() => ({
  captureException: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({ captureException }));

import {
  Composer,
  composerPlaceholder,
  notifyDispatchOutcome,
  runDispatch,
} from "./composer";
import type { SlashCommand } from "@repo/chat-integrations";

function baseProps(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  return {
    channelId: "chan-1",
    channelName: "general",
    isReadOnly: false,
    draft: "",
    onChangeDraft: vi.fn(),
    onSend: vi.fn(),
    onTyping: vi.fn(),
    isModuleEnabled: () => true,
    ...overrides,
  };
}

function placeholderTextFrom(extensions: unknown[]) {
  const placeholder = extensions.find(
    (extension) =>
      (extension as { name?: string } | null)?.name === "placeholder",
  ) as { options: { placeholder: string } } | undefined;
  return placeholder?.options.placeholder;
}

describe("composerPlaceholder", () => {
  it("takes the channel sigil for a real channel", () => {
    expect(composerPlaceholder("announcements")).toBe(
      "Message #announcements",
    );
  });

  it("drops the sigil for a DM — the name is a person's, not a channel's", () => {
    expect(composerPlaceholder("Alice Chen", true)).toBe("Message Alice Chen");
  });
});

describe("Composer placeholder wiring", () => {
  it("re-derives the placeholder from a fresh mount, per channel — never a prior one", () => {
    // Extensions (including Placeholder) are instantiated once when
    // `useEditor` creates the editor and are never rebuilt on a prop change
    // — #1014's root cause. `chat-shell.tsx` works around this by keying
    // `<Composer>` on the channel, forcing a full unmount/mount per switch
    // instead of a same-instance re-render. This proves the half of that fix
    // this suite can reach without a real ProseMirror view: a *fresh
    // mount* — which the key guarantees — always builds the `Placeholder`
    // extension from `composerPlaceholder` for the channel active at that
    // mount.
    capturedExtensions.length = 0;
    const { unmount } = render(
      <Composer {...baseProps({ channelName: "general" })} />,
    );
    expect(placeholderTextFrom(capturedExtensions.at(-1)!)).toBe(
      composerPlaceholder("general"),
    );
    unmount();

    render(<Composer {...baseProps({ channelName: "random" })} />);
    expect(placeholderTextFrom(capturedExtensions.at(-1)!)).toBe(
      composerPlaceholder("random"),
    );
  });
});

/**
 * #396: the trigger button announced neither that it opens a dialog nor
 * whether that dialog is currently open — a screen-reader user got no signal
 * distinguishing this from a plain action button.
 */
describe("Composer slash-command trigger (#396)", () => {
  it("reflects the palette's open state via aria-expanded, and opens a modal dialog", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} />);

    const trigger = screen.getByRole("button", {
      name: /open slash commands/i,
    });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });
});

describe("Composer mention wiring", () => {
  it("registers the @-mention extension with a suggestion.items callback", () => {
    capturedExtensions.length = 0;
    render(<Composer {...baseProps()} />);
    const mention = capturedExtensions.at(-1)!.find(
      (extension) => (extension as { name?: string } | null)?.name === "mention",
    ) as
      | { options: { suggestion: { char: string; items: unknown } } }
      | undefined;
    expect(mention).toBeDefined();
    expect(mention!.options.suggestion.char).toBe("@");
    expect(typeof mention!.options.suggestion.items).toBe("function");
  });
});

/**
 * #544 — a heavy slash command has THREE outcomes, not two. A committed write
 * whose chat card failed to post must not be styled as a failure: the officer's
 * response to a destructive "/points failed" toast is to run the command again,
 * and a retry writes a second ledger row (#1719).
 */
describe("notifyDispatchOutcome (#544)", () => {
  const cmd = "points";

  it("toasts destructively when the command failed", () => {
    const toast = vi.fn();
    notifyDispatchOutcome(toast, cmd, { ok: false, error: "Nope" });

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "/points failed",
        description: "Nope",
        variant: "destructive",
      }),
    );
  });

  it("falls back to generic copy when a failure carries no message", () => {
    const toast = vi.fn();
    notifyDispatchOutcome(toast, cmd, { ok: false });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Couldn't run that command.",
        variant: "destructive",
      }),
    );
  });

  it("toasts a partial success NON-destructively, so it never reads as a failure", () => {
    const toast = vi.fn();
    notifyDispatchOutcome(toast, cmd, {
      ok: true,
      warning: "Points were recorded, but the chat card couldn't be posted.",
    });

    expect(toast).toHaveBeenCalledTimes(1);
    const arg = toast.mock.calls[0]?.[0] as {
      title: string;
      description: string;
      variant?: string;
    };
    expect(arg.title).toBe("/points partly succeeded");
    expect(arg.description).toMatch(/recorded/i);
    // The load-bearing assertion: anything but absent here turns a committed
    // grant into something the officer will retry.
    expect(arg.variant).toBeUndefined();
  });

  it("stays silent on an unremarkable success", () => {
    const toast = vi.fn();
    notifyDispatchOutcome(toast, cmd, { ok: true });

    expect(toast).not.toHaveBeenCalled();
  });
});

/**
 * #1718 — `dispatchSlashCommand` claims to be total but `/poll` and `/announce`
 * can reject. Both call sites clear the composer (and the persisted draft)
 * before dispatching, so an unhandled rejection cost the user their text AND
 * every scrap of feedback.
 */
describe("runDispatch (#1718)", () => {
  const command = { name: "poll" } as SlashCommand;

  it("converts a rejection into a failure outcome instead of propagating", async () => {
    const dispatch = vi.fn().mockRejectedValue(new Error("QuotaExceededError"));

    await expect(runDispatch(dispatch, command, "args")).resolves.toEqual({
      ok: false,
    });
  });

  // Catching these rejections took them away from Sentry's unhandled-rejection
  // handler, which was the only place they were recorded. Reporting is what
  // keeps #1718's failure class visible in production rather than trading a
  // silent user experience for a silent monitoring one.
  it("reports the swallowed rejection to Sentry", async () => {
    const boom = new Error("QuotaExceededError");
    const dispatch = vi.fn().mockRejectedValue(boom);

    await runDispatch(dispatch, command, "args");

    expect(captureException).toHaveBeenCalledWith(boom);
  });

  it("passes a resolved outcome through untouched, warning included", async () => {
    const result = { ok: true, warning: "partial" };
    const dispatch = vi.fn().mockResolvedValue(result);

    await expect(runDispatch(dispatch, command, "args")).resolves.toEqual(
      result,
    );
    expect(dispatch).toHaveBeenCalledWith(command, "args");
  });
});
