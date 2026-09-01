import { render } from "@testing-library/react";
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
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { Composer, composerPlaceholder } from "./composer";

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
