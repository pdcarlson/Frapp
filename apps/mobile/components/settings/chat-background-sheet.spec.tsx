/** @vitest-environment jsdom */
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({
  current: { data: { background: "midnight", photo_url: null } as unknown, isError: false },
  setDefault: vi.fn(),
  requestUrl: vi.fn(),
}));
const save = vi.hoisted(() => vi.fn());

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({
    accent: "#CB9FFF",
    accentPrimary: "#8E4EC6",
    accentOnPrimary: "#FFFFFF",
    accentSubtle: "#251A33",
    accentBorder: "#5C3E8A",
    logoUrl: null,
    chapterName: "Alpha Beta",
    textMark: null,
  }),
}));
vi.mock("@repo/hooks", () => ({
  useChatBackground: () => ({ data: undefined }),
  useChapterChatBackground: () => hooks.current,
  useSetChapterChatBackground: () => ({ mutateAsync: hooks.setDefault }),
  useRequestChatBackgroundPhotoUrl: () => ({ mutateAsync: hooks.requestUrl }),
}));
vi.mock("@/lib/chat/chat-background-photo", () => ({
  saveChatBackgroundPick: save,
}));

import { FrappThemeProvider } from "@/lib/theme";
import { ChatBackgroundDefaultPicker } from "./chat-background-sheet";

/** Settings → Chat background (#4031): the chapter default's save. */
function render(onSaved = vi.fn()) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <ChatBackgroundDefaultPicker onSaved={onSaved} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const swatch = (tree: ReactTestRenderer, key: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.testID === `chat-background-swatch-${key}`,
  );

const text = (tree: ReactTestRenderer) =>
  tree.root
    .findAll((node) => (node.type as unknown) === "Text")
    .map((node) => [node.props.children].flat().join(""))
    .join("\n");

describe("ChatBackgroundDefaultPicker", () => {
  beforeEach(() => {
    save.mockReset();
    hooks.setDefault.mockReset();
    hooks.requestUrl.mockReset();
  });

  it("offers no Chapter default, marks the stored default, and closes on re-picking it without a write", () => {
    const onSaved = vi.fn();
    const tree = render(onSaved);
    expect(
      tree.root.findAll(
        (node) => node.props.testID === "chat-background-swatch-inherit",
      ),
    ).toHaveLength(0);
    expect(swatch(tree, "midnight").props.accessibilityState.checked).toBe(true);
    act(() => swatch(tree, "midnight").props.onPress());
    expect(save).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it("saves a pick on the default's own routes, then closes", async () => {
    save.mockResolvedValue({ status: "saved" });
    hooks.setDefault.mockResolvedValue(undefined);
    const onSaved = vi.fn();
    const tree = render(onSaved);
    await act(async () => {
      swatch(tree, "photo").props.onPress();
    });
    const [pick, deps] = save.mock.calls[0]!;
    expect(pick).toBe("photo");
    await deps.requestPhotoUrl({ filename: "a.jpg", contentType: "image/jpeg" });
    expect(hooks.requestUrl).toHaveBeenCalledWith({
      scope: "default",
      filename: "a.jpg",
      contentType: "image/jpeg",
    });
    await deps.save({ background: "photo", storagePath: "p" });
    expect(hooks.setDefault).toHaveBeenCalledWith({
      background: "photo",
      storagePath: "p",
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("stays open and says why when the save is refused", async () => {
    save.mockResolvedValue({ status: "refused", reason: "Not allowed." });
    const onSaved = vi.fn();
    const tree = render(onSaved);
    await act(async () => {
      swatch(tree, "letters").props.onPress();
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(text(tree)).toContain("Not allowed.");
  });
});
