import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

const {
  Composer: RealComposer,
  deferredComposer,
  deferredPanel,
  preloadComposer,
} = await import("./deferred-panels");
const { takeDroppedFiles } = await import("./composer-shell");
type ComposerProps = import("./deferred-panels").DeferredComposerProps;

/** Stands in for `./composer`'s editor: what it was handed. */
function FakeEditor({ draft, claimShellFocus }: ComposerProps) {
  const [focus] = useState(() => claimShellFocus?.());
  return (
    <p data-testid="editor" data-focus={String(focus)}>
      {draft}
    </p>
  );
}

/** Every prop the composer requires, none of which the stand-in reads. */
const composerProps = {
  channelId: "c1",
  channelName: "general",
  isReadOnly: false,
  isModuleEnabled: () => true,
  draft: "",
  onChangeDraft: () => undefined,
  onSend: async () => ({ ok: true }),
  onTyping: () => undefined,
} as unknown as ComposerProps;

function chunkError(): Error {
  const error = new Error("Failed to load chunk /_next/static/chunks/x.js");
  error.name = "ChunkLoadError";
  return error;
}

/** A panel with its own state, so a remount is visible. */
function Counter({ label }: { label: string }) {
  const [count, setCount] = useState(0);
  return (
    <button type="button" onClick={() => setCount((n) => n + 1)}>
      {label} {count}
    </button>
  );
}

