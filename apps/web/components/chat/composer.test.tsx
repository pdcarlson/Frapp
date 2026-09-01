import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

// Tiptap's ProseMirror view does not render document content into jsdom's
// contenteditable node in this repo's test environment (see chat-shell.test.tsx's
// note on the same gap), so there is no DOM text/attribute this suite can read
// back to prove what the *rendered* placeholder says. Instead this stubs
// `useEditor` to capture the `extensions` array Composer builds on each
// mount — the same shape `@tiptap/react` would otherwise consume — and reads
// the real `Placeholder` extension's `.options.placeholder` off it. That is
// the exact value #1014 found frozen at editor-creation time.
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
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { Composer } from "./composer";

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

describe("Composer placeholder", () => {
  it("builds a channel-sigil placeholder for a real channel on mount", () => {
    capturedExtensions.length = 0;
    render(<Composer {...baseProps({ channelName: "announcements" })} />);
    expect(placeholderTextFrom(capturedExtensions.at(-1)!)).toBe(
      "Message #announcements",
    );
  });

  it("builds a no-sigil placeholder for a DM on mount", () => {
    capturedExtensions.length = 0;
    render(
      <Composer
        {...baseProps({ channelName: "Alice Chen", isDirect: true })}
      />,
    );
    expect(placeholderTextFrom(capturedExtensions.at(-1)!)).toBe(
      "Message Alice Chen",
    );
  });

  it("re-derives the placeholder from a fresh mount, per channel", () => {
    // Extensions (including Placeholder) are instantiated once when
    // `useEditor` creates the editor and are never rebuilt on a prop change
    // — #1014's root cause. `chat-shell.tsx` works around this by giving
    // `<Composer key={activeChannel.id}>` a channel-scoped `key`, forcing a
    // full unmount/mount per switch instead of a same-instance re-render.
    // This asserts the half of that fix this suite can reach without a real
    // ProseMirror view: a *fresh mount* — which the `key` guarantees — always
    // captures the placeholder for the channel active at that mount, never a
    // prior one.
    capturedExtensions.length = 0;
    const { unmount } = render(
      <Composer {...baseProps({ channelName: "general" })} />,
    );
    expect(placeholderTextFrom(capturedExtensions.at(-1)!)).toBe(
      "Message #general",
    );
    unmount();

    render(<Composer {...baseProps({ channelName: "random" })} />);
    expect(placeholderTextFrom(capturedExtensions.at(-1)!)).toBe(
      "Message #random",
    );
  });
});
