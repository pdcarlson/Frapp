import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GoogleDriveStatus } from "@repo/hooks";
import { DriveFolderPanel } from "./drive-folder-panel";

const EMAIL = "frapp-docs@signet-frapp.iam.gserviceaccount.com";
let status: GoogleDriveStatus | undefined;
const connect = vi.fn();
const syncNow = vi.fn();
const disconnect = vi.fn();
const toast = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useGoogleDriveStatus: () => ({ data: status }),
  useConnectGoogleDrive: () => ({ mutateAsync: connect, isPending: false }),
  useSyncGoogleDrive: () => ({ mutateAsync: syncNow, isPending: false }),
  useDisconnectGoogleDrive: () => ({
    mutateAsync: disconnect,
    isPending: false,
  }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const gate = {
  allowed: true,
  isOffline: false,
  noticeRef: { current: null },
  noticeId: "gate-notice",
  state: { allowed: true },
  controlProps: () => ({}),
} as unknown as Parameters<typeof DriveFolderPanel>[0]["gate"];

const connected = (
  over: Partial<NonNullable<GoogleDriveStatus["connection"]>> = {},
): GoogleDriveStatus => ({
  available: true,
  service_account_email: EMAIL,
  connection: {
    folder_id: "folder-1",
    folder_name: "Chapter files",
    folder_url: "https://drive.google.com/drive/folders/folder-1",
    status: "active",
    last_synced_at: null,
    synced_count: 12,
    skipped_count: 2,
    syncing: false,
    who_can_see: null,
    ...over,
  },
});

describe("DriveFolderPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    status = undefined;
  });

  it("renders nothing while the server offers no Google Drive", () => {
    status = {
      available: false,
      service_account_email: null,
      connection: null,
    };
    const { container } = render(<DriveFolderPanel gate={gate} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("walks an officer through sharing and pasting the link", async () => {
    status = {
      available: true,
      service_account_email: EMAIL,
      connection: null,
    };
    connect.mockResolvedValue(connected());
    const user = userEvent.setup();
    render(<DriveFolderPanel gate={gate} />);

    await user.click(
      screen.getByRole("button", { name: "Connect Google Drive" }),
    );
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    const connectButton = screen.getByRole("button", { name: "Connect" });
    expect(connectButton).toBeDisabled();

    await user.type(
      screen.getByLabelText("2. Paste the folder's link"),
      "https://drive.google.com/drive/folders/abcdefghijk",
    );
    await user.click(connectButton);

    expect(connect).toHaveBeenCalledWith(
      "https://drive.google.com/drive/folders/abcdefghijk",
    );
  });

  it("shows the server's reason a folder was refused, beside the link", async () => {
    status = {
      available: true,
      service_account_email: EMAIL,
      connection: null,
    };
    connect.mockRejectedValue({
      statusCode: 400,
      message: `Frapp can’t see that folder yet. Share it with ${EMAIL}.`,
    });
    const user = userEvent.setup();
    render(<DriveFolderPanel gate={gate} />);

    await user.click(
      screen.getByRole("button", { name: "Connect Google Drive" }),
    );
    await user.type(
      screen.getByLabelText("2. Paste the folder's link"),
      "abcdefghijk",
    );
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Frapp can’t see that folder yet",
    );
  });

  it("shows a connected folder's counts and syncs on request", async () => {
    status = connected();
    syncNow.mockResolvedValue(connected({ syncing: true }));
    const user = userEvent.setup();
    render(<DriveFolderPanel gate={gate} />);

    await user.click(screen.getByRole("button", { name: "Google Drive" }));
    expect(screen.getByText("Chapter files")).toBeInTheDocument();
    expect(screen.getByText("12 files")).toBeInTheDocument();
    expect(screen.getByText("2 files")).toBeInTheDocument();
    expect(screen.getByText("Not yet")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sync now" }));
    expect(syncNow).toHaveBeenCalled();
  });

  it("says when Frapp lost access, with the address to share it with again", async () => {
    status = connected({ status: "no_access" });
    const user = userEvent.setup();
    render(<DriveFolderPanel gate={gate} />);

    await user.click(
      screen.getByRole("button", { name: "Google Drive: needs attention" }),
    );
    expect(
      screen.getByText("Frapp can't see this folder any more"),
    ).toBeInTheDocument();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
  });

  it("disconnects only after confirming", async () => {
    status = connected();
    disconnect.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DriveFolderPanel gate={gate} />);

    await user.click(screen.getByRole("button", { name: "Google Drive" }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnect).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Disconnect Chapter files?"),
    ).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Disconnect" });
    await user.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(disconnect).toHaveBeenCalled());
  });
});
