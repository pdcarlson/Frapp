import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  chapterId: "chap-1" as string | null,
  requestUrl: vi.fn(),
  confirm: vi.fn(),
  remove: vi.fn(),
  put: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useActiveChapterId: () => mocks.chapterId,
  useRequestAvatarUploadUrl: () => ({ mutateAsync: mocks.requestUrl }),
  useConfirmAvatar: () => ({ mutateAsync: mocks.confirm }),
  useRemoveAvatar: () => ({ mutateAsync: mocks.remove }),
  putSignedUpload: (input: unknown) => mocks.put(input),
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

import {
  PHOTO_SIZE_REFUSAL,
  PHOTO_TYPE_REFUSAL,
  ProfilePhotoControl,
} from "./profile-photo-control";

const PATH = "chapters/chap-1/profiles/u-1/abc.png";

function pick(file: File) {
  // `applyAccept: false`: the point is what happens when the picker's filter is
  // bypassed (drag-in, "All files"), which is exactly what the gate is for.
  return userEvent
    .setup({ applyAccept: false })
    .upload(screen.getByTestId("profile-photo-input"), file);
}

describe("ProfilePhotoControl", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chapterId = "chap-1";
    mocks.requestUrl.mockResolvedValue({
      upload_url: "https://storage/put",
      storage_path: PATH,
    });
    mocks.put.mockResolvedValue(undefined);
    mocks.confirm.mockResolvedValue({});
    mocks.remove.mockResolvedValue({});
  });

  it("mints, uploads, then confirms the path the ticket named", async () => {
    render(<ProfilePhotoControl hasPhoto={false} />);
    const file = new File(["png"], "me.png", { type: "image/png" });

    await pick(file);

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(PATH));
    expect(mocks.requestUrl).toHaveBeenCalledWith({
      filename: "me.png",
      content_type: "image/png",
      size_bytes: file.size,
    });
    expect(mocks.put).toHaveBeenCalledWith({
      signedUrl: "https://storage/put",
      body: file,
      contentType: "image/png",
    });
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Photo updated" }),
    );
  });

  it.each([
    ["an SVG", new File(["<svg/>"], "me.svg", { type: "image/svg+xml" })],
    ["a PDF", new File(["%PDF"], "me.pdf", { type: "application/pdf" })],
    ["a HEIC", new File(["heic"], "me.heic", { type: "image/heic" })],
  ])("refuses %s with a clear error and sends nothing", async (_label, file) => {
    render(<ProfilePhotoControl hasPhoto={false} />);

    await pick(file);

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: PHOTO_TYPE_REFUSAL,
        variant: "destructive",
      }),
    );
    expect(mocks.requestUrl).not.toHaveBeenCalled();
  });

  it("refuses an image over the size cap before minting", async () => {
    render(<ProfilePhotoControl hasPhoto={false} />);
    const big = new File(["x"], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 26 * 1024 * 1024 });

    await pick(big);

    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: PHOTO_SIZE_REFUSAL }),
    );
    expect(mocks.requestUrl).not.toHaveBeenCalled();
  });

  it("does not confirm when the upload itself fails", async () => {
    mocks.put.mockRejectedValue(new Error("Upload failed (400)"));
    render(<ProfilePhotoControl hasPhoto />);

    await pick(new File(["png"], "me.png", { type: "image/png" }));

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't update your photo",
          variant: "destructive",
        }),
      ),
    );
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("labels the action by whether there is a photo, and removes one", async () => {
    const { rerender } = render(<ProfilePhotoControl hasPhoto={false} />);
    expect(screen.getByRole("button", { name: "Add photo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();

    rerender(<ProfilePhotoControl hasPhoto />);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Change photo" })).toBeTruthy();
  });

  it("cannot upload without an active chapter, and says why", () => {
    mocks.chapterId = null;
    render(<ProfilePhotoControl hasPhoto />);

    expect(
      (screen.getByRole("button", { name: "Change photo" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(screen.getByText("Choose a chapter to add a photo.")).toBeTruthy();
  });

  it("is inert offline", () => {
    render(<ProfilePhotoControl hasPhoto disabled />);

    for (const name of ["Change photo", "Remove"]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(true);
    }
  });
});
