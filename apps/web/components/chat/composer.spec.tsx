import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";

// Tiptap's ProseMirror view does not render document content into jsdom's
// contenteditable node in this repo's test environment (see chat-shell.spec.tsx's
// note on the same gap), so there is no DOM text/attribute this suite can read
// back to prove what the *rendered* placeholder says. `composerPlaceholder`
// below is tested directly and needs none of this; only the "fresh mount"
// integration test near the bottom needs `useEditor` stubbed, to capture the
// real `Placeholder` extension Composer wires it into. The send suite (#1728)
// also swaps the stub's `null` for an editor double, so `submit()` can run.
const {
  capturedExtensions,
  editorDouble,
  mockRequestUploadUrl,
  mockUploadSignedUrl,
  mockToast,
} = vi.hoisted(() => ({
    capturedExtensions: [] as unknown[][],
    // What the stubbed `useEditor` hands back. `null` everywhere except the
    // send suite (#1728), which installs a `fakeEditor` so `submit()` can run.
    editorDouble: { current: null as unknown },
    mockToast: vi.fn(),
    // Resolves a real response shape. Returning bare `vi.fn()` (undefined) made
    // `handleAttach` throw and toast instead of staging a chip, so no test
    // could ever reach the attachment branch. The wire names are snake_case
    // (#2130) — `readSignedUpload` rejects a camelCase-only ticket, which is
    // the whole point of the shared helper.
    // Typed `unknown` on purpose: `readSignedUpload` takes `unknown` and the
    // contract tests below feed it malformed tickets (a camelCase-only body,
    // a body with no upload_url) to prove it rejects them.
    mockRequestUploadUrl: vi.fn(
      async (): Promise<unknown> => ({
        upload_url: "https://example.test/upload",
        storage_path: "chapters/c/chat/ch/m/notes.pdf",
        message_id: "m",
      }),
    ),
    mockUploadSignedUrl: vi.fn(async () => undefined),
  }));

vi.mock("@tiptap/react", async () => {
  const actual =
    await vi.importActual<typeof import("@tiptap/react")>("@tiptap/react");
  return {
    ...actual,
    useEditor: (options: { extensions: unknown[] }) => {
      capturedExtensions.push(options.extensions);
      return editorDouble.current;
    },
    EditorContent: () => null,
  };
});

