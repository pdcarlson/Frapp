import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hookState = vi.hoisted(() => ({
  result: {} as Record<string, unknown>,
  calls: [] as unknown[][],
}));

vi.mock("@repo/hooks", () => ({
  useMessageAttachments: (...args: unknown[]) => {
    hookState.calls.push(args);
    return hookState.result;
  },
}));

// jsdom's CSS parser drops a background-image as long as a real ThumbHash's
// PNG, so the blur is a short stand-in here; `photo-preview.spec.ts` decodes
// real hashes.
vi.mock("@/lib/chat/photo-preview", () => ({
  thumbhashPlaceholderUrl: (hash: string | null | undefined) =>
    hash ? `data:image/png;base64,BLUR` : null,
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

describe("an unsent message's attachments (#4095)", () => {
  // A pending, failed or unconfirmed row is the sender's local copy. Its id is
  // the `client_message_id`; the server mints its own, so asking for files
  // under this id answered 404 every time (FRAPP-WEB-8).
  it("asks for nothing and names how many files the row carries", () => {
    hookState.calls = [];
    render(
      <MessageAttachments
        channelId="chan-1"
        messageId="client-1"
        count={2}
        confirmed={false}
      />,
    );

    expect(hookState.calls.length).toBeGreaterThan(0);
    for (const call of hookState.calls) expect(call[2]).toBe(false);
    expect(screen.getByText("2 attachments")).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t be loaded/)).toBeNull();
    expect(screen.queryByText(/Loading/)).toBeNull();
  });

  it("asks once the row is the server's", () => {
    hookState.calls = [];
    render(
      <MessageAttachments channelId="chan-1" messageId="msg-1" count={1} />,
    );

    expect(hookState.calls.at(-1)).toEqual(["chan-1", "msg-1", true]);
    expect(screen.getByText("Loading attachment…")).toBeInTheDocument();
  });
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

  it("draws a photo bare, with no file-chip frame around it", () => {
    // components.md § Chrome weight: the framed row is for files. A photo in
    // a padded, bordered box read like a file chip before anyone opened it.
    show(photo(1));

    const preview = screen.getByRole("button", { name: "View photo-1.png" });
    // One class per assertion: a negated multi-class `toHaveClass` passes as
    // soon as any one of them is missing.
    for (const frame of ["border-border", "bg-surface-1", "px-2", "py-1.5"]) {
      expect(preview).not.toHaveClass(frame);
    }
    expect(preview).toHaveClass("rounded-md", "overflow-hidden");
  });

  it("keeps the frame on a file row", () => {
    show(attachment());
    expect(screen.getByRole("link", { name: /minutes\.pdf/ })).toHaveClass(
      "border-border",
      "bg-surface-1",
    );
  });

  it("sizes each row to its content rather than the thread's width", () => {
    // The body column stretches its children; without this a file row became
    // a bordered bar across the whole thread.
    show(attachment());
    expect(screen.getByRole("list")).toHaveClass("items-start");
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
    expect(shownImage(dialog)).toHaveAttribute(
      "src",
      "https://storage.test/signed/photo-1.png",
    );
  });

  it("names itself after the file without drawing the filename", async () => {
    // A filename is whatever the sender's device called the file, so it is
    // the dialog's accessible name and the image's alt text, never a caption.
    show(photo(1));
    const { dialog } = await openViewerOn("photo-1.png");

    expect(dialog).toHaveAccessibleName("photo-1.png");
    expect(within(dialog).getByText("photo-1.png")).toHaveClass("sr-only");
  });

  it("draws its controls as icons, with no visible words", async () => {
    show(photo(1), photo(2));
    const { dialog } = await openViewerOn("photo-1.png");

    for (const control of [
      within(dialog).getByRole("link", { name: "Download" }),
      within(dialog).getByRole("button", { name: "Close" }),
      within(dialog).getByRole("button", { name: "Previous image" }),
      within(dialog).getByRole("button", { name: "Next image" }),
    ]) {
      expect(control).toHaveTextContent("");
      expect(control.querySelector("svg")).not.toBeNull();
    }
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

    // The viewer covers the window, so the backdrop around the image is the
    // dialog element itself.
    await user.click(screen.getByRole("dialog"));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("covers the whole window over a dim backdrop, with no card around the image", async () => {
    show(photo(1));
    const { dialog } = await openViewerOn("photo-1.png");

    expect(dialog).toHaveClass("fixed", "inset-0");
    expect(dialog).not.toHaveClass("border");
    // The backdrop is the overlay behind it, the dialog's sibling in the portal.
    const overlay = dialog.previousElementSibling;
    expect(overlay).toHaveClass("fixed", "inset-0", "bg-black/85");
  });

  it("stays open when a press on a control slips off onto the backdrop", async () => {
    // The browser fires `click` on the common ancestor, which is the backdrop.
    show(photo(1), photo(2));
    const { user, dialog } = await openViewerOn("photo-1.png");
    const next = within(dialog).getByRole("button", { name: "Next image" });

    await user.pointer([
      { keys: "[MouseLeft>]", target: next },
      { target: dialog },
      { keys: "[/MouseLeft]", target: dialog },
    ]);

    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("stays open on a click on the image", async () => {
    show(photo(1));
    const { user, dialog } = await openViewerOn("photo-1.png");

    await user.click(shownImage(dialog));

    expect(screen.queryByRole("dialog")).not.toBeNull();
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

  it("takes fresh signed URLs from a refetch while it is open", async () => {
    // Signed URLs last an hour; a refetch (window focus, after the query goes
    // stale) replaces them, and an open viewer must not keep the expired one.
    const view = show(photo(1));
    const { dialog } = await openViewerOn("photo-1.png");

    hookState.result = {
      isPending: false,
      isError: false,
      data: [
        { ...photo(1), download_url: "https://storage.test/signed/fresh.png" },
      ],
    };
    view.rerender(<Host count={1} />);

    expect(shownImage(dialog)).toHaveAttribute(
      "src",
      "https://storage.test/signed/fresh.png",
    );
    expect(
      within(dialog).getByRole("link", { name: "Download" }),
    ).toHaveAttribute("href", "https://storage.test/signed/fresh.png");
  });

  it("closes when a refetch no longer lists the image, and stays closed if it comes back", async () => {
    const view = show(photo(1), photo(2));
    await openViewerOn("photo-2.png");

    hookState.result = { isPending: false, isError: false, data: [photo(1)] };
    view.rerender(<Host count={1} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Closed, not merely hidden: a later refetch that lists the image again
    // must not pop the dialog back open under whatever the member is doing.
    hookState.result = {
      isPending: false,
      isError: false,
      data: [photo(1), photo(2)],
    };
    view.rerender(<Host count={2} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reads the images through the row's own query, live, without refetching on open", async () => {
    // Enabled, so it keeps refreshing the hour-long signed URLs after the row
    // has scrolled away; no refetch on mount, which would mint new URLs and
    // swap the image being opened for a fresh download of itself.
    show(photo(1));
    hookState.calls = [];
    await openViewerOn("photo-1.png");

    expect(hookState.calls).toContainEqual([
      "chan-1",
      "msg-1",
      true,
      { refetchOnMount: false },
    ]);
  });

  it("has no step controls for a single image", async () => {
    show(photo(1));
    const { dialog } = await openViewerOn("photo-1.png");

    expect(
      within(dialog).queryByRole("button", { name: "Next image" }),
    ).toBeNull();
  });
});

describe("photo previews (2026-11-07)", () => {
  const THUMBHASH = "3OcRJYB4d3h/iIeHeEh3eIhw+j3A";
  const sent = attachment({
    id: "att-new",
    filename: "IMG_1.jpg",
    content_type: "image/jpeg",
    width: 2560,
    height: 1920,
    thumbhash: THUMBHASH,
    download_url: "https://storage.test/signed/IMG_1.jpg",
    preview_url: "https://storage.test/signed/preview.jpg",
  });

  function threadImage() {
    return screen.getByRole("img", { name: "IMG_1.jpg" });
  }

  it("draws the preview copy in the thread, at the photo's shape, over a blur of it", () => {
    show(sent);
    const image = threadImage();

    expect(image).toHaveAttribute(
      "src",
      "https://storage.test/signed/preview.jpg",
    );
    expect(image.style.aspectRatio).toBe("2560 / 1920");
    // As wide as the photo at the 256px height cap.
    expect(image.style.width).toBe(`${(256 * 2560) / 1920}px`);
    expect(image.style.backgroundImage).toBe(
      'url("data:image/png;base64,BLUR")',
    );
  });

  it("drops the blur once the photo paints", async () => {
    show(sent);

    fireEvent.load(threadImage());

    await vi.waitFor(() =>
      expect(threadImage().style.backgroundImage).toBe(""),
    );
  });

  it("falls back to the original when the preview fails", async () => {
    show(sent);

    fireEvent.error(threadImage());

    await vi.waitFor(() =>
      expect(threadImage()).toHaveAttribute(
        "src",
        "https://storage.test/signed/IMG_1.jpg",
      ),
    );
  });

  it("opens the original, not the preview, in the viewer", async () => {
    show(sent);

    const { dialog } = await openViewerOn("IMG_1.jpg");

    expect(shownImage(dialog)).toHaveAttribute(
      "src",
      "https://storage.test/signed/IMG_1.jpg",
    );
  });

  it("draws an older photo from the original, unsized and with no blur", () => {
    show(photo(1));
    const image = screen.getByRole("img", { name: "photo-1.png" });

    expect(image).toHaveAttribute(
      "src",
      "https://storage.test/signed/photo-1.png",
    );
    expect(image.style.aspectRatio).toBe("");
    expect(image.style.backgroundImage).toBe("");
  });
});

/**
 * #3879: a photo's box before the attachments read returns. The row used to
 * draw one "Loading attachment…" line until the read landed, then grow to the
 * photo's box, up to 256px, shifting every row above it. A message now
 * carries each photo's size and blur (`metadata.attachment_photos`), and the
 * pending state draws the box the loaded photo takes. jsdom has no layout, so
 * these pin that the pending box and the loaded image get the same sizing
 * and the same frame; same CSS, same height.
 */
describe("the box before the read returns (#3879)", () => {
  const geometry = {
    width: 2560,
    height: 1920,
    thumbhash: "1QcSHQRnh493V4dIh4eXh1h4kJUI",
  };
  const loaded = attachment({
    id: "att-photo",
    filename: "IMG_1.jpg",
    content_type: "image/jpeg",
    width: 2560,
    height: 1920,
    thumbhash: geometry.thumbhash,
    preview_url: "https://storage.test/signed/preview.jpg",
    download_url: "https://storage.test/signed/IMG_1.jpg",
  });

  type Photo = {
    width: number | null;
    height: number | null;
    thumbhash: string | null;
  };

  function rowWith(photos: Photo[] | undefined, count = 1) {
    return (
      <MessageAttachments
        channelId="chan-1"
        messageId="msg-1"
        count={count}
        photos={photos}
      />
    );
  }

  it("draws a sized photo's box, with its blur, while the read is out", () => {
    render(rowWith([geometry]));

    expect(screen.queryByText("Loading attachment…")).toBeNull();
    const box = screen.getByTestId("attachment-photo-box");
    expect(box.style.aspectRatio).toBe("2560 / 1920");
    expect(box.style.width).toBe(`${(256 * 2560) / 1920}px`);
    expect(box.style.backgroundImage).toBe('url("data:image/png;base64,BLUR")');
    expect(screen.getByRole("list")).toHaveAttribute("aria-busy", "true");
  });

  it("takes the loaded photo's size, frame and list, so the row does not grow", () => {
    const { rerender } = render(rowWith([geometry]));
    const box = screen.getByTestId("attachment-photo-box");
    const pending = {
      width: box.style.width,
      aspectRatio: box.style.aspectRatio,
      tag: box.tagName,
      className: box.className,
      frame: box.parentElement!.className,
      list: screen.getByRole("list").className,
    };

    hookState.result = { isPending: false, isError: false, data: [loaded] };
    rerender(rowWith([geometry]));
    const image = screen.getByRole("img", { name: "IMG_1.jpg" });

    expect(image.style.width).toBe(pending.width);
    expect(image.style.aspectRatio).toBe(pending.aspectRatio);
    // An image like the loaded one, with the same sizing classes: a span
    // with the same CSS did not shrink with a narrow column, measured in
    // Chromium.
    // Compared as sets both ways: a class dropped from either side (the
    // pending box's `max-w-full`, the frame's 2px border) is a shift.
    const classes = (names: string) => [...new Set(names.split(" "))].sort();
    expect(pending.tag).toBe("IMG");
    expect(classes(pending.className)).toEqual(classes(image.className));
    const loadedFrame = classes(image.parentElement!.className);
    for (const c of ["block", "overflow-hidden", "rounded-md", "border"]) {
      expect(loadedFrame).toContain(c);
    }
    expect(classes(pending.frame)).toEqual(
      loadedFrame.filter((c) => classes(pending.frame).includes(c)),
    );
    expect(classes(pending.frame)).toEqual(
      classes("block overflow-hidden rounded-md border border-transparent"),
    );
    expect(screen.getByRole("list").className).toBe(pending.list);
  });

  it("draws the files beside the photos as chips, the height of a loaded one", () => {
    render(rowWith([geometry], 3));

    expect(screen.getAllByTestId("attachment-photo-box")).toHaveLength(1);
    const chips = screen.getAllByTestId("attachment-file-chip");
    expect(chips).toHaveLength(2);
    for (const chip of chips) {
      for (const c of ["border", "px-2", "py-1.5", "text-caption"]) {
        expect(chip).toHaveClass(c);
      }
    }
  });

  it("can't reserve an unsized photo, and says it is loading", () => {
    render(rowWith([{ width: null, height: null, thumbhash: null }]));

    expect(screen.queryByTestId("attachment-photo-box")).toBeNull();
    expect(screen.getByText("Loading photo…")).toBeInTheDocument();
  });

  it("draws an older message, with no geometry, as it always did", () => {
    render(rowWith(undefined));

    expect(screen.getByText("Loading attachment…")).toBeInTheDocument();
    expect(screen.queryByTestId("attachments-pending")).toBeNull();
  });

  it("ignores geometry that claims more photos than the message has files", () => {
    render(rowWith([geometry, geometry], 1));

    expect(screen.getByText("Loading attachment…")).toBeInTheDocument();
  });
});
