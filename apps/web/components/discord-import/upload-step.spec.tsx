import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UploadStep } from "./upload-step";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

/**
 * How the upload step behaves when the server REFUSES to register files.
 *
 * Two review rounds got this wrong in opposite directions, which is why it is
 * pinned here rather than left to reading. The original code swallowed the
 * refusal entirely — a quota-refused archive reported "done" with every file
 * listed as failed and no reason anywhere. The first fix rethrew, which jumped
 * past the confirm loop and left everything already uploaded unconfirmed, so
 * the documented "pick the folder again" recovery re-sent the whole archive
 * from byte zero and was refused at the same batch. What has to hold is all
 * three at once: say why, stop asking, and keep what landed resumable.
 */

const QUOTA_MESSAGE =
  "Your chapter's archive would hold 51 GB of files, past its 50 GB limit. Delete an old import to free space.";

/** Media files only — the step reads headers on `.json`, and these are not it. */
function mediaFiles(count: number): File[] {
  return Array.from(
    { length: count },
    (_, i) => new File([`x`], `photo-${i}.png`, { type: "image/png" }),
  );
}

type AnyMock = ReturnType<typeof vi.fn>;

// The prop types are precise; the mocks are not, and `vi.fn()` widens to
// `Mock<Procedure>` in a way tsc will not narrow back. Cast at the seam rather
// than annotating every mock, so the tests stay about behaviour.
function renderStep(overrides: {
  requestUrls: AnyMock;
  confirmUploads?: AnyMock;
  onStaged?: AnyMock;
}) {
  const confirmUploads = overrides.confirmUploads ?? vi.fn(async () => ({}));
  const onStaged = overrides.onStaged ?? vi.fn();
  const props = {
    importId: "import-1",
    alreadyUploaded: new Set<string>(),
    requestUrls: { mutateAsync: overrides.requestUrls, isPending: false },
    confirmUploads: { mutateAsync: confirmUploads, isPending: false },
    onStaged,
  } as unknown as React.ComponentProps<typeof UploadStep>;
  render(<UploadStep {...props} />);
  return { confirmUploads, onStaged };
}

function pick(files: File[]) {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn(async () => ({ ok: true }) as Response);
});

