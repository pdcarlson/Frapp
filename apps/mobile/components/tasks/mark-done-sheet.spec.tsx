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

import {
  MARK_DONE_ALREADY_DONE,
  MarkDoneSheet,
  type MarkDoneSheetTask,
} from "./mark-done-sheet";

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
  keptDraft?: string,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <MarkDoneSheet
          task={{ ...TASK, ...task }}
          initialProblem={initialProblem}
          keptDraft={keptDraft}
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

  /** Picks one photo through the mocked library, then presses Add photos. */
  async function addPhoto(tree: ReactTestRenderer) {
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
    await press(
      tree.root.find(
        (node) =>
          (node.type as unknown) === "Pressable" &&
          node.props.accessibilityLabel === "Add photos",
      ),
    );
  }

  it("uploads anew after a refusal that dropped the photos, not after one for want of proof", async () => {
    mint.mockReset();
    mint.mockResolvedValue({
      upload_url: "https://signed",
      storage_path: "chapters/c/tasks/p1/a.png",
    });
    // The task changed under the member: the server drops the photos it was
    // sent (#4635's compare-and-set), so their paths can't be sent again.
    const changed = {
      statusCode: 400,
      error: "Bad Request",
      message:
        "This task changed while you were marking it done. Look again and retry.",
    };
    const onComplete = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(changed)
      .mockResolvedValueOnce(undefined);
    const tree = render({ proofKind: "photo" }, onComplete);
    await addPhoto(tree);
    await press(markDone(tree));
    expect(screenText(tree)).toContain("This task changed");
    await press(markDone(tree));
    expect(mint).toHaveBeenCalledTimes(2);

    // A refusal for want of proof is checked before the photos are kept, so
    // they stay up and a retry sends the same paths.
    mint.mockClear();
    const proof = {
      statusCode: 400,
      error: "Bad Request",
      code: "task.resubmit_needs_change",
      message: "Add something new.",
    };
    const again = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(proof)
      .mockResolvedValueOnce(undefined);
    const second = render({ proofKind: "photo" }, again);
    await addPhoto(second);
    await press(markDone(second));
    await press(markDone(second));
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("says a task marked done elsewhere is done, before it uploads anything", async () => {
    mint.mockClear();
    const onComplete = vi.fn(async () => {});
    const tree = render({ proofKind: "photo", done: true }, onComplete);
    await addPhoto(tree);
    await press(markDone(tree));
    expect(screenText(tree)).toContain(MARK_DONE_ALREADY_DONE);
    expect(mint).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
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

/**
 * What was added outlives the sheet (#5041): hosts mount one per Mark done,
 * so a swipe, or going back from Tasks or the chat, used to lose the proof
 * link, the picked photos and the reply to the officer.
 */
describe("MarkDoneSheet's kept proof (#5041)", () => {
  let draftNo = 0;
  const nextDraft = () => `mark-done:t${++draftNo}`;
  const SENT_BACK = {
    proofKind: "link" as const,
    sentBack: true,
    sentBackReason: "No link",
  };
  const open = (name: string, onComplete = vi.fn(async () => {})) =>
    render(SENT_BACK, onComplete, null, name);
  const fill = (tree: ReactTestRenderer) => {
    act(() => field(tree, "Link").props.onChangeText("https://ex.com/a"));
    act(() =>
      field(tree, "Reply to the officer").props.onChangeText("Fixed it"),
    );
  };
  const values = (tree: ReactTestRenderer) => [
    field(tree, "Link").props.value,
    field(tree, "Reply to the officer").props.value,
  ];

  it("keeps the link and the reply for the task's next Mark done", () => {
    const name = nextDraft();
    const first = open(name);
    fill(first);
    act(() => first.unmount());
    const second = open(name);
    expect(values(second)).toEqual(["https://ex.com/a", "Fixed it"]);
    act(() => second.unmount());
  });

  it("keeps the picked photos, to upload again next time", async () => {
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
    const name = nextDraft();
    const first = render({ proofKind: "photo" }, undefined, null, name);
    const add = first.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Add photos",
    );
    await press(add);
    act(() => first.unmount());

    mint.mockResolvedValue({
      upload_url: "https://signed",
      storage_path: "chapters/c/tasks/p1/a.png",
    });
    const onComplete = vi.fn(async () => {});
    const second = render({ proofKind: "photo" }, onComplete, null, name);
    await press(markDone(second));
    expect(onComplete).toHaveBeenCalledWith({
      proof_photo_paths: ["chapters/c/tasks/p1/a.png"],
    });
    act(() => second.unmount());
  });

  it("gives it up on Cancel", () => {
    const name = nextDraft();
    const first = open(name);
    fill(first);
    const header = first.root.find(
      (node) =>
        typeof node.props.onCancel === "function" &&
        typeof node.type === "function",
    );
    act(() => header.props.onCancel());
    act(() => first.unmount());
    const second = open(name);
    expect(values(second)).toEqual(["", ""]);
    act(() => second.unmount());
  });

  it("gives it up once Mark done lands", async () => {
    const name = nextDraft();
    const first = open(name);
    fill(first);
    await press(markDone(first));
    act(() => first.unmount());
    const second = open(name);
    expect(values(second)).toEqual(["", ""]);
    act(() => second.unmount());
  });

  it("holds it out while Mark done is in flight, and puts it back when it fails", async () => {
    const name = nextDraft();
    let fail: (error: unknown) => void = () => {};
    const first = open(
      name,
      vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = reject;
          }),
      ),
    );
    fill(first);
    await press(markDone(first));
    act(() => first.unmount());

    const during = open(name);
    expect(values(during)).toEqual(["", ""]);
    act(() => during.unmount());

    await act(async () => fail({ statusCode: 500, message: "Down" }));
    const after = open(name);
    expect(values(after)).toEqual(["https://ex.com/a", "Fixed it"]);
    act(() => after.unmount());
  });

  it("doesn't bring back proof kept for another proof kind, and drops it", () => {
    const name = nextDraft();
    const first = open(name);
    act(() => field(first, "Link").props.onChangeText("htt"));
    act(() => first.unmount());
    // An officer made it a photo task since: the half-typed link would be
    // checked and sent from a field the sheet no longer draws.
    const onComplete = vi.fn(async () => {});
    const photo = render(
      { ...SENT_BACK, proofKind: "none" },
      onComplete,
      null,
      name,
    );
    act(() =>
      field(photo, "Reply to the officer").props.onChangeText("Fixed it"),
    );
    return press(markDone(photo)).then(() => {
      expect(onComplete).toHaveBeenCalledWith({ completion_note: "Fixed it" });
      act(() => photo.unmount());
    });
  });

  it("doesn't bring back proof kept for an earlier round, and drops it", () => {
    const name = nextDraft();
    const first = render(
      { ...SENT_BACK, sentBackAt: "2026-11-14T10:00:00Z" },
      undefined,
      null,
      name,
    );
    fill(first);
    act(() => first.unmount());
    // Done on web since, then sent back again: a new round.
    const next = render(
      { ...SENT_BACK, sentBackAt: "2026-11-15T09:00:00Z" },
      undefined,
      null,
      name,
    );
    expect(values(next)).toEqual(["", ""]);
    act(() => next.unmount());
    const again = open(name);
    expect(values(again)).toEqual(["", ""]);
    act(() => again.unmount());
  });

  it("holds Cancel while Mark done sends, so a failed send keeps the proof", async () => {
    const name = nextDraft();
    let fail: (error: unknown) => void = () => {};
    const first = open(
      name,
      vi.fn(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = reject;
          }),
      ),
    );
    fill(first);
    const header = first.root.find(
      (node) =>
        typeof node.props.onCancel === "function" &&
        typeof node.type === "function",
    );
    // Cancel handled in the same batch as the send, before it is drawn held.
    await act(async () => {
      markDone(first).props.onPress();
      header.props.onCancel();
    });
    act(() => first.unmount());
    await act(async () => fail({ statusCode: 500, message: "Down" }));
    const after = open(name);
    expect(values(after)).toEqual(["https://ex.com/a", "Fixed it"]);
    act(() => after.unmount());
  });

  it("puts the picks back when their upload is refused", async () => {
    vi.mocked(
      ImagePicker.requestMediaLibraryPermissionsAsync,
    ).mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///b.png",
          fileName: "b.png",
          mimeType: "image/png",
          width: 10,
          height: 10,
          fileSize: 100,
        },
      ],
    } as never);
    mint.mockResolvedValue({
      upload_url: "https://signed",
      storage_path: "chapters/c/tasks/p1/b.png",
    });
    vi.mocked(FileSystem.uploadAsync)
      .mockReset()
      .mockResolvedValue({ status: 500, body: "", headers: {} } as never);
    const name = nextDraft();
    const first = render({ proofKind: "photo" }, undefined, null, name);
    const add = first.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityLabel === "Add photos",
    );
    await press(add);
    await press(markDone(first));
    act(() => first.unmount());

    mint.mockReset();
    mint.mockResolvedValue({
      upload_url: "https://signed",
      storage_path: "chapters/c/tasks/p1/b.png",
    });
    vi.mocked(FileSystem.uploadAsync)
      .mockReset()
      .mockResolvedValue({ status: 200, body: "", headers: {} } as never);
    const onComplete = vi.fn(async () => {});
    const second = render({ proofKind: "photo" }, onComplete, null, name);
    await press(markDone(second));
    expect(onComplete).toHaveBeenCalledWith({
      proof_photo_paths: ["chapters/c/tasks/p1/b.png"],
    });
    act(() => second.unmount());
  });

  it("drops it for a task done somewhere else", () => {
    const name = nextDraft();
    const first = open(name);
    fill(first);
    act(() => first.unmount());
    const done = render({ ...SENT_BACK, done: true }, undefined, null, name);
    act(() => done.unmount());
    const after = open(name);
    expect(values(after)).toEqual(["", ""]);
    act(() => after.unmount());
  });
});
