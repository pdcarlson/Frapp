import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChatBackgroundPicker } from "./chat-background-picker";
import { paintStyle } from "./chat-background";

function renderPicker(
  over: Partial<Parameters<typeof ChatBackgroundPicker>[0]> = {},
) {
  const onPick = vi.fn();
  render(
    <ChatBackgroundPicker
      value={null}
      allowInherit
      letters="ΒΘΠ"
      saving={false}
      error={null}
      onPick={onPick}
      {...over}
    />,
  );
  return onPick;
}

describe("ChatBackgroundPicker (#3973)", () => {
  it("offers Chapter default on a channel and marks it chosen when the channel follows it", () => {
    renderPicker();
    expect(
      screen.getByRole("radio", { name: "Chapter default" }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("has no Chapter default when editing the default itself", () => {
    renderPicker({ allowInherit: false, value: "plain" });
    expect(screen.queryByRole("radio", { name: "Chapter default" })).toBeNull();
  });

  it("picks a built-in", () => {
    const onPick = renderPicker();
    fireEvent.click(screen.getByRole("radio", { name: "Midnight" }));
    expect(onPick).toHaveBeenCalledWith({ background: "midnight" });
  });

  it("refuses a file that isn't an allowed image, before any upload", () => {
    const onPick = renderPicker();
    const input = document.querySelector('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })],
      },
    });
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "JPEG, PNG, GIF or WebP",
    );
  });

  it("hands an allowed photo back with its file", () => {
    const onPick = renderPicker();
    const file = new File(["x"], "house.jpg", { type: "image/jpeg" });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });
    expect(onPick).toHaveBeenCalledWith({
      background: "photo",
      photo: file,
      contentType: "image/jpeg",
    });
  });

  // #4262: the picker checked only the browser's type, so a file the API
  // then refused by its extension, or the bucket by its size, failed a server
  // step and read "Try again in a moment".
  it("refuses a JPEG whose extension the API refuses (.jfif), by name", () => {
    const onPick = renderPicker();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: {
        files: [new File(["x"], "house.jfif", { type: "image/jpeg" })],
      },
    });
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Pick a JPEG, PNG, GIF or WebP image.",
    );
  });

  it("refuses a photo over the upload cap, saying it is too large", () => {
    const onPick = renderPicker();
    const big = new File(["x"], "house.jpg", { type: "image/jpeg" });
    Object.defineProperty(big, "size", { value: 30 * 1024 * 1024 });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [big] },
    });
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "That photo is too large. Pick one up to 25 MB.",
    );
  });

  it("clears a refused file's error when a built-in is picked", () => {
    renderPicker();
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(["x"], "x.svg", { type: "image/svg+xml" })] },
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Letters" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("paintStyle", () => {
  it("draws Letters with the chapter's letters, and nothing extra without them", () => {
    expect(String(paintStyle("letters", "ΒΘΠ").backgroundImage)).toContain(
      encodeURIComponent("ΒΘΠ"),
    );
    expect(paintStyle("letters", "").backgroundImage).toBeUndefined();
  });
});