vi.mock("@repo/hooks", () => ({
  useRequestChatUploadUrl: () => ({ mutateAsync: mockRequestUploadUrl }),
  useUploadSignedUrl: () => ({ mutateAsync: mockUploadSignedUrl }),
  useChapterRoster: () => ({ data: [] }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));

const { captureException } = vi.hoisted(() => ({
  captureException: vi.fn(),
}));
vi.mock("@sentry/nextjs", () => ({ captureException }));

import {
  COMPOSER_BOX_CLASS,
  COMPOSER_INPUT_CLASS,
  COMPOSER_TOOLBAR_CLASS,
  COMPOSER_WELL_CLASS,
  Composer,
  ComposerShell,
  composerPlaceholder,
  notifyDispatchOutcome,
  runDispatch,
  uploadFailureDescription,
} from "./composer";
import { UNAVAILABLE_QUOTE } from "./reply-quote";
import type { SlashCommand } from "@repo/chat-core/integrations";

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
    // `findBy`, not `getBy`: the palette is a `next/dynamic` boundary now
    // (`cmdk` and a Radix Dialog are `chat-extras` under the board's `1s`
    // split), so the first open resolves a module before the dialog exists.
    // `aria-expanded` above flips synchronously either way — the state that
    // drives it is the composer's, not the palette's.
    expect(await screen.findByRole("dialog")).toHaveAttribute(
      "aria-modal",
      "true",
    );
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
 * its first line. The send suite below drives it with an editor double, but the
 * reply never passes through the composer's send anyway: that the shell
 * carries `replyToId` into `channel.send` is pinned in `chat-shell.spec.tsx`.
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
 * A minimal stand-in for the Tiptap editor, enough for `submit()` to run.
 *
 * jsdom renders no ProseMirror view, so the real editor cannot be typed into
 * here; this holds the text as a string and implements exactly the calls the
 * send path makes. `type` stands in for the member typing after a send.
 */
function fakeEditor(initial: string) {
  let text = initial;
  const docOf = (value: string) => ({
    type: "doc",
    content: value.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  });
  const textOf = (doc: { content?: { content?: { text?: string }[] }[] }) =>
    (doc.content ?? [])
      .map((p) => (p.content ?? []).map((n) => n.text ?? "").join(""))
      .join("\n");
  return {
    isDestroyed: false,
    get isEmpty() {
      return text.length === 0;
    },
    getText: () => text,
    getJSON: () => docOf(text),
    type(value: string) {
      text = value;
    },
    commands: {
      clearContent: vi.fn(() => {
        text = "";
        return true;
      }),
      setContent: vi.fn((doc: Parameters<typeof textOf>[0]) => {
        text = textOf(doc);
        return true;
      }),
      focus: vi.fn(() => true),
    },
  };
}

/**
 * #2993 — a command typed out in full and sent with Enter used to skip the
 * module gate: only the palette read `isModuleEnabled`, so `/poll` posted a
 * poll card in a chapter that had switched Polls off. The typed path now asks
 * the same gate, through the same `slashRefusal` the palette path uses.
 */
describe("Composer typed slash dispatch respects the module gate (#2993)", () => {
  const sendButton = () => screen.getByRole("button", { name: "Send" });
  const POLL = '/poll "Formal venue?" Lodge Riverside';

  let editor: ReturnType<typeof fakeEditor>;
  beforeEach(() => {
    mockToast.mockClear();
  });
  afterEach(() => {
    editorDouble.current = null;
  });

  function typeAndSend(text: string, overrides: Partial<ComposerProps> = {}) {
    editor = fakeEditor(text);
    editorDouble.current = editor;
    const onSlashDispatch = vi.fn(async () => ({ ok: true as const }));
    const onSend = vi.fn();
    render(
      <Composer
        {...baseProps({ draft: text, onSlashDispatch, onSend, ...overrides })}
      />,
    );
    fireEvent.click(sendButton());
    return { onSlashDispatch, onSend };
  }

  it("refuses /poll while Polls is off, and keeps the member's text", async () => {
    const { onSlashDispatch, onSend } = typeAndSend(POLL, {
      isModuleEnabled: (key) => key !== "polls",
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "/poll is turned off",
        description: expect.stringMatching(/switched off Polls/),
        variant: "destructive",
      }),
    );
    expect(onSlashDispatch).not.toHaveBeenCalled();
    // Not sent as a text message either: the refusal is the whole outcome.
    expect(onSend).not.toHaveBeenCalled();
    expect(editor.getText()).toBe(POLL);
  });

  it("dispatches /poll while Polls is on", async () => {
    const { onSlashDispatch } = typeAndSend(POLL, {
      isModuleEnabled: () => true,
    });

    await waitFor(() => expect(onSlashDispatch).toHaveBeenCalledTimes(1));
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: "destructive" }),
    );
  });

  it("refuses with its own copy while the modules are still loading", async () => {
    const { onSlashDispatch } = typeAndSend(POLL, {
      isModuleEnabled: () => false,
      slashCommandsStatus: "loading",
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "/poll isn't ready yet" }),
    );
    expect(onSlashDispatch).not.toHaveBeenCalled();
    expect(editor.getText()).toBe(POLL);
  });

  it("refuses with its own copy once the modules failed to load", async () => {
    const { onSlashDispatch } = typeAndSend(POLL, {
      isModuleEnabled: () => false,
      slashCommandsStatus: "error",
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't check /poll" }),
    );
    expect(onSlashDispatch).not.toHaveBeenCalled();
  });

  it("says it needs a connection while offline, not that the modules are loading", async () => {
    // Offline, the module read can't answer either; "try again in a moment"
    // would be the wrong reason.
    const { onSlashDispatch } = typeAndSend(POLL, {
      isModuleEnabled: () => false,
      slashCommandsStatus: "loading",
      isOffline: true,
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "/poll needs a connection" }),
    );
    expect(onSlashDispatch).not.toHaveBeenCalled();
  });

  it("never gates a command with no module (/announce)", async () => {
    // `/announce` belongs to an always-on module, so an unresolved gate has
    // nothing to say about it.
    const { onSlashDispatch } = typeAndSend("/announce Chapter at 7", {
      isModuleEnabled: () => false,
      slashCommandsStatus: "loading",
    });

    await waitFor(() => expect(onSlashDispatch).toHaveBeenCalledTimes(1));
  });
});

/**
 * #1728 — a send the outbox refused must not cost the member their message.
 *
 * `submit()` used to `void` the send and clear unconditionally, so an
 * `outbox.enqueue` rejection emptied the composer and dropped the staged files
 * and reply, with no toast and — because `sendMessage` removes the optimistic
 * card before rethrowing — nothing in the timeline either.
 *
 * The restore is all or nothing: the message comes back whole into a composer
 * the member has not touched since, or not at all, and the toast says which.
 * Re-staging the reply is the shell's half (`chat-shell.spec.tsx`); this suite
 * pins that the composer asks for it.
 */
