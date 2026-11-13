import { beforeEach, describe, expect, it, vi } from "vitest";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { moduleDisabledMessage } from "@repo/validation";
import type { PickedImage } from "@/lib/chat/attachment-upload";
import { MODULE_REFUSAL_COPY } from "@/lib/module-refusal";
import {
  TASK_PHOTO_GATE_COPY,
  markDoneAsks,
  markDoneCheck,
  markDoneLabel,
  photoRoom,
  pickTaskPhotos,
  uploadTaskPhotos,
} from "./task-photos";

const image = (name: string): PickedImage => ({
  uri: `file:///${name}`,
  filename: name,
  contentType: "image/jpeg",
  byteSize: 1024,
});

describe("markDoneAsks (#4635)", () => {
  it("opens the sheet for a Photo or Link task, or a sent-back one", () => {
    expect(markDoneAsks({ proofKind: "none", sentBack: false })).toBe(false);
    expect(markDoneAsks({ proofKind: "photo", sentBack: false })).toBe(true);
    expect(markDoneAsks({ proofKind: "link", sentBack: false })).toBe(true);
    expect(markDoneAsks({ proofKind: "none", sentBack: true })).toBe(true);
  });
});

describe("markDoneLabel", () => {
  it("names what the task asks for, in web's words", () => {
    expect(markDoneLabel("Mark done", "none")).toBe("Mark done");
    expect(markDoneLabel("Mark done", "photo")).toBe("Mark done with a photo");
    expect(markDoneLabel("Mark done", "link")).toBe("Mark done with a link");
  });
});

describe("photoRoom", () => {
  it("is what's left under six, never negative", () => {
    expect(photoRoom(0)).toBe(6);
    expect(photoRoom(4)).toBe(2);
    expect(photoRoom(9)).toBe(0);
  });
});

describe("markDoneCheck mirrors the server's refusals (#4635)", () => {
  const draft = { photoCount: 0, link: "", note: "" };

  it("needs at least one photo on a Photo task", () => {
    expect(
      markDoneCheck({ proofKind: "photo", sentBack: false }, draft),
    ).toEqual({
      ok: false,
      problem: "Add at least one photo of the finished job.",
    });
    expect(
      markDoneCheck(
        { proofKind: "photo", sentBack: false },
        { ...draft, photoCount: 2 },
      ),
    ).toEqual({ ok: true, proof: {} });
  });

  it("needs a valid http(s) link on a Link task", () => {
    expect(
      markDoneCheck({ proofKind: "link", sentBack: false }, draft),
    ).toMatchObject({ ok: false, problem: "Add a link to show it's done." });
    expect(
      markDoneCheck(
        { proofKind: "link", sentBack: false },
        { ...draft, link: "javascript:alert(1)" },
      ),
    ).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/https:\/\//),
    });
    expect(
      markDoneCheck(
        { proofKind: "link", sentBack: false },
        { ...draft, link: "  https://docs.example.com/x  " },
      ),
    ).toEqual({ ok: true, proof: { proofLink: "https://docs.example.com/x" } });
  });

  it("needs proof or a reply on a sent-back task", () => {
    expect(
      markDoneCheck({ proofKind: "none", sentBack: true }, draft),
    ).toMatchObject({
      ok: false,
      problem: "Add proof or reply to the officer before marking it done.",
    });
    expect(
      markDoneCheck(
        { proofKind: "none", sentBack: true },
        { ...draft, note: "  Mopped it again  " },
      ),
    ).toEqual({ ok: true, proof: { completionNote: "Mopped it again" } });
    expect(
      markDoneCheck(
        { proofKind: "none", sentBack: true },
        { ...draft, photoCount: 1 },
      ),
    ).toEqual({ ok: true, proof: {} });
  });

  it("lets a task that asks for nothing go with nothing", () => {
    expect(
      markDoneCheck({ proofKind: "none", sentBack: false }, draft),
    ).toEqual({ ok: true, proof: {} });
  });
});

