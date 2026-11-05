/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PickedImage } from "@/lib/chat/attachment-upload";
import type { DocumentUploadResult } from "@/lib/more/document-upload";
import { DocumentsGlyph } from "@/components/more/more-glyphs";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { DOCUMENT_TITLE_MAX_LENGTH } from "@repo/validation";

/**
 * #3399. s21, rendered: nothing is sent until Upload, Upload sends the title
 * and folder chosen, a gate withdraws Upload while a failure keeps the photo
 * for another try, and a sheet closed mid-upload keeps its draft until the
 * upload settles. The wire steps are pinned in `lib/more/document-upload.spec.ts`.
 */

const pickDocumentPhoto = vi.fn();
const uploadDocumentPhoto = vi.fn();

vi.mock("@/lib/more/document-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/more/document-upload")>()),
  pickDocumentPhoto: () => pickDocumentPhoto(),
  uploadDocumentPhoto: (...args: unknown[]) => uploadDocumentPhoto(...args),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useRequestDocumentUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useConfirmDocumentUpload: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  // Not house gold, so a focus border that drifts back to it shows.
  useChapterBranding: () => ({ accent: "#7A3FC2" }),
}));

import {
  RETRY_KEEPS_DRAFT,
  UploadDocumentSheet,
} from "./upload-document-sheet";

const ACCENT = "#7A3FC2";

const PHOTO: PickedImage = {
  uri: "file:///IMG_2041.jpg",
  filename: "IMG_2041.jpg",
  contentType: "image/jpeg",
  byteSize: 223_232,
};

const FOLDERS = [
  { id: "f1", name: "Minutes" },
  { id: "f2", name: "Bylaws" },
];

/** What a confirm that failed after the PUT hands back to retry. */
const SENT = {
  image: PHOTO,
  uploaded: {
    storagePath: "chapters/c/documents/d/IMG_2041.jpg",
    filename: "IMG_2041.jpg",
    contentType: "image/jpeg",
    byteSize: PHOTO.byteSize,
  },
  title: "IMG_2041.jpg",
  folder: null,
};

const dismiss = vi.fn();
const onUploaded = vi.fn();
const mounted: ReactTestRenderer[] = [];
const ref = React.createRef<never>();

function render(
  initialFolder: string | null = null,
  { opened = true }: { opened?: boolean } = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <UploadDocumentSheet
          ref={ref}
          folders={FOLDERS}
          initialFolder={initialFolder}
          onUploaded={onUploaded}
        />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          (element.type as unknown) === "BottomSheetModal"
            ? { dismiss, present: vi.fn() }
            : null,
      },
    );
  });
  mounted.push(tree);
  if (opened) open(tree);
  return tree;
}

const modal = (tree: ReactTestRenderer) =>
  tree.root.find((node) => (node.type as unknown) === "BottomSheetModal");

/** What gorhom reports as `present()` starts bringing the sheet up. */
function open(tree: ReactTestRenderer) {
  act(() => {
    modal(tree).props.onAnimate(-1, 0);
  });
}

/** The sheet finished closing, however it was closed. */
function closed(tree: ReactTestRenderer) {
  act(() => {
    modal(tree).props.onDismiss();
  });
}

const pressable = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      (node.props.accessibilityLabel === label ||
        screenText({ root: node } as unknown as ReactTestRenderer) === label),
  );

const uploadButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityHint !== "Opens your photo library." &&
      node.props.accessibilityState !== undefined &&
      /Upload/.test(screenText({ root: node } as unknown as ReactTestRenderer)),
  );

const titleInput = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "BottomSheetTextInput" &&
      node.props.accessibilityLabel === "Title",
  );

const folderChips = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      node.props.accessibilityLabel === "Folder" && "selected" in node.props,
  );

async function choose(tree: ReactTestRenderer) {
  pickDocumentPhoto.mockResolvedValue({ status: "picked", image: PHOTO });
  await act(async () => {
    pressable(tree, "Choose a photo").props.onPress();
  });
}