describe("Composer send failure (#1728)", () => {
  const sendButton = () => screen.getByRole("button", { name: "Send" });
  const refused = () => new Error("QuotaExceededError");
  const REPLY = { id: "msg-1", author: "Alice Chen", preview: "the original" };

  let editor: ReturnType<typeof fakeEditor>;
  beforeEach(() => {
    editor = fakeEditor("hello");
    editorDouble.current = editor;
    mockToast.mockClear();
    mockUploadSignedUrl.mockClear();
    captureException.mockClear();
  });
  afterEach(() => {
    editorDouble.current = null;
  });

  /** A send whose rejection the test releases, standing in for a slow one. */
  function deferredSend() {
    let reject!: (error: Error) => void;
    const onSend = vi.fn(
      () =>
        new Promise<void>((_, rejectSend) => {
          reject = rejectSend;
        }),
    );
    return { onSend, refuse: () => act(async () => reject(refused())) };
  }

  function renderComposer(overrides: Partial<ComposerProps> = {}) {
    const props = baseProps({ draft: "hello", ...overrides });
    return { props, ...render(<Composer {...props} />) };
  }

  async function stageFile(container: HTMLElement, name = "notes.pdf") {
    fireEvent.change(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      {
        target: {
          files: [new File(["%PDF-1.4"], name, { type: "application/pdf" })],
        },
      },
    );
    return screen.findByRole("button", { name: `Remove ${name}` });
  }

  /** Enter through the editor's own keymap, outside any React event. */
  function pressEnter() {
    const submitKeymap = capturedExtensions
      .at(-1)!
      .find(
        (extension) =>
          (extension as { name?: string } | null)?.name === "submit-on-enter",
      ) as {
      config: { addKeyboardShortcuts: () => { Enter: () => boolean } };
    };
    submitKeymap.config.addKeyboardShortcuts.call({}).Enter();
  }

  const chip = (name = "notes.pdf") =>
    screen.queryByRole("button", { name: `Remove ${name}` });

  const toastSaying = (description: RegExp) =>
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Message not sent",
        description: expect.stringMatching(description),
        variant: "destructive",
      }),
    );
  const BACK = /back in the composer/;
  const GONE = /was discarded/;

  it("puts the text back and says so when the send rejects", async () => {
    const onSend = vi.fn(async () => {
      throw refused();
    });
    const { props } = renderComposer({ onSend });

    fireEvent.click(sendButton());

    await waitFor(() => toastSaying(BACK));
    expect(onSend).toHaveBeenCalledWith("hello", []);
    expect(editor.getText()).toBe("hello");
    // Reported to the draft too, so it survives a reload like any other text.
    expect(props.onChangeDraft).toHaveBeenLastCalledWith("hello");
    // Restored without emitting an update, which would reach `onTyping` and
    // tell the channel the member is typing when they did nothing.
    expect(editor.commands.setContent).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "doc" }),
      { emitUpdate: false },
    );
    expect(props.onTyping).not.toHaveBeenCalled();
    // Caught now, so Sentry's unhandled-rejection handler no longer sees it.
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { chat_send: "composer" },
    });
  });

  it("puts a staged attachment back with the text", async () => {
    const onSend = vi.fn(async () => {
      throw refused();
    });
    const { container } = renderComposer({ onSend });
    await stageFile(container);

    fireEvent.click(sendButton());

    await waitFor(() => toastSaying(BACK));
    expect(onSend).toHaveBeenCalledWith("hello", [
      expect.objectContaining({ filename: "notes.pdf" }),
    ]);
    expect(chip()).toBeInTheDocument();
  });

  it("asks the shell to re-stage the reply the send carried", async () => {
    const onSend = vi.fn(async () => {
      throw refused();
    });
    const onRestoreReply = vi.fn();
    renderComposer({ onSend, replyTo: REPLY, onCancelReply: vi.fn(), onRestoreReply });

    fireEvent.click(sendButton());

    await waitFor(() => toastSaying(BACK));
    expect(onRestoreReply).toHaveBeenCalledWith("msg-1");
  });

  it("re-stages the reply once the shell has cleared its strip", async () => {
    // What production does: the shell clears its target the moment it sends,
    // so by the time the refusal lands the composer's `replyTo` is null.
    const { onSend, refuse } = deferredSend();
    const onRestoreReply = vi.fn();
    const props = baseProps({
      draft: "hello",
      onSend,
      replyTo: REPLY,
      onCancelReply: vi.fn(),
      onRestoreReply,
    });
    const { rerender } = render(<Composer {...props} />);

    fireEvent.click(sendButton());
    rerender(<Composer {...baseProps({ ...props, replyTo: null })} />);
    await refuse();

    toastSaying(BACK);
    expect(onRestoreReply).toHaveBeenCalledWith("msg-1");
    expect(editor.getText()).toBe("hello");
  });

  it("restores when the refusal lands before the re-render that cleared it", async () => {
    // An unscoped outbox throws at once, so outside a React event (Enter
    // arrives through ProseMirror's own keymap) the rejection can settle
    // before React commits `setPending([])`. What is staged is then still the
    // files that were sent, which is not the member touching anything.
    const onSend = vi.fn(async () => {
      throw refused();
    });
    const { container } = renderComposer({ onSend });
    await stageFile(container);

    pressEnter();
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    // Settled before any render: the chip is the one React has yet to clear.
    toastSaying(BACK);
    await act(async () => {});

    expect(editor.getText()).toBe("hello");
    expect(chip()).toBeInTheDocument();
  });

  it("treats a synchronous throw from onSend as the same refusal", async () => {
    const onSend = vi.fn(() => {
      throw refused();
    });
    renderComposer({ onSend });

    fireEvent.click(sendButton());

    await waitFor(() => toastSaying(BACK));
    expect(editor.getText()).toBe("hello");
  });

  it("restores none of it over text typed since, and says it is gone", async () => {
    // Half a restore pairs pieces of two messages: the old file on the new
    // text, or the old reply over it. The text alone can't come back either,
    // because it would overwrite what the member is writing now.
    const { onSend, refuse } = deferredSend();
    const onRestoreReply = vi.fn();
    const { container, props } = renderComposer({
      onSend,
      replyTo: REPLY,
      onCancelReply: vi.fn(),
      onRestoreReply,
    });
    await stageFile(container);

    fireEvent.click(sendButton());
    expect(editor.getText()).toBe("");
    expect(chip()).not.toBeInTheDocument();
    editor.type("second thought");
    await refuse();

    toastSaying(GONE);
    expect(editor.getText()).toBe("second thought");
    expect(props.onChangeDraft).not.toHaveBeenCalledWith("hello");
    expect(chip()).not.toBeInTheDocument();
    expect(onRestoreReply).not.toHaveBeenCalled();
  });

  it("restores none of it over a file staged since", async () => {
    const { onSend, refuse } = deferredSend();
    const { container } = renderComposer({ onSend });
    await stageFile(container);

    fireEvent.click(sendButton());
    await stageFile(container, "photo.pdf");
    await refuse();

    toastSaying(GONE);
    expect(editor.getText()).toBe("");
    expect(chip("photo.pdf")).toBeInTheDocument();
    expect(chip("notes.pdf")).not.toBeInTheDocument();
  });

  it("restores none of it over an upload started since", async () => {
    // The file lands in `pending` only when its upload finishes, so this is
    // the one piece of the next message the staged check can't see yet.
    const { onSend, refuse } = deferredSend();
    const { container } = renderComposer({ onSend });

    fireEvent.click(sendButton());
    mockUploadSignedUrl.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.change(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      {
        target: {
          files: [
            new File(["%PDF-1.4"], "photo.pdf", { type: "application/pdf" }),
          ],
        },
      },
    );
    await waitFor(() => expect(mockUploadSignedUrl).toHaveBeenCalled());
    await refuse();

    toastSaying(GONE);
    expect(editor.getText()).toBe("");
  });

  it("still restores over an upload already under way at Send", async () => {
    // That file was headed for this message; it lands beside the restored
    // text, as it would have beside the text had the send never happened.
    const { onSend, refuse } = deferredSend();
    const { container } = renderComposer({ onSend });
    mockUploadSignedUrl.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.change(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      {
        target: {
          files: [
            new File(["%PDF-1.4"], "photo.pdf", { type: "application/pdf" }),
          ],
        },
      },
    );
    await waitFor(() => expect(mockUploadSignedUrl).toHaveBeenCalled());

    fireEvent.click(sendButton());
    await refuse();

    toastSaying(BACK);
    expect(editor.getText()).toBe("hello");
  });

  it("restores none of it over a different reply staged since", async () => {
    // Putting the text back under msg-2's strip would post it as a reply to a
    // message it was never written for.
    const { onSend, refuse } = deferredSend();
    const onRestoreReply = vi.fn();
    const props = baseProps({
      draft: "hello",
      onSend,
      replyTo: REPLY,
      onCancelReply: vi.fn(),
      onRestoreReply,
    });
    const { rerender } = render(<Composer {...props} />);

    fireEvent.click(sendButton());
    rerender(
      <Composer
        {...baseProps({
          ...props,
          replyTo: { id: "msg-2", author: "Bo", preview: "another" },
        })}
      />,
    );
    await refuse();

    toastSaying(GONE);
    expect(editor.getText()).toBe("");
    expect(onRestoreReply).not.toHaveBeenCalled();
  });

  it("restores nothing into a destroyed editor, and says it is gone", async () => {
    // A channel switch remounts `<Composer>` (it is keyed per channel).
    const { onSend, refuse } = deferredSend();
    renderComposer({ onSend });

    fireEvent.click(sendButton());
    editor.isDestroyed = true;
    await refuse();

    toastSaying(GONE);
    expect(editor.commands.setContent).not.toHaveBeenCalled();
  });

  it("clears the text and files, silently, once the send is queued", async () => {
    // The other direction: restoring on every send would pass every case above
    // and leave each sent message sitting in the composer.
    const onSend = vi.fn(async () => undefined);
    const onRestoreReply = vi.fn();
    const { container } = renderComposer({
      onSend,
      replyTo: REPLY,
      onCancelReply: vi.fn(),
      onRestoreReply,
    });
    await stageFile(container);

    await act(async () => fireEvent.click(sendButton()));

    expect(editor.getText()).toBe("");
    expect(chip()).not.toBeInTheDocument();
    expect(mockToast).not.toHaveBeenCalled();
    expect(onRestoreReply).not.toHaveBeenCalled();
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

  // The dispatcher keeps a non-retryable `recorded` row in the timeline
  // (#1789); this toast is the secondary notice and is evictable. Sticky
  // still matters for the seconds before the officer looks at the row.
  it("makes the partial-success toast sticky, not a 5-second one", () => {
    const toast = vi.fn();
    notifyDispatchOutcome(toast, cmd, { ok: true, warning: "Points recorded." });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ duration: Infinity }),
    );
  });

  // The mirror: a plain failure committed nothing, so it must NOT pin an
  // undismissable toast to the corner of the screen.
  it("leaves the failure toast on the default duration", () => {
    const toast = vi.fn();
    notifyDispatchOutcome(toast, cmd, { ok: false, error: "Nope" });

    expect(toast.mock.calls[0]?.[0]).not.toHaveProperty("duration");
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
  it("reports the swallowed rejection to Sentry, tagged with the command", async () => {
    const boom = new Error("QuotaExceededError");
    const dispatch = vi.fn().mockRejectedValue(boom);

    await runDispatch(dispatch, command, "args");

    // The tag is load-bearing: catching these moves them off Sentry's
    // `is:unhandled` filter, so it is what keeps the class findable.
    expect(captureException).toHaveBeenCalledWith(boom, {
      tags: { slash_command: "poll" },
    });
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

/**
 * #1733 review — an UNKNOWN outcome must not borrow either neighbour's title.
 */
describe("notifyDispatchOutcome — unconfirmed (#1733)", () => {
  const cmd = "points";

  it("does not title an unknown outcome as a failure", () => {
    const toast = vi.fn();
    notifyDispatchOutcome(toast, cmd, {
      ok: true,
      unconfirmed: true,
      warning: "We couldn't confirm whether these points were recorded.",
    });

    const arg = toast.mock.calls[0]![0];
    expect(arg.title).not.toMatch(/failed/i);
    expect(arg.variant).toBeUndefined();
  });

  // The mirror hazard: "partly succeeded" asserts the write committed. On a
  // `/points deduct` that reads as "the fine landed", and it is silently lost.
  it("does not title an unknown outcome as a partial success", () => {
    const toast = vi.fn();
    notifyDispatchOutcome(toast, cmd, {
      ok: true,
      unconfirmed: true,
      warning: "We couldn't confirm whether these points were recorded.",
    });

    const arg = toast.mock.calls[0]![0];
    expect(arg.title).not.toMatch(/succeeded/i);
    expect(arg.title).toMatch(/not confirmed/i);
  });

  // Sticky so an unreconstructable outcome does not vanish on a 5s timer.
  // Sticky is NOT durable: `use-toast` evicts on the next ADD_TOAST regardless
  // of duration (#1789), which is why the copy has to stand alone.
  it("does not let an unknown outcome expire on a timer", () => {
    const toast = vi.fn();
    notifyDispatchOutcome(toast, cmd, {
      ok: true,
      unconfirmed: true,
      warning: "x",
    });

    expect(toast.mock.calls[0]![0].duration).toBe(Infinity);
  });

  it("reports a resolved retry rather than staying silent", () => {
    const toast = vi.fn();
    notifyDispatchOutcome(toast, cmd, { ok: true, resolved: "Points recorded." });

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]![0].title).toMatch(/recorded/i);
  });
});

/**
 * Lane 3 acceptance (#2142). The board's rule is that help lives behind `?` and
 * nowhere else (`3b`), which is narrower than "shorten the hint" — a permanent
 * line teaching two shortcuts is chrome a member reads once and looks past
 * forever, in a row that is otherwise all controls.
 */
describe("Composer help and controls (#2142)", () => {
  it("narrates nothing in the toolbar", async () => {
    render(<Composer {...baseProps()} />);

    expect(screen.queryByText(/Shift\+Enter for a new line ·/)).toBeNull();
    expect(screen.queryByText(/Cmd\+\/ for slash commands/)).toBeNull();
  });

  it("states the shortcuts behind ?, including the @ mention the old line never did", async () => {
    const user = userEvent.setup();
    render(<Composer {...baseProps()} />);

    await user.click(screen.getByRole("button", { name: "Composing help" }));

    const help = await screen.findByText(/Shift\+Enter for a new line\./);
    expect(help).toHaveTextContent("/ for commands. @ to mention.");
  });

  it("sends from a text button, not a 48px icon button", () => {
    render(<Composer {...baseProps()} />);

    const send = screen.getByRole("button", { name: "Send" });
    // `1t`: "Composer 48px Send with icon → 32px text button shrunk".
    expect(send.className).toContain("h-8");
    expect(send.querySelector("svg")).toBeNull();
  });
});


/**
 * #2130 — the chat mint used to return a camelCase ticket through an
 * undocumented 201, and the composer read it with an `as unknown as` cast, so
 * a wire-name change would have surfaced as a silently undefined storagePath
 * rather than a failure. The client now goes through `readSignedUpload`, the
 * same helper Backwork and Documents use, which reads only the documented
 * snake_case contract.
 */
describe("Composer attachment ticket contract", () => {
  const fileInputOf = (container: HTMLElement) =>
    container.querySelector('input[type="file"]') as HTMLInputElement;

  const attach = async (container: HTMLElement) => {
    const file = new File(["%PDF-1.4"], "notes.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(fileInputOf(container), { target: { files: [file] } });
  };

  beforeEach(() => {
    mockToast.mockClear();
    mockUploadSignedUrl.mockClear();
    mockRequestUploadUrl.mockClear();
  });

  it("PUTs the bytes to the snake_case upload_url", async () => {
    mockRequestUploadUrl.mockResolvedValueOnce({
      upload_url: "https://storage.example/put",
      storage_path: "chapters/c/chat/ch/m/notes.pdf",
      message_id: "m",
    });

    const { container } = render(<Composer {...baseProps()} />);
    await attach(container);

    await waitFor(() =>
      expect(mockUploadSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({ signedUrl: "https://storage.example/put" }),
      ),
    );
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("PUTs with the resolved content type, not the browser's empty one", async () => {
    // A legacy .doc often arrives with `type: ""`. The composer mints the URL
    // with the extension-resolved type, and the chat bucket's MIME allowlist
    // rejects an empty Content-Type, so the PUT must carry the resolved one.
    mockRequestUploadUrl.mockResolvedValueOnce({
      upload_url: "https://storage.example/put",
      storage_path: "chapters/c/chat/ch/m/minutes.doc",
      message_id: "m",
    });

    const { container } = render(<Composer {...baseProps()} />);
    const file = new File(["bytes"], "minutes.doc", { type: "" });
    fireEvent.change(fileInputOf(container), { target: { files: [file] } });

    await waitFor(() =>
      expect(mockRequestUploadUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ content_type: "application/msword" }),
        }),
      ),
    );
    await waitFor(() =>
      expect(mockUploadSignedUrl).toHaveBeenCalledWith({
        signedUrl: "https://storage.example/put",
        file,
        contentType: "application/msword",
      }),
    );
  });

  it("toasts when the ticket omits the signed URL", async () => {
    mockRequestUploadUrl.mockResolvedValueOnce({
      storage_path: "chapters/c/chat/ch/m/notes.pdf",
      message_id: "m",
    });

    const { container } = render(<Composer {...baseProps()} />);
    await attach(container);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't upload file",
          description:
            "Upload URL response missing signed URL or storage path.",
        }),
      ),
    );
    expect(mockUploadSignedUrl).not.toHaveBeenCalled();
  });

  it("rejects a camelCase-only ticket rather than staging an undefined path", async () => {
    mockRequestUploadUrl.mockResolvedValueOnce({
      signedUrl: "https://storage.example/put",
      storagePath: "chapters/c/chat/ch/m/notes.pdf",
      messageId: "m",
    });

    const { container } = render(<Composer {...baseProps()} />);
    await attach(container);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description:
            "Upload URL response missing signed URL or storage path.",
        }),
      ),
    );
    expect(mockUploadSignedUrl).not.toHaveBeenCalled();
  });

  // #2199: the mint rethrows the API's parsed body, a plain object. Read as
  // "not an Error", every refusal used to say "Retry in a moment.", including
  // a member who had lost posting rights and could never succeed.
  it("shows a mint refusal's own reason, not retry advice", async () => {
    mockRequestUploadUrl.mockRejectedValueOnce({
      statusCode: 403,
      error: "Forbidden",
      message: "You do not have access to this channel",
    });

    const { container } = render(<Composer {...baseProps()} />);
    await attach(container);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't upload file",
          description: "You do not have access to this channel",
        }),
      ),
    );
    expect(mockUploadSignedUrl).not.toHaveBeenCalled();
  });

  it("keeps retry advice for a mint failure that a retry can fix", async () => {
    mockRequestUploadUrl.mockRejectedValueOnce({
      statusCode: 500,
      error: "Internal Server Error",
      message: "Internal server error",
    });

    const { container } = render(<Composer {...baseProps()} />);
    await attach(container);

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Retry in a moment." }),
      ),
    );
  });
});

