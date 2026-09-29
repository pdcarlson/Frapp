import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
}));

vi.mock("@repo/hooks", () => ({
  useMessageAttachments: () => hookState.result,
}));

const { MessageAttachments } = await import("./message-attachments");
const { ImageViewer, ImageViewerProvider, useImageViewer } =
  await import("./image-viewer");

/**
 * Chat attachments on web, and the image viewer they open (#2874).
 *
 * Clicking an image used to download it, because the preview was wrapped in
 * the same `<a download>` as a file row. It now opens a viewer, and the
 * download moved inside it. What must not move is the trust rule: the viewer
 * draws the signed URL in an `<img>`, and its download action is still a link
 * to that URL, whose `Content-Disposition: attachment` is what forces the save
 * (spec/behavior/chat/README.md § File and image uploads).
 */
function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: "att-pdf",
    message_id: "msg-1",
    filename: "minutes.pdf",
    content_type: "application/pdf",
    byte_size: 2048,
    width: null,
    height: null,
    download_url: "https://storage.test/signed/minutes.pdf",
    ...overrides,
  };
}

function photo(n: number) {
  return attachment({
    id: `att-${n}`,
    filename: `photo-${n}.png`,
    content_type: "image/png",
    download_url: `https://storage.test/signed/photo-${n}.png`,
  });
}

/**
 * The attachments inside a message row, with the viewer hosted outside that
 * row, the way the timeline hosts it above its virtualized rows.
 */
function Host({
  count,
  onRowClick,
}: {
  count: number;
  onRowClick?: () => void;
}) {
  const viewer = useImageViewer();
  return (
    <ImageViewerProvider value={viewer.open}>
      {/* A stand-in for `MessageItem`'s row, which toggles its action tray on
          a click that isn't on a control. */}
      <div onClick={onRowClick}>
        <MessageAttachments
          channelId="chan-1"
          messageId="msg-1"
          count={count}
        />
      </div>
      <ImageViewer viewer={viewer} />
    </ImageViewerProvider>
  );
}

function show(...rows: ReturnType<typeof attachment>[]) {
  hookState.result = { isPending: false, isError: false, data: rows };
  return render(<Host count={rows.length} />);
}

async function openViewerOn(filename: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `View ${filename}` }));
  return { user, dialog: await screen.findByRole("dialog") };
}

function shownImage(dialog: HTMLElement) {
  return within(dialog).getByRole("img");
}

beforeEach(() => {
  hookState.result = { isPending: true, isError: false, data: undefined };
});