describe("deferredPanel (#3716)", () => {
  it("draws a failed load in its own place, and Try again loads it afresh", async () => {
    const load = vi
      .fn<() => Promise<typeof Counter>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(Counter);
    const Panel = deferredPanel(load, "slot");
    render(<Panel label="Poll" />);

    expect(await screen.findByText(/Couldn't load this\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("button", { name: "Poll 0" }),
    ).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("offers Reload, not a retry, for a chunk a deploy removed", async () => {
    const Panel = deferredPanel<{ label: string }>(
      () => Promise.reject(chunkError()),
      "slot",
    );
    render(<Panel label="Poll" />);
    expect(
      await screen.findByText(/Frapp was updated while this tab was open/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("keeps a loaded panel mounted when its parent re-renders", async () => {
    const Panel = deferredPanel(() => Promise.resolve(Counter), "slot");
    function Parent() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <button type="button" onClick={() => setTick((n) => n + 1)}>
            tick {tick}
          </button>
          <Panel label="Poll" />
        </>
      );
    }
    render(<Parent />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Poll 0" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "tick 0" }));
    expect(screen.getByRole("button", { name: "Poll 1" })).toBeInTheDocument();
  });

  it("loads a dialog only when open; a failure closes it and the next open retries", async () => {
    function Dialog({
      open,
    }: {
      open?: boolean;
      onOpenChange?: (o: boolean) => void;
    }) {
      return open ? <p>dialog open</p> : null;
    }
    const load = vi
      .fn<() => Promise<typeof Dialog>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue(Dialog);
    const Panel = deferredPanel(load, "dialog");
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Panel open={false} onOpenChange={onOpenChange} />,
    );
    expect(load).not.toHaveBeenCalled();

    rerender(<Panel open onOpenChange={onOpenChange} />);
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Couldn't open this" }),
    );

    rerender(<Panel open={false} onOpenChange={onOpenChange} />);
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      rerender(<Panel open onOpenChange={onOpenChange} />);
    });
    expect(await screen.findByText("dialog open")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("deferred Composer (#5050)", () => {
  it("draws code a preload adopted on the first render, with no fallback", () => {
    const Composer = deferredComposer(() => new Promise(() => undefined));
    Composer.adopt(FakeEditor);
    render(<Composer {...composerProps} draft="kept" />);
    expect(screen.getByTestId("editor")).toHaveTextContent("kept");
  });

  it("takes focus and text in the shell, and hands both to the editor when it arrives", async () => {
    let arrive: (editor: typeof FakeEditor) => void = () => undefined;
    const Composer = deferredComposer(
      () => new Promise((resolve) => (arrive = resolve)),
    );
    function Host() {
      const [draft, setDraft] = useState("");
      const focused = useRef(false);
      return (
        <Composer
          {...composerProps}
          draft={draft}
          onChangeDraft={setDraft}
          onShellFocusChange={(on) => {
            focused.current = on;
          }}
          claimShellFocus={() => focused.current}
        />
      );
    }
    render(<Host />);
    const shell = screen.getByRole("textbox", { name: "Message composer" });
    await userEvent.type(shell, "hello there");
    await userEvent.keyboard("{Enter}");
    expect(
      screen.getByText("Still opening the composer. You can keep typing."),
    ).toBeVisible();

    await act(async () => arrive(FakeEditor));
    const editor = await screen.findByTestId("editor");
    expect(editor).toHaveTextContent("hello there");
    expect(editor).toHaveAttribute("data-focus", "true");
  });

  it("draws nothing while loading where the member can't post", () => {
    const Composer = deferredComposer(() => new Promise(() => undefined));
    const { container, rerender } = render(
      <Composer {...composerProps} isReadOnly />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<Composer {...composerProps} isAuditLog />);
    expect(container).toBeEmptyDOMElement();
  });

  it("follows a draft restored after it mounts, and claims nothing on mount", async () => {
    const Composer = deferredComposer(() => new Promise(() => undefined));
    const onChangeDraft = vi.fn();
    const { rerender } = render(
      <Composer {...composerProps} draft="" onChangeDraft={onChangeDraft} />,
    );
    // Dexie answers after the stand-in mounted.
    rerender(
      <Composer
        {...composerProps}
        draft="yesterday's paragraph"
        onChangeDraft={onChangeDraft}
      />,
    );
    const shell = screen.getByRole("textbox", { name: "Message composer" });
    expect(shell).toHaveValue("yesterday's paragraph");
    expect(onChangeDraft).not.toHaveBeenCalled();
    await userEvent.type(shell, "!");
    expect(onChangeDraft).toHaveBeenLastCalledWith("yesterday's paragraph!");
  });

  it("never reports a seeded draft as typed, so a channel switch can't move it", () => {
    const Composer = deferredComposer(() => new Promise(() => undefined));
    const onChangeDraft = vi.fn();
    render(
      <Composer
        {...composerProps}
        channelId="c2"
        draft="text from the last channel"
        onChangeDraft={onChangeDraft}
      />,
    );
    expect(onChangeDraft).not.toHaveBeenCalled();
  });

  it("takes the caret the first shell held, and re-arms it for the editor", () => {
    const Composer = deferredComposer(() => new Promise(() => undefined));
    const onShellFocusChange = vi.fn();
    render(
      <Composer
        {...composerProps}
        draft="half a sentence"
        claimShellFocus={() => true}
        onShellFocusChange={onShellFocusChange}
      />,
    );
    const shell = screen.getByRole("textbox", { name: "Message composer" });
    expect(shell).toHaveFocus();
    expect((shell as HTMLTextAreaElement).selectionStart).toBe(
      "half a sentence".length,
    );
    expect(onShellFocusChange).toHaveBeenCalledWith(true);
  });

  it("says the member is typing, and holds files dropped before the editor", async () => {
    const Composer = deferredComposer(() => new Promise(() => undefined));
    const onTyping = vi.fn();
    const dropAttachRef = { current: null as ((files: File[]) => void) | null };
    render(
      <Composer
        {...composerProps}
        onTyping={onTyping}
        dropAttachRef={dropAttachRef}
      />,
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Message composer" }),
      "hi",
    );
    expect(onTyping).toHaveBeenCalled();
    const photo = new File(["x"], "photo.png", { type: "image/png" });
    dropAttachRef.current?.([photo]);
    expect(takeDroppedFiles("other-channel")).toEqual([]);
    dropAttachRef.current?.([photo]);
    expect(takeDroppedFiles("c1")).toEqual([photo]);
  });

  it("hands the preloaded editor to the composer, so its first mount skips Suspense", async () => {
    const adopt = vi.spyOn(RealComposer, "adopt");
    await preloadComposer();
    expect(adopt).toHaveBeenCalledWith(expect.any(Function));
    adopt.mockRestore();
  });
});