/** An upload the spec settles by hand. */
function heldUpload() {
  let settle!: (result: DocumentUploadResult) => void;
  uploadDocumentPhoto.mockImplementation(
    () =>
      new Promise<DocumentUploadResult>((resolve) => {
        settle = resolve;
      }),
  );
  return (result: DocumentUploadResult) => act(async () => settle(result));
}

async function pressUpload(tree: ReactTestRenderer) {
  await act(async () => {
    uploadButton(tree).props.onPress();
  });
}

beforeEach(() => {
  pickDocumentPhoto.mockReset();
  uploadDocumentPhoto.mockReset();
  dismiss.mockReset();
  onUploaded.mockReset();
});

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

describe("UploadDocumentSheet (#3399)", () => {
  it("opens with nothing chosen and Upload off", () => {
    const tree = render();

    expect(screenText(tree)).toContain("Choose a photo");
    expect(uploadButton(tree).props.disabled).toBe(true);
    expect(uploadButton(tree).props.accessibilityHint).toBe(
      "Choose a photo first.",
    );
  });

  it("shows the picked photo's card and sends nothing until Upload", async () => {
    const tree = render();
    await choose(tree);

    const text = screenText(tree);
    expect(text).toContain("IMG_2041.jpg");
    expect(text).toContain("218 KB · from Photos");
    expect(text).toContain("Change");
    // The card's glyph and Change are the chapter accent, not house gold.
    expect(tree.root.findByType(DocumentsGlyph).props.color).toBe(ACCENT);
    const change = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === "Change",
    );
    expect([change.props.style].flat()).toContainEqual(
      expect.objectContaining({ color: ACCENT }),
    );
    expect(titleInput(tree).props.placeholder).toBe("IMG_2041.jpg");
    expect(uploadButton(tree).props.disabled).toBe(false);
    expect(uploadDocumentPhoto).not.toHaveBeenCalled();
  });

  it("says why a pick was refused, and keeps Upload off", async () => {
    const tree = render();
    pickDocumentPhoto.mockResolvedValue({
      status: "refused",
      reason: "Documents can be up to 25 MB.",
    });
    await act(async () => {
      pressable(tree, "Choose a photo").props.onPress();
    });

    expect(screenText(tree)).toContain("Documents can be up to 25 MB.");
    expect(uploadButton(tree).props.disabled).toBe(true);
  });

  it("uploads with the title typed and the folder tapped, then closes", async () => {
    const tree = render();
    await choose(tree);
    act(() => {
      titleInput(tree).props.onChangeText("Minutes — Aug 14");
    });
    act(() => {
      pressable(tree, "Bylaws").props.onPress();
    });
    uploadDocumentPhoto.mockResolvedValue({
      status: "uploaded",
      title: "Minutes — Aug 14",
    });

    await pressUpload(tree);

    expect(uploadDocumentPhoto).toHaveBeenCalledWith(
      PHOTO,
      { title: "Minutes — Aug 14", folder: "Bylaws" },
      expect.any(Object),
      undefined,
    );
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(onUploaded).toHaveBeenCalledWith("Minutes — Aug 14");
  });

  it("starts on s12's folder, and None files at the root", async () => {
    const tree = render("Minutes");
    await choose(tree);
    uploadDocumentPhoto.mockResolvedValue({
      status: "uploaded",
      title: "IMG_2041.jpg",
    });

    await pressUpload(tree);
    expect(uploadDocumentPhoto).toHaveBeenLastCalledWith(
      PHOTO,
      { title: "", folder: "Minutes" },
      expect.any(Object),
      undefined,
    );
    expect(onUploaded).toHaveBeenLastCalledWith("IMG_2041.jpg");

    open(tree);
    await choose(tree);
    act(() => {
      pressable(tree, "None").props.onPress();
    });
    await pressUpload(tree);
    expect(uploadDocumentPhoto).toHaveBeenLastCalledWith(
      PHOTO,
      { title: "", folder: null },
      expect.any(Object),
      undefined,
    );
  });

  it("keeps the photo and offers a retry when an upload fails", async () => {
    const tree = render();
    await choose(tree);
    uploadDocumentPhoto.mockResolvedValue({
      status: "refused",
      reason: "Couldn't upload that photo. Try again in a moment.",
      final: false,
    });

    await pressUpload(tree);

    expect(screenText(tree)).toContain("Try again in a moment.");
    expect(screenText(tree)).toContain("IMG_2041.jpg");
    expect(uploadButton(tree).props.disabled).toBe(false);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("withdraws Upload for a gate only an officer can lift", async () => {
    const tree = render();
    await choose(tree);
    const reason =
      "Your chapter's subscription isn't active, so documents can't be uploaded. An officer can sort this out for the chapter.";
    uploadDocumentPhoto.mockResolvedValue({
      status: "refused",
      reason,
      final: true,
    });

    await pressUpload(tree);

    expect(screenText(tree)).toContain(reason);
    expect(uploadButton(tree).props.disabled).toBe(true);
    expect(uploadButton(tree).props.accessibilityHint).toBe(reason);
  });

  it("sends one upload for two taps in one batch, and reads Uploading…", async () => {
    const tree = render();
    await choose(tree);
    const settle = heldUpload();

    await act(async () => {
      const button = uploadButton(tree);
      button.props.onPress();
      button.props.onPress();
    });

    expect(uploadDocumentPhoto).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain("Uploading…");
    expect(titleInput(tree).props.editable).toBe(false);
    await settle({ status: "uploaded", title: "IMG_2041.jpg" });
  });

  it.each([
    [
      "Cancel",
      (tree: ReactTestRenderer) => {
        act(() => {
          pressable(tree, "Cancel").props.onPress();
        });
        expect(dismiss).toHaveBeenCalledTimes(1);
        closed(tree);
      },
    ],
    // A swipe or a scrim tap reaches the sheet only as `onDismiss`.
    ["a swipe", (tree: ReactTestRenderer) => closed(tree)],
  ])("drops a draft nothing was sent for on %s", async (_how, close) => {
    const tree = render();
    await choose(tree);
    act(() => {
      titleInput(tree).props.onChangeText("Minutes");
    });
    close(tree);

    open(tree);
    expect(screenText(tree)).toContain("Choose a photo");
    expect(screenText(tree)).not.toContain("IMG_2041.jpg");
    expect(titleInput(tree).props.value).toBe("");
  });

  it("keeps the bytes a failed confirm sent across a swipe, until Cancel", async () => {
    const tree = render();
    await choose(tree);
    uploadDocumentPhoto.mockResolvedValue({
      status: "refused",
      reason: "Couldn't upload that photo. Try again in a moment.",
      final: false,
      sent: SENT,
    });
    await pressUpload(tree);

    // Swiped away, then opened again: the retry is still the confirm alone.
    closed(tree);
    open(tree);
    expect(screenText(tree)).toContain("IMG_2041.jpg");
    expect(titleInput(tree).props.editable).toBe(false);
    await pressUpload(tree);
    expect(uploadDocumentPhoto).toHaveBeenLastCalledWith(
      PHOTO,
      expect.any(Object),
      expect.any(Object),
      SENT,
    );

    // Cancel is the way to give it up.
    act(() => {
      pressable(tree, "Cancel").props.onPress();
    });
    closed(tree);
    open(tree);
    expect(screenText(tree)).toContain("Choose a photo");
    await choose(tree);
    await pressUpload(tree);
    expect(uploadDocumentPhoto).toHaveBeenLastCalledWith(
      PHOTO,
      expect.any(Object),
      expect.any(Object),
      undefined,
    );
  });

  it("drops an officer-only refusal on close, keeping the bytes it sent", async () => {
    const tree = render();
    await choose(tree);
    uploadDocumentPhoto.mockResolvedValue({
      status: "refused",
      reason: "Uploads are paused until the subscription is renewed.",
      final: true,
      sent: SENT,
    });
    await pressUpload(tree);
    expect(uploadButton(tree).props.disabled).toBe(true);

    closed(tree);
    open(tree);
    expect(screenText(tree)).not.toContain("subscription is renewed");
    expect(uploadButton(tree).props.disabled).toBe(false);
    await pressUpload(tree);
    expect(uploadDocumentPhoto).toHaveBeenLastCalledWith(
      PHOTO,
      expect.any(Object),
      expect.any(Object),
      SENT,
    );
  });

  it("shows the folder a held retry files into, whatever s12 filters to next", async () => {
    let tree!: ReactTestRenderer;
    const sheet = (initialFolder: string | null) => (
      <FrappThemeProvider>
        <UploadDocumentSheet
          ref={ref}
          folders={FOLDERS}
          initialFolder={initialFolder}
          onUploaded={onUploaded}
        />
      </FrappThemeProvider>
    );
    act(() => {
      tree = create(sheet("Minutes"), {
        createNodeMock: (element) =>
          (element.type as unknown) === "BottomSheetModal"
            ? { dismiss, present: vi.fn() }
            : null,
      });
    });
    mounted.push(tree);
    open(tree);
    await choose(tree);
    uploadDocumentPhoto.mockResolvedValue({
      status: "refused",
      reason: "Couldn't upload that photo. Try again in a moment.",
      final: false,
      sent: { ...SENT, folder: "Minutes" },
    });
    await pressUpload(tree);
    closed(tree);

    // s12's filter moved while the sheet was away.
    act(() => {
      tree.update(sheet("Bylaws"));
    });
    open(tree);
    expect(folderChips(tree).props.selected).toBe("Minutes");

    // A new photo gives the held retry up, and the chips follow s12 again.
    pickDocumentPhoto.mockResolvedValue({
      status: "picked",
      image: {
        ...PHOTO,
        uri: "file:///IMG_2042.jpg",
        filename: "IMG_2042.jpg",
      },
    });
    await act(async () => {
      pressable(tree, "Change photo, IMG_2041.jpg").props.onPress();
    });
    expect(folderChips(tree).props.selected).toBe("Bylaws");
  });

  it("drops an officer-only refusal that lands after the sheet closed", async () => {
    const tree = render();
    await choose(tree);
    const settle = heldUpload();
    await pressUpload(tree);
    // Swiped away while the confirm is out.
    closed(tree);

    await settle({
      status: "refused",
      reason: "Uploads are paused until the subscription is renewed.",
      final: true,
      sent: SENT,
    });
    open(tree);
    expect(screenText(tree)).not.toContain("subscription is renewed");
    expect(uploadButton(tree).props.disabled).toBe(false);
    // The bytes it sent are still held, so the next try is the confirm alone.
    await pressUpload(tree);
    expect(uploadDocumentPhoto).toHaveBeenLastCalledWith(
      PHOTO,
      expect.any(Object),
      expect.any(Object),
      SENT,
    );
  });

  it("shows an officer-only refusal on a sheet reopened mid-upload", async () => {
    const tree = render();
    await choose(tree);
    const settle = heldUpload();
    await pressUpload(tree);
    closed(tree);
    open(tree);

    await settle({
      status: "refused",
      reason: "Uploads are paused until the subscription is renewed.",
      final: true,
      sent: SENT,
    });
    expect(screenText(tree)).toContain("subscription is renewed");
    expect(uploadButton(tree).props.disabled).toBe(true);
  });

  it("focuses the title field in the chapter accent", () => {
    const tree = render();
    act(() => {
      titleInput(tree).props.onFocus();
    });
    const style = [titleInput(tree).props.style].flat(Infinity);
    expect(style).toContainEqual(
      expect.objectContaining({ borderColor: ACCENT }),
    );
  });

  it("caps the title at the API's document title limit", () => {
    const tree = render();
    expect(titleInput(tree).props.maxLength).toBe(DOCUMENT_TITLE_MAX_LENGTH);
  });

  it("clears a pick refusal when the next pick lands", async () => {
    const tree = render();
    pickDocumentPhoto.mockResolvedValue({
      status: "refused",
      reason: "Documents can be up to 25 MB.",
    });
    await act(async () => {
      pressable(tree, "Choose a photo").props.onPress();
    });
    expect(screenText(tree)).toContain("Documents can be up to 25 MB.");

    await choose(tree);
    expect(screenText(tree)).not.toContain("Documents can be up to 25 MB.");
  });

  it("keeps the draft of a sheet closed mid-upload until the upload settles", async () => {
    const tree = render();
    await choose(tree);
    const settle = heldUpload();
    await pressUpload(tree);

    // The member swipes the sheet away while the upload runs.
    closed(tree);
    open(tree);
    expect(screenText(tree)).toContain("IMG_2041.jpg");

    await settle({
      status: "refused",
      reason: "Couldn't upload that photo. Try again in a moment.",
      final: false,
    });
    expect(screenText(tree)).toContain("Try again in a moment.");
    expect(screenText(tree)).toContain("IMG_2041.jpg");
  });

  it("closes nothing when an upload settles after its sheet was closed", async () => {
    const tree = render();
    await choose(tree);
    const settle = heldUpload();
    await pressUpload(tree);
    closed(tree);

    await settle({ status: "uploaded", title: "IMG_2041.jpg" });

    // `dismiss()` on a dismissed gorhom modal wedges the next `present()`.
    expect(dismiss).not.toHaveBeenCalled();
    expect(onUploaded).toHaveBeenCalledWith("IMG_2041.jpg");
    open(tree);
    expect(screenText(tree)).toContain("Choose a photo");
  });

  it("leaves a sheet reopened mid-upload open when the upload lands", async () => {
    const tree = render();
    await choose(tree);
    const settle = heldUpload();
    await pressUpload(tree);
    // Swiped away, then opened again to file another photo.
    closed(tree);
    open(tree);

    await settle({ status: "uploaded", title: "IMG_2041.jpg" });

    expect(dismiss).not.toHaveBeenCalled();
    expect(onUploaded).toHaveBeenCalledWith("IMG_2041.jpg");
    expect(screenText(tree)).toContain("Choose a photo");
  });

  it("keeps the draft when Cancel is pressed mid-upload", async () => {
    const tree = render();
    await choose(tree);
    const settle = heldUpload();
    await pressUpload(tree);

    act(() => {
      pressable(tree, "Cancel").props.onPress();
    });
    expect(dismiss).toHaveBeenCalledTimes(1);
    closed(tree);
    open(tree);
    expect(screenText(tree)).toContain("IMG_2041.jpg");

    await settle({
      status: "refused",
      reason: "Couldn't upload that photo. Try again in a moment.",
      final: false,
    });
    expect(screenText(tree)).toContain("IMG_2041.jpg");
  });

  it("opens the library once for two taps on Choose", async () => {
    const tree = render();
    let resolvePick!: (value: unknown) => void;
    pickDocumentPhoto.mockImplementation(
      () => new Promise((resolve) => (resolvePick = resolve)),
    );

    await act(async () => {
      const card = pressable(tree, "Choose a photo");
      card.props.onPress();
      card.props.onPress();
    });
    expect(pickDocumentPhoto).toHaveBeenCalledTimes(1);
    expect(screenText(tree)).toContain("Opening…");

    await act(async () => resolvePick({ status: "picked", image: PHOTO }));
    expect(screenText(tree)).toContain("IMG_2041.jpg");
  });

  it("leaves an unpresented sheet alone on Cancel", () => {
    // `dismiss()` on a modal that isn't up wedges gorhom's next `present()`.
    const tree = render(null, { opened: false });

    act(() => {
      pressable(tree, "Cancel").props.onPress();
    });
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("hands a retry the bytes a failed confirm sent, until a new pick", async () => {
    const tree = render();
    await choose(tree);
    const sent = {
      image: PHOTO,
      uploaded: {
        storagePath: "chapters/c/documents/d/IMG_2041.jpg",
        filename: "IMG_2041.jpg",
        contentType: "image/jpeg",
        byteSize: PHOTO.byteSize,
      },
      title: "IMG_2041.jpg",
      folder: null,
    };
    uploadDocumentPhoto.mockResolvedValue({
      status: "refused",
      reason: "Couldn't upload that photo. Try again in a moment.",
      final: false,
      sent,
    });

    await pressUpload(tree);
    expect(uploadDocumentPhoto).toHaveBeenLastCalledWith(
      PHOTO,
      expect.any(Object),
      expect.any(Object),
      undefined,
    );

    // Whether the draft still matches is `uploadDocumentPhoto`'s call.
    await pressUpload(tree);
    expect(uploadDocumentPhoto).toHaveBeenLastCalledWith(
      PHOTO,
      expect.any(Object),
      expect.any(Object),
      sent,
    );

    // A different photo is new bytes: it uploads from scratch.
    const other = {
      ...PHOTO,
      uri: "file:///IMG_2042.jpg",
      filename: "IMG_2042.jpg",
    };
    pickDocumentPhoto.mockResolvedValue({ status: "picked", image: other });
    await act(async () => {
      pressable(tree, "Change photo, IMG_2041.jpg").props.onPress();
    });
    await pressUpload(tree);
    expect(uploadDocumentPhoto).toHaveBeenLastCalledWith(
      other,
      expect.any(Object),
      expect.any(Object),
      undefined,
    );
  });

  it("holds the title and folder after a failed confirm, until a new pick", async () => {
    const tree = render();
    await choose(tree);
    act(() => {
      titleInput(tree).props.onChangeText("Minutes");
    });
    uploadDocumentPhoto.mockResolvedValue({
      status: "refused",
      reason: "Couldn't upload that photo. Try again in a moment.",
      final: false,
      sent: {
        image: PHOTO,
        uploaded: {
          storagePath: "chapters/c/documents/d/IMG_2041.jpg",
          filename: "IMG_2041.jpg",
          contentType: "image/jpeg",
          byteSize: PHOTO.byteSize,
        },
        title: "Minutes",
        folder: null,
      },
    });
    await pressUpload(tree);

    expect(titleInput(tree).props.editable).toBe(false);
    expect(screenText(tree)).toContain(RETRY_KEEPS_DRAFT);
    act(() => {
      pressable(tree, "Bylaws").props.onPress();
    });
    uploadDocumentPhoto.mockResolvedValue({
      status: "uploaded",
      title: "Minutes",
    });
    await pressUpload(tree);
    expect(uploadDocumentPhoto).toHaveBeenLastCalledWith(
      PHOTO,
      { title: "Minutes", folder: null },
      expect.any(Object),
      expect.objectContaining({ title: "Minutes", folder: null }),
    );
  });

  it("lets a new pick edit the draft again", async () => {
    const tree = render();
    await choose(tree);
    uploadDocumentPhoto.mockResolvedValue({
      status: "refused",
      reason: "Couldn't upload that photo. Try again in a moment.",
      final: false,
      sent: {
        image: PHOTO,
        uploaded: {
          storagePath: "chapters/c/documents/d/IMG_2041.jpg",
          filename: "IMG_2041.jpg",
          contentType: "image/jpeg",
          byteSize: PHOTO.byteSize,
        },
        title: "IMG_2041.jpg",
        folder: null,
      },
    });
    await pressUpload(tree);
    expect(titleInput(tree).props.editable).toBe(false);

    pickDocumentPhoto.mockResolvedValue({
      status: "picked",
      image: {
        ...PHOTO,
        uri: "file:///IMG_2042.jpg",
        filename: "IMG_2042.jpg",
      },
    });
    await act(async () => {
      pressable(tree, "Change photo, IMG_2041.jpg").props.onPress();
    });
    expect(titleInput(tree).props.editable).toBe(true);
    expect(screenText(tree)).not.toContain(RETRY_KEEPS_DRAFT);
  });

  it("draws no folder chips when the chapter has no folders", () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <UploadDocumentSheet ref={ref} folders={[]} initialFolder={null} />
        </FrappThemeProvider>,
      );
    });
    mounted.push(tree);

    expect(screenText(tree)).not.toContain("Folder");
  });
});
