import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

// Tiptap's ProseMirror view does not render document content into jsdom's
// contenteditable node in this repo's test environment (see chat-shell.spec.tsx's
// note on the same gap), so there is no DOM text/attribute this suite can read
// back to prove what the *rendered* placeholder says. `composerPlaceholder`
// below is tested directly and needs none of this; only the "fresh mount"
// integration test near the bottom needs `useEditor` stubbed, to capture the
// real `Placeholder` extension Composer wires it into.
const { capturedExtensions, mockRequestUploadUrl, mockUploadSignedUrl } =
  vi.hoisted(() => ({
    capturedExtensions: [] as unknown[][],
    // Resolves a real response shape. Returning bare `vi.fn()` (undefined) made
    // `handleAttach` throw on `response.storagePath` and toast instead of
    // staging a chip, so no test could ever reach the attachment branch.
    mockRequestUploadUrl: vi.fn(async () => ({
      signedUrl: "https://example.test/upload",
      storagePath: "chapters/c/chat/ch/m/notes.pdf",
      messageId: "m",
    })),
    mockUploadSignedUrl: vi.fn(async () => undefined),
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
  useRequestChatUploadUrl: () => ({ mutateAsync: mockRequestUploadUrl }),
  useUploadSignedUrl: () => ({ mutateAsync: mockUploadSignedUrl }),
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
import { UNAVAILABLE_QUOTE } from "./reply-quote";
import type { SlashCommand } from "@repo/chat-integrations";

type ComposerProps = Parameters<typeof Composer>[0];

/**
 * The one cast in this file, and it is here rather than at ten call sites.
 *
 * `ComposerProps` is a discriminated union — `replyTo` may only be passed
 * alongside `onCancelReply`, so a caller cannot render a staged-reply strip
 * with no way to dismiss it. That contract is worth having on the production
 * call site, but spreading `{...defaults, ...overrides}` produces a union of
 * object types that TypeScript will not narrow back to one arm, so every
 * `render(<Composer {...baseProps(…)} />)` below would fail to typecheck. The
 * cast is confined to the helper; the union still checks `chat-shell.tsx`,
 * which is the caller that matters.
 */
function baseProps(overrides: Partial<ComposerProps> = {}): ComposerProps {
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
  } as ComposerProps;
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
 * #489 — the staged-reply strip.
 *
 * Only the strip and its controls are reachable here: `useEditor` is stubbed to
 * `null` above (jsdom renders no ProseMirror view), so `submit()` returns on
 * its first line and no send can be driven through this component. That the
 * shell actually carries `replyToId` into `channel.send` is pinned in
 * `chat-shell.spec.tsx`, at the seam where it is drivable.
 */
describe("Composer staged reply (#489)", () => {
  const REPLY_TO = { id: "msg-1", author: "Alice Chen", preview: "the original" };

  it("renders nothing when no reply is staged", () => {
    render(<Composer {...baseProps()} />);
    expect(screen.queryByText(/replying to/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /cancel reply/i }),
    ).not.toBeInTheDocument();
  });

  it("shows who is being replied to and what they said", () => {
    render(<Composer {...baseProps({ replyTo: REPLY_TO })} />);
    expect(screen.getByText(/replying to/i)).toBeInTheDocument();
    expect(screen.getByText("Alice Chen")).toBeInTheDocument();
    expect(screen.getByText("the original")).toBeInTheDocument();
  });

  it("cancels from the × control", async () => {
    const user = userEvent.setup();
    const onCancelReply = vi.fn();
    render(<Composer {...baseProps({ replyTo: REPLY_TO, onCancelReply })} />);

    await user.click(screen.getByRole("button", { name: /cancel reply/i }));

    expect(onCancelReply).toHaveBeenCalledTimes(1);
  });

  it("renders the unavailable variant for a target outside the loaded window", () => {
    // The strip must still appear: a staged reply the member can neither see
    // nor dismiss is one that silently rides onto their next message.
    render(
      <Composer
        {...baseProps({
          replyTo: { id: "msg-1", author: null, preview: null },
          onCancelReply: vi.fn(),
        })}
      />,
    );
    // The exact label, not /replying to/i — the unavailable line starts with
    // the same two words, so a loose matcher matches both and proves neither.
    expect(screen.getByText("Replying to")).toBeInTheDocument();
    expect(screen.getByText(UNAVAILABLE_QUOTE)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /cancel reply/i }),
    ).toBeInTheDocument();
  });

  it("cancels on Escape", async () => {
    const user = userEvent.setup();
    const onCancelReply = vi.fn();
    render(<Composer {...baseProps({ replyTo: REPLY_TO, onCancelReply })} />);

    await user.click(screen.getByRole("button", { name: /cancel reply/i }));
    onCancelReply.mockClear();
    await user.keyboard("{Escape}");

    expect(onCancelReply).toHaveBeenCalledTimes(1);
  });

  it("does not cancel on Escape when nothing is staged", async () => {
    // Escape is a shared key on this surface — the emoji popover and the slash
    // palette both use it. It must only mean "drop the reply" when there is one.
    const user = userEvent.setup();
    const onCancelReply = vi.fn();
    render(<Composer {...baseProps({ onCancelReply })} />);

    await user.click(screen.getByRole("button", { name: /attach file/i }));
    await user.keyboard("{Escape}");

    expect(onCancelReply).not.toHaveBeenCalled();
  });

  it("leaves a staged reply alone when Escape was already handled", async () => {
    // Radix's `DismissableLayer` (the emoji popover mounted from this toolbar)
    // closes itself on Escape by calling `preventDefault()` without
    // `stopPropagation()`, so that keydown still arrives at the wrapper.
    // Without the `defaultPrevented` guard, dismissing the picker would also
    // silently discard the reply the member had staged.
    const onCancelReply = vi.fn();
    const { container } = render(
      <Composer {...baseProps({ replyTo: REPLY_TO, onCancelReply })} />,
    );
    const host = container.firstElementChild as HTMLElement;

    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    host.dispatchEvent(event);

    expect(onCancelReply).not.toHaveBeenCalled();
  });
});