describe("uploadTaskPhotos", () => {
  beforeEach(() => {
    vi.mocked(FileSystem.uploadAsync)
      .mockReset()
      .mockResolvedValue({ status: 200, body: "", headers: {} } as never);
  });

  it("uploads each photo in order and hands back their paths", async () => {
    let n = 0;
    const mint = vi.fn(async () => {
      n += 1;
      return { upload_url: `https://s/${n}`, storage_path: `p/${n}.jpg` };
    });
    const result = await uploadTaskPhotos(
      [{ image: image("a.jpg") }, { image: image("b.jpg") }],
      mint,
      TASK_PHOTO_GATE_COPY.proof,
    );
    expect(result).toMatchObject({
      status: "uploaded",
      paths: ["p/1.jpg", "p/2.jpg"],
    });
    expect(mint).toHaveBeenCalledTimes(2);
  });

  it("doesn't upload a photo already up again, and keeps what landed on a failure", async () => {
    const mint = vi.fn(async () => ({
      upload_url: "https://s/x",
      storage_path: "p/new.jpg",
    }));
    vi.mocked(FileSystem.uploadAsync).mockResolvedValueOnce({
      status: 500,
      body: "",
      headers: {},
    } as never);
    const result = await uploadTaskPhotos(
      [
        { image: image("a.jpg"), storagePath: "p/old.jpg" },
        { image: image("b.jpg") },
      ],
      mint,
      TASK_PHOTO_GATE_COPY.proof,
    );
    expect(mint).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("refused");
    expect(result.photos[0]!.storagePath).toBe("p/old.jpg");
    expect(result.photos[1]!.storagePath).toBeUndefined();
  });

  it("says a gate refusal in the task's words, as final", async () => {
    const mint = vi.fn(async () => {
      throw {
        statusCode: 403,
        error: "Forbidden",
        message: moduleDisabledMessage("tasks"),
      };
    });
    const result = await uploadTaskPhotos(
      [{ image: image("a.jpg") }],
      mint,
      TASK_PHOTO_GATE_COPY.task,
    );
    expect(result).toMatchObject({
      status: "refused",
      reason: MODULE_REFUSAL_COPY.task,
      final: true,
    });
  });
});

describe("pickTaskPhotos", () => {
  it("opens the library for several at once, up to the room left", async () => {
    vi.mocked(
      ImagePicker.requestMediaLibraryPermissionsAsync,
    ).mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///a.jpg",
          fileName: "a.jpg",
          mimeType: "image/jpeg",
          width: 100,
          height: 100,
          fileSize: 1000,
        },
        {
          uri: "file:///b.png",
          fileName: "b.png",
          mimeType: "image/png",
          width: 100,
          height: 100,
          fileSize: 1000,
        },
      ],
    } as never);
    const result = await pickTaskPhotos(4);
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({
        allowsMultipleSelection: true,
        selectionLimit: 4,
      }),
    );
    expect(result).toMatchObject({
      status: "picked",
      refused: null,
      images: [{ filename: "a.jpg" }, { filename: "b.png" }],
    });
  });

  it("opens nothing with no room left", async () => {
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockClear();
    expect(await pickTaskPhotos(0)).toEqual({ status: "cancelled" });
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it("leaves out a photo the gate refuses, and says why", async () => {
    vi.mocked(
      ImagePicker.requestMediaLibraryPermissionsAsync,
    ).mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///a.jpg",
          fileName: "a.jpg",
          mimeType: "image/jpeg",
          width: 100,
          height: 100,
          fileSize: 1000,
        },
        {
          uri: "file:///huge.png",
          fileName: "huge.png",
          mimeType: "image/png",
          width: 100,
          height: 100,
          fileSize: 90 * 1024 * 1024,
        },
      ],
    } as never);
    const result = await pickTaskPhotos(6);
    expect(result).toMatchObject({
      status: "picked",
      images: [{ filename: "a.jpg" }],
      refused: expect.stringMatching(/over/),
    });
  });
});