describe("uploadFailureDescription (#2199)", () => {
  it("gives a definitive 4xx body's message", () => {
    expect(
      uploadFailureDescription({
        statusCode: 400,
        error: "Bad Request",
        message: "File exceeds the 25 MB upload limit",
      }),
    ).toBe("File exceeds the 25 MB upload limit");
  });

  it("tells a member to wait a minute after a 429, not a moment", () => {
    expect(
      uploadFailureDescription({
        statusCode: 429,
        error: "Too Many Requests",
        message: "Too Many Requests",
      }),
    ).toBe("Too many requests in a short time. Wait a minute, then try again.");
  });

  it("treats a proxy 408 and a body with no status as transient", () => {
    expect(
      uploadFailureDescription({ statusCode: 408, message: "Request Timeout" }),
    ).toBe("Retry in a moment.");
    expect(uploadFailureDescription({ message: "Something" })).toBe(
      "Retry in a moment.",
    );
    expect(uploadFailureDescription(undefined)).toBe("Retry in a moment.");
  });

  it("keeps a thrown Error's message, as before", () => {
    expect(uploadFailureDescription(new Error("Upload failed (413)"))).toBe(
      "Upload failed (413)",
    );
  });
});

/**
 * The composer that exists before there is a channel (#2176).
 *
 * `1s` puts "composer shell" in the 0ms SSR set and budgets "composer focusable
 * <= 400ms"; `<Composer>` is gated on `activeChannel`, so until this component
 * the only thing in the thread column during a cold load was an `aria-hidden`
 * box. These cases are the contract that replaced it: it takes focus, it takes
 * text, it does not pretend to send, and it occupies exactly the space the real
 * composer will.
 */
