/** @vitest-environment jsdom */
import React from "react";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { act } from "react";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";

const mint = vi.hoisted(() => vi.fn());
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRequestTaskPhotoUploadUrl: () => ({ mutateAsync: mint }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

import { MarkDoneSheet, type MarkDoneSheetTask } from "./mark-done-sheet";

const TASK: MarkDoneSheetTask = {
  id: "t1",
  title: "Mop the kitchen",
  proofKind: "none",
  sentBack: false,
  sentBackReason: null,
};

function render(
  task: Partial<MarkDoneSheetTask>,
  onComplete = vi.fn(async () => {}),
  initialProblem: string | null = null,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MarkDoneSheet
          task={{ ...TASK, ...task }}
          initialProblem={initialProblem}
          onComplete={onComplete}
          onClosed={() => {}}
        />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function field(tree: ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      node.props.accessibilityLabel === label &&
      typeof node.props.onChangeText === "function",
  );
}

/** The sheet's Mark done: its primary button, after the header. */
function markDone(tree: ReactTestRenderer) {
  const buttons = tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityRole === "button" &&
      node.findAll((child) => child.props?.children === "Mark done").length > 0,
  );
  return buttons[buttons.length - 1]!;
}

async function press(node: ReactTestInstance) {
  await act(async () => {
    node.props.onPress();
  });
}

beforeEach(() => {
  mint.mockReset();
  vi.mocked(FileSystem.uploadAsync)
    .mockReset()
    .mockResolvedValue({ status: 200, body: "", headers: {} } as never);
});

describe("MarkDoneSheet (#4635)", () => {
  it("asks for a photo on a Photo task before it sends", async () => {
    const onComplete = vi.fn(async () => {});
    const tree = render({ proofKind: "photo" }, onComplete);
    expect(screenText(tree)).toContain("Photos of the finished job");
    await press(markDone(tree));
    expect(onComplete).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(
      "Add at least one photo of the finished job.",
    );
  });

  it("uploads the picked photos, then sends their paths", async () => {
    vi.mocked(
      ImagePicker.requestMediaLibraryPermissionsAsync,
    ).mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///a.png",
          fileName: "a.png",
          mimeType: "image/png",
          width: 10,
          height: 10,
          fileSize: 100,
        },
      ],
    } as never);
    mint.mockResolvedValue({
      upload_url: "https://signed",
      storage_path: "chapters/c/tasks/p1/a.png",
    });
    const onComplete = vi.fn(async () => {});
    const tree = render({ proofKind: "photo" }, onComplete);
    const add = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Add photos",
    );
    await press(add);
    await press(markDone(tree));
    expect(mint).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "a.png", content_type: "image/png" }),
    );
    expect(onComplete).toHaveBeenCalledWith({
      proof_photo_paths: ["chapters/c/tasks/p1/a.png"],
    });
  });

  it("takes a link on a Link task, and refuses one that isn't http(s)", async () => {
    const onComplete = vi.fn(async () => {});
    const tree = render({ proofKind: "link" }, onComplete);
    act(() => field(tree, "Link").props.onChangeText("ftp://x"));
    await press(markDone(tree));
    expect(onComplete).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(
      "Use a web link that starts with http:// or https://.",
    );
    act(() =>
      field(tree, "Link").props.onChangeText("https://docs.example.com/a"),
    );
    await press(markDone(tree));
    expect(onComplete).toHaveBeenCalledWith({
      proof_link: "https://docs.example.com/a",
    });
  });

  it("shows the reason on a sent-back task and needs proof or a reply", async () => {
    const onComplete = vi.fn(async () => {});
    const tree = render(
      { sentBack: true, sentBackReason: "Floor is still sticky" },
      onComplete,
    );
    const text = screenText(tree);
    expect(text).toContain("Sent back: ");
    expect(text).toContain("Floor is still sticky");
    expect(text).toContain("Reply to the officer");
    await press(markDone(tree));
    expect(onComplete).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain(
      "Add proof or reply to the officer before marking it done.",
    );
    act(() =>
      field(tree, "Reply to the officer").props.onChangeText("Mopped it twice"),
    );
    await press(markDone(tree));
    expect(onComplete).toHaveBeenCalledWith({
      completion_note: "Mopped it twice",
    });
  });

  it("opens with the line a refused direct Mark done gave", () => {
    const tree = render(
      {},
      undefined,
      "This task needs proof to show it's done.",
    );
    expect(screenText(tree)).toContain(
      "This task needs proof to show it's done.",
    );
  });

  it("says a refusal and stays open, in the member's words", async () => {
    const onComplete = vi.fn(async () => {
      throw {
        statusCode: 403,
        error: "Forbidden",
        message:
          "Chapter subscription is not active; complete checkout to use this feature.",
      };
    });
    const tree = render({ sentBack: true }, onComplete);
    act(() => field(tree, "Reply to the officer").props.onChangeText("Done"));
    await press(markDone(tree));
    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.taskStatus);
  });
});