/**
 * The palette is a second, independent way to invoke a slash command, and it
 * skipped every refusal the typed path applies. All three checks now come from
 * one `slashRefusal` helper so the two paths cannot diverge again.
 */
describe("Composer slash refusals cover the palette path too (#489)", () => {
  async function pickFromPalette(props: Record<string, unknown>) {
    const user = userEvent.setup();
    const onSlashDispatch = vi.fn(async () => ({ ok: true }));
    render(<Composer {...baseProps({ onSlashDispatch, ...props })} />);
    await user.click(screen.getByRole("button", { name: /open slash commands/i }));
    return { user, onSlashDispatch };
  }

  it("refuses a staged reply rather than dropping it", async () => {
    // `dispatchSlash` posts its card through its own controller and takes no
    // `replyToId`. Dispatching would drop the reply AND leave the strip
    // standing, so the member's next ordinary message would quote a stranger.
    const { user, onSlashDispatch } = await pickFromPalette({
      replyTo: { id: "msg-1", author: "Alice Chen", preview: "the original" },
      onCancelReply: vi.fn(),
    });

    await user.click(await screen.findByRole("option", { name: /poll/i }));

    expect(onSlashDispatch).not.toHaveBeenCalled();
  });

  it("refuses while offline, as the typed path does", async () => {
    const { user, onSlashDispatch } = await pickFromPalette({ isOffline: true });

    await user.click(await screen.findByRole("option", { name: /poll/i }));

    expect(onSlashDispatch).not.toHaveBeenCalled();
  });

  it("refuses when a file is staged, as the typed path does", async () => {
    // The third `slashRefusal` branch. It had no test on either path, so the
    // guard could be deleted wholesale and every suite stayed green — a slash
    // command posts a card, which has nowhere to hang a file.
    const user = userEvent.setup();
    const onSlashDispatch = vi.fn(async () => ({ ok: true }));
    const { container } = render(
      <Composer {...baseProps({ onSlashDispatch })} />,
    );

    const file = new File(["x"], "notes.pdf", { type: "application/pdf" });
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!;
    await user.upload(input, file);
    await screen.findByRole("button", { name: /remove notes\.pdf/i });

    await user.click(
      screen.getByRole("button", { name: /open slash commands/i }),
    );
    await user.click(await screen.findByRole("option", { name: /poll/i }));

    expect(onSlashDispatch).not.toHaveBeenCalled();
  });

  it("dispatches normally when nothing is staged", async () => {
    // The other direction: refusing everything would pass both cases above and
    // ship a palette that never works.
    const { user, onSlashDispatch } = await pickFromPalette({});

    await user.click(await screen.findByRole("option", { name: /poll/i }));

    expect(onSlashDispatch).toHaveBeenCalled();
  });
});

/**
 * #544 — a heavy slash command has THREE outcomes, not two. A committed write
 * whose chat card failed to post must not be styled as a failure: the officer's
 * response to a destructive "/points failed" toast is to run the command again,
 * and that re-typed command mints a FRESH `client_message_id`, so the server's
 * idempotency index (#1719) does not dedupe it — it writes a second ledger row.
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
 * can reject: `sendMessage`'s `clearDraft` and outbox `enqueue` sit outside its
 * own try block. Both call sites here clear the composer (and the persisted
 * draft) before dispatching, so an unhandled rejection cost the user their text
 * AND every scrap of feedback.
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