describe("ComposerShell (#2176)", () => {
  /**
   * Server-render into a detached host, hand it to React, and take it away
   * again afterwards.
   *
   * The teardown is the part that matters: RTL only cleans up containers it
   * created, so a host left in `document.body` keeps a second element named
   * "Message composer" alive for the rest of the file. The next `screen.getBy…`
   * added to this suite would fail with "found multiple elements", and it would
   * read as a bug in that new test rather than as leakage from this one.
   */
  const hydrated: Array<() => void> = [];
  async function serverRenderThenHydrate(
    ssr: React.ReactElement,
    client: React.ReactElement,
  ) {
    const host = document.createElement("div");
    host.innerHTML = renderToString(ssr);
    document.body.appendChild(host);
    const textarea = host.querySelector("textarea");
    return {
      host,
      textarea,
      hydrate: async () => {
        const root = await act(async () => hydrateRoot(host, client));
        hydrated.push(() => {
          root.unmount();
          host.remove();
        });
      },
    };
  }

  afterEach(() => {
    while (hydrated.length) hydrated.pop()!();
  });

  it("offers a control the member can type into before any channel exists", () => {
    render(<ComposerShell />);

    const input = screen.getByRole("textbox", { name: "Message composer" });
    expect(input).toBeEnabled();
    expect(input).not.toHaveAttribute("readonly");
  });

  it("is reachable by assistive tech, unlike the inert box it replaces", () => {
    // `ComposerSkeleton` was `aria-hidden` on the explicit grounds that a
    // focusable-looking control which cannot take a message is worse than an
    // obvious placeholder. This one takes the message, so hiding it would now
    // conceal the only interactive thing on the route during a cold load.
    const { container } = render(<ComposerShell />);

    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
  });

  it("reports every keystroke, so the text outlives its own unmount", async () => {
    // The shell is unmounted by the render that mounts `<Composer>`. Nothing
    // inside it survives that, which is why the text is pushed out on change
    // rather than read back at handoff time.
    const onTextChange = vi.fn();
    render(<ComposerShell onTextChange={onTextChange} />);

    await userEvent.type(
      screen.getByRole("textbox", { name: "Message composer" }),
      "hi",
    );

    expect(onTextChange).toHaveBeenLastCalledWith("hi");
  });

  it("swallows Enter rather than breaking the line — there is nothing to send to yet", async () => {
    const onTextChange = vi.fn();
    render(<ComposerShell onTextChange={onTextChange} />);
    const input = screen.getByRole("textbox", { name: "Message composer" });

    await userEvent.type(input, "hi{Enter}");

    // Not merely "did not send" — a newline would mean the member's press of
    // the send key arrives in the editor a moment later as a stray blank line.
    expect(input).toHaveValue("hi");
  });

  it("swallows Shift+Enter too, unlike the real composer", async () => {
    /*
      A newline here would not survive the handoff intact. The draft path splits
      on "\n" into one paragraph per line and Tiptap's `getText` rejoins blocks
      with its default "\n\n", so a line break the shell contributes comes back
      doubled — and doubles again every save/restore cycle. That asymmetry is
      older than this component; the shell just declines to feed it.
    */
    render(<ComposerShell />);
    const input = screen.getByRole("textbox", { name: "Message composer" });

    await userEvent.type(input, "a{Shift>}{Enter}{/Shift}b");

    expect(input).toHaveValue("ab");
  });

  it("lets an IME commit its candidate with Enter", async () => {
    /*
      Enter during composition commits the candidate the member is assembling —
      swallowing it makes Japanese, Chinese and Korean input impossible to
      finish. The real composer gets this right by being a ProseMirror keymap
      with composition state; a DOM `keydown` has to ask.
    */
    const onTextChange = vi.fn();
    render(<ComposerShell onTextChange={onTextChange} />);
    const input = screen.getByRole("textbox", { name: "Message composer" });

    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(enter, "isComposing", { value: true });
    input.dispatchEvent(enter);

    expect(enter.defaultPrevented).toBe(false);
  });

  it("answers a press of Enter instead of swallowing it silently", async () => {
    // `connection-state.md`: a control that ignores an activation is a dead
    // control, and the reason has to be on the control rather than near it.
    render(<ComposerShell />);
    const input = screen.getByRole("textbox", { name: "Message composer" });

    const hintId = input.getAttribute("aria-describedby");
    expect(hintId).toBeTruthy();
    const hint = document.getElementById(hintId!);
    // Described from the first render, so a screen reader hears why before
    // trying — and only shown once they have actually tried.
    // The exact string, so the writing.md §7 row and the no-em-dash product
    // copy lock (spec/ui/web-dashboard/README.md) cannot drift from it.
    expect(hint?.textContent).toBe(
      "Still opening your channels. You can keep typing.",
    );
    expect(hint).toHaveClass("sr-only");

    await userEvent.type(input, "roster is 41 tonight{Enter}");

    expect(hint).not.toHaveClass("sr-only");
  });

  it("grows with its content, as the editor that replaces it does", async () => {
    /*
      The CLS case the shared class strings cannot cover. `COMPOSER_INPUT_CLASS`
      gives both surfaces the same envelope, but a textarea does not grow inside
      it on its own while ProseMirror does — so a shell pinned at one line while
      the member types five would hand off to an editor that renders five and
      push the whole bottom-aligned timeline up.
    */
    render(<ComposerShell />);
    const input = screen.getByRole("textbox", {
      name: "Message composer",
    }) as HTMLTextAreaElement;
    // jsdom lays nothing out, so `scrollHeight` is 0 until it is told.
    Object.defineProperty(input, "scrollHeight", {
      configurable: true,
      value: 125,
    });

    fireEvent.change(input, { target: { value: "one\ntwo\nthree\nfour" } });

    expect(input.style.height).toBe("125px");
  });

  it("reports focus entering and leaving, which is what the upgrade carries", async () => {
    const onFocusChange = vi.fn();
    render(
      <>
        <ComposerShell onFocusChange={onFocusChange} />
        <button type="button">elsewhere</button>
      </>,
    );

    await userEvent.click(
      screen.getByRole("textbox", { name: "Message composer" }),
    );
    expect(onFocusChange).toHaveBeenLastCalledWith(true);

    await userEvent.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(onFocusChange).toHaveBeenLastCalledWith(false);
  });

  it("keeps text typed before hydration", async () => {
    /*
      The literal 0ms claim, and the reason this is an uncontrolled `<textarea>`
      rather than a controlled one. The shell is static markup in the RSC
      payload, so the browser can focus it and accept keystrokes long before
      `/chat`'s ~827 KB of eager chat chunk has hydrated. That is only worth
      anything if React does not then throw the keystrokes away when it adopts
      the DOM it was handed.
    */
    const { host, textarea, hydrate } = await serverRenderThenHydrate(
      <ComposerShell />,
      <ComposerShell />,
    );
    expect(textarea).not.toBeNull();
    textarea!.value = "typed while the bundle was still loading";

    await hydrate();

    expect(host.querySelector("textarea")).toHaveValue(
      "typed while the bundle was still loading",
    );
  });

  it("adopts text typed before React attached", async () => {
    /*
      The half that makes being focusable at first paint worth anything. A
      member can type into the server-rendered textarea while the chat chunk is
      still parsing, but `onChange` is React's and React is not there yet — so
      without this the keystrokes live in the DOM, nothing downstream hears
      about them, and the upgrade they were typed to survive drops them.
    */
    const onTextChange = vi.fn();
    const { textarea, hydrate } = await serverRenderThenHydrate(
      <ComposerShell />,
      <ComposerShell onTextChange={onTextChange} />,
    );
    textarea!.value = "typed before React";

    await hydrate();

    expect(onTextChange).toHaveBeenCalledWith("typed before React");
  });

  it("adopts focus the member gave it before React attached", async () => {
    // Same gap, for the caret: `onFocus` had no listener either, so the upgrade
    // would hand the caret to `document.body` mid-sentence.
    const onFocusChange = vi.fn();
    const { textarea, hydrate } = await serverRenderThenHydrate(
      <ComposerShell />,
      <ComposerShell onFocusChange={onFocusChange} />,
    );
    textarea!.focus();

    await hydrate();

    expect(onFocusChange).toHaveBeenCalledWith(true);
  });

  it("says nothing about focus the member never gave it", async () => {
    const onFocusChange = vi.fn();
    const { hydrate } = await serverRenderThenHydrate(
      <ComposerShell />,
      <ComposerShell onFocusChange={onFocusChange} />,
    );

    await hydrate();

    expect(onFocusChange).not.toHaveBeenCalled();
  });

  it("reserves exactly the real composer's box, so the upgrade shifts nothing", () => {
    /*
      `1s` budgets zero CLS above the composer, and the composer is the bottom
      of a bottom-aligned column — a height change here pushes every row above
      it. Asserted against the real component rather than against a copy of its
      class strings: a hand-copied list is what drifts.
    */
    const shell = render(<ComposerShell />).container;
    const real = render(<Composer {...baseProps()} />).container;

    const box = (root: HTMLElement) => root.firstElementChild!;
    const well = (root: HTMLElement) => box(root).firstElementChild!;

    for (const cls of COMPOSER_BOX_CLASS.split(" ")) {
      expect(box(shell).className).toContain(cls);
      expect(box(real).className).toContain(cls);
    }
    for (const cls of COMPOSER_WELL_CLASS.split(" ")) {
      expect(well(shell).className).toContain(cls);
      expect(well(real).className).toContain(cls);
    }
  });

  it("reserves the toolbar row at both pointer sizes", () => {
    // `compactControlClassName` and the Send button are `h-8 pointer-coarse:h-11`,
    // so a shell that reserved only `h-8` left a 12px shift on touch devices —
    // which is what `ComposerSkeleton` did.
    const { container } = render(<ComposerShell />);
    const reserved = container.querySelector(
      `[class*="${COMPOSER_TOOLBAR_CLASS.split(" ")[1]}"]`,
    );

    expect(reserved).not.toBeNull();
    expect(reserved!.className).toContain("pointer-coarse:h-11");
  });

  it("gives its input the same height envelope the editor gets", () => {
    const { container } = render(<ComposerShell />);

    const input = container.querySelector("textarea")!;
    for (const cls of COMPOSER_INPUT_CLASS.split(" ")) {
      expect(input.className).toContain(cls);
    }
  });
});