describe("the attachment list", () => {
  it("draws an image as a preview that opens the viewer, not a download link", () => {
    show(photo(1));

    const preview = screen.getByRole("button", { name: "View photo-1.png" });
    expect(preview).not.toHaveAttribute("download");
    expect(preview.querySelector("img")).toHaveAttribute(
      "src",
      "https://storage.test/signed/photo-1.png",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps any other file a download row", () => {
    show(attachment());

    const row = screen.getByRole("link", { name: /minutes\.pdf/ });
    expect(row).toHaveAttribute(
      "href",
      "https://storage.test/signed/minutes.pdf",
    );
    expect(row).toHaveAttribute("download", "minutes.pdf");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps an image a download link where nothing hosts a viewer", () => {
    hookState.result = { isPending: false, isError: false, data: [photo(1)] };
    render(
      <MessageAttachments channelId="chan-1" messageId="msg-1" count={1} />,
    );

    const link = screen.getByRole("link", { name: "photo-1.png" });
    expect(link).toHaveAttribute("download", "photo-1.png");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names a preview in its alt text, so an image that fails to load still says what it was", () => {
    show(photo(1));
    expect(
      screen
        .getByRole("button", { name: "View photo-1.png" })
        .querySelector("img"),
    ).toHaveAttribute("alt", "photo-1.png");
  });

  it("keeps an SVG a download row, never drawn", () => {
    // No upload path accepts one, but an imported row can carry it.
    show(attachment({ filename: "logo.svg", content_type: "image/svg+xml" }));

    expect(screen.getByRole("link", { name: /logo\.svg/ })).toHaveAttribute(
      "download",
      "logo.svg",
    );
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("the image viewer", () => {
  it("opens large on the clicked image", async () => {
    show(photo(1));
    const { dialog } = await openViewerOn("photo-1.png");

    expect(dialog).toHaveAttribute("aria-modal", "true");
    // The dialog itself, so a screen reader reads its name and how to step.
    expect(dialog).toHaveFocus();
    expect(within(dialog).getByText("photo-1.png")).toBeInTheDocument();
    expect(shownImage(dialog)).toHaveAttribute(
      "src",
      "https://storage.test/signed/photo-1.png",
    );
  });

  it("downloads through the same forced-download link a file row uses", async () => {
    show(photo(1));
    const { dialog } = await openViewerOn("photo-1.png");

    const download = within(dialog).getByRole("link", { name: "Download" });
    expect(download).toHaveAttribute(
      "href",
      "https://storage.test/signed/photo-1.png",
    );
    expect(download).toHaveAttribute("download", "photo-1.png");
  });

  it("closes on Esc and returns focus to the image", async () => {
    show(photo(1));
    const { user } = await openViewerOn("photo-1.png");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "View photo-1.png" }),
    ).toHaveFocus();
  });

  it("closes from its close button", async () => {
    show(photo(1));
    const { user, dialog } = await openViewerOn("photo-1.png");

    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "View photo-1.png" }),
    ).toHaveFocus();
  });

  it("closes on a click on the backdrop", async () => {
    show(photo(1));
    const { user } = await openViewerOn("photo-1.png");

    // The overlay is the dialog's sibling in the portal, outside the content.
    await user.click(document.querySelector(".fixed.inset-0")!);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is modal: the page behind it takes no pointer input", async () => {
    // A non-modal Radix dialog still loops Tab inside itself, so the Tab test
    // below can't tell the two apart; this can.
    show(photo(1));
    await openViewerOn("photo-1.png");

    expect(document.body).toHaveStyle({ pointerEvents: "none" });
  });

  it("keeps clicks inside it away from the message row underneath", async () => {
    // React events bubble through a portal along the component tree, so a
    // viewer mounted inside the row would toggle the row's action tray.
    hookState.result = { isPending: false, isError: false, data: [photo(1)] };
    const onRowClick = vi.fn();
    render(<Host count={1} onRowClick={onRowClick} />);
    const { user, dialog } = await openViewerOn("photo-1.png");
    onRowClick.mockClear();

    await user.click(shownImage(dialog));

    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("traps focus while it is open", async () => {
    show(photo(1), photo(2));
    const { user, dialog } = await openViewerOn("photo-1.png");

    for (let i = 0; i < 8; i++) {
      await user.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it("steps through the message's other images with the arrow keys, wrapping at each end", async () => {
    // The PDF between them is not one of them.
    show(photo(1), attachment(), photo(2));
    const { user, dialog } = await openViewerOn("photo-1.png");
    expect(within(dialog).getByText("1 of 2")).toBeInTheDocument();

    await user.keyboard("{ArrowRight}");
    expect(shownImage(dialog)).toHaveAttribute(
      "src",
      "https://storage.test/signed/photo-2.png",
    );
    expect(within(dialog).getByText("2 of 2")).toBeInTheDocument();
    // The download follows the image on show.
    expect(
      within(dialog).getByRole("link", { name: "Download" }),
    ).toHaveAttribute("href", "https://storage.test/signed/photo-2.png");

    await user.keyboard("{ArrowRight}");
    expect(shownImage(dialog)).toHaveAttribute(
      "src",
      "https://storage.test/signed/photo-1.png",
    );

    await user.keyboard("{ArrowLeft}");
    expect(shownImage(dialog)).toHaveAttribute(
      "src",
      "https://storage.test/signed/photo-2.png",
    );
  });

  it("keeps focus, and the arrow keys, inside the dialog after its own step buttons", async () => {
    // A step button disabled at an end would drop focus to the page, and the
    // arrow keys with it.
    show(photo(1), photo(2));
    const { user, dialog } = await openViewerOn("photo-1.png");

    const next = within(dialog).getByRole("button", { name: "Next image" });
    await user.click(next);
    expect(shownImage(dialog)).toHaveAttribute(
      "src",
      "https://storage.test/signed/photo-2.png",
    );
    expect(next).toBeEnabled();
    expect(next).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(shownImage(dialog)).toHaveAttribute(
      "src",
      "https://storage.test/signed/photo-1.png",
    );
  });

  it("returns focus to the image it was showing, not the one that opened it", async () => {
    show(photo(1), photo(2));
    const { user } = await openViewerOn("photo-1.png");

    await user.keyboard("{ArrowRight}");
    await user.keyboard("{Escape}");

    expect(
      screen.getByRole("button", { name: "View photo-2.png" }),
    ).toHaveFocus();
  });

  it("has no step controls for a single image", async () => {
    show(photo(1));
    const { dialog } = await openViewerOn("photo-1.png");

    expect(
      within(dialog).queryByRole("button", { name: "Next image" }),
    ).toBeNull();
  });
});