describe("UploadStep — a refused registration", () => {
  it("shows the server's reason in the failures panel, not the generic advice", async () => {
    // The panel is the durable surface — a toast is dismissible — and its
    // standing advice ("pick the folder again", "files over 100 MB") is
    // actively wrong for a quota refusal: re-picking is refused identically
    // every time, and the per-file limit is not the cause.
    renderStep({
      requestUrls: vi.fn().mockRejectedValue({
        message: QUOTA_MESSAGE,
        statusCode: 400,
      }),
    });

    pick(mediaFiles(2));

    await waitFor(() => {
      expect(screen.getByText(QUOTA_MESSAGE)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Files over 100 MB cannot be imported/)).toBeNull();
  });

  it("stops asking after three consecutive refusals instead of grinding on", async () => {
    // Every later batch is refused identically, and each still costs a round
    // trip plus a server-side re-sum of the whole manifest.
    const requestUrls = vi.fn().mockRejectedValue({
      message: QUOTA_MESSAGE,
      statusCode: 400,
    });
    renderStep({ requestUrls });

    // 500 files = 5 mint batches of 100. Only three should ever be attempted.
    pick(mediaFiles(500));

    await waitFor(() => expect(requestUrls).toHaveBeenCalledTimes(3));
    // Give the loop room to make a fourth call if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requestUrls).toHaveBeenCalledTimes(3);
  });

  it("does not stop for a single failed batch, which is per-file rather than archive-wide", async () => {
    // One rejected file (an oversized video) must not strand every file after
    // it — the failure that made the first version of this fix worse than the
    // bug it replaced.
    const requestUrls = vi
      .fn()
      .mockRejectedValueOnce({ message: "too large", statusCode: 400 })
      .mockResolvedValue([]);
    renderStep({ requestUrls });

    pick(mediaFiles(300));

    await waitFor(() => expect(requestUrls).toHaveBeenCalledTimes(3));
  });

  it("still confirms what landed, so the refusal stays resumable", async () => {
    // The regression this locks out: throwing from the mint loop skipped the
    // confirm loop, leaving every uploaded object with `uploaded_at = null` —
    // which is exactly what `alreadyUploaded` is built from, so re-picking the
    // folder re-sent gigabytes that were already in storage.
    const requestUrls = vi
      .fn()
      // First batch mints fine and its files upload...
      .mockResolvedValueOnce(
        Array.from({ length: 100 }, (_, i) => ({
          relative_path: `photo-${i}.png`,
          storage_path: `p/photo-${i}.png`,
          upload_url: "https://signed.example/put",
          content_type: "image/png",
        })),
      )
      // ...then the archive fills up.
      .mockRejectedValue({ message: QUOTA_MESSAGE, statusCode: 400 });

    const { confirmUploads } = renderStep({ requestUrls });

    pick(mediaFiles(400));

    await waitFor(() => expect(confirmUploads).toHaveBeenCalled());
    const confirmed = confirmUploads.mock.calls.flatMap(
      (call) => (call[0] as { storage_paths: string[] }).storage_paths,
    );
    expect(confirmed).toHaveLength(100);
    expect(confirmed).toContain("p/photo-0.png");
  });

  it("reports the reason that actually stopped the run, not an earlier unrelated one", async () => {
    // A real export carries one rejected file early on; the archive fills up
    // much later. Latching the FIRST reason would blame the `.exe` for a quota
    // refusal 290 batches later — and, because a reason is present, would hide
    // the panel's generic advice too. The admin deletes the .exe, re-picks, and
    // is refused in exactly the same place.
    const requestUrls = vi
      .fn()
      .mockRejectedValueOnce({
        message: '"gamehack.exe" is a file type the archive does not accept.',
        statusCode: 400,
      })
      .mockResolvedValueOnce([])
      .mockRejectedValue({ message: QUOTA_MESSAGE, statusCode: 400 });

    renderStep({ requestUrls });

    pick(mediaFiles(600));

    await waitFor(() => {
      expect(screen.getByText(QUOTA_MESSAGE)).toBeInTheDocument();
    });
    expect(screen.queryByText(/gamehack\.exe/)).toBeNull();
  });

  it("counts the files it never attempted, not just the ones it was refused", async () => {
    // Stopping early leaves the rest unsent, and they are still missing from
    // the archive. Reporting only the refused batches told an admin whose
    // 600-file archive stopped at batch 3 that 300 files needed attention.
    const requestUrls = vi.fn().mockRejectedValue({
      message: QUOTA_MESSAGE,
      statusCode: 400,
    });
    const onStaged = vi.fn();
    renderStep({ requestUrls, onStaged });

    pick(mediaFiles(600));

    await waitFor(() => expect(onStaged).toHaveBeenCalled());
    // 3 batches attempted and refused (300), 300 never sent.
    expect(onStaged.mock.calls[0]?.[0]).toMatchObject({ pendingUploads: 600 });
    expect(
      screen.getByText(/300 of them were never attempted/),
    ).toBeInTheDocument();
  });

  it("reports the reason even when confirming then fails", async () => {
    // Said before the confirm loop for this reason: a transient failure there
    // sends control to the outer catch, and a reason reported after it would
    // never be shown at all.
    const requestUrls = vi
      .fn()
      .mockResolvedValueOnce([
        {
          relative_path: "photo-0.png",
          storage_path: "p/photo-0.png",
          upload_url: "https://signed.example/put",
          content_type: "image/png",
        },
      ])
      .mockRejectedValue({ message: QUOTA_MESSAGE, statusCode: 400 });

    renderStep({
      requestUrls,
      confirmUploads: vi.fn().mockRejectedValue(new Error("confirm exploded")),
    });

    pick(mediaFiles(200));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: QUOTA_MESSAGE }),
      );
    });
  });
});
