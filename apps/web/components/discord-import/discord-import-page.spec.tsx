import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

/**
 * The import list's row actions (#2817).
 *
 * Clear is offered only once an import is deleted, because this list is where
 * Delete lives and nothing brings a cleared import back. How a deleted row
 * reaches `purged` without a reload is the list hook's poll
 * (`discordImportListPollMs`, tested in @repo/hooks).
 */

const { hooks } = vi.hoisted(() => ({
  hooks: {
    rows: [] as unknown[],
    clear: vi.fn(),
    remove: vi.fn(),
    progress: vi.fn(),
    // Records which import the page polls in detail.
    detail: vi.fn<(id: string | null) => { data: null }>(() => ({
      data: null,
    })),
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@repo/hooks", () => ({
  DISCORD_CONNECT_MESSAGES: {},
  useDiscordImports: () => ({
    data: hooks.rows,
    isPending: false,
    isLoading: false,
    isError: false,
    fetchStatus: "idle",
    refetch: vi.fn(),
  }),
  useDiscordImport: (id: string | null) => hooks.detail(id),
  useDiscordImportProgress: (id: string, options: { active: boolean }) =>
    hooks.progress(id, options),
  useCancelDiscordImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useClearDiscordImport: () => ({
    mutateAsync: hooks.clear,
    isPending: false,
  }),
  useDeleteDiscordImport: () => ({
    mutateAsync: hooks.remove,
    isPending: false,
  }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ isOffline: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("./import-wizard", () => ({
  ImportWizard: () => <div data-testid="wizard" />,
}));

const { DiscordImportPage } = await import("./discord-import-page");

const row = (id: string, status: string, guild: string) => ({
  id,
  status,
  source: "bot",
  guild_name: guild,
  total_messages: 5307,
  imported_messages: 5307,
  channels_total: null,
  channels_done: null,
  messages_skipped: 0,
  attachments_imported: 0,
  warnings: [],
  error: null,
  created_at: "2026-09-28T18:06:33Z",
});

const rowOf = (guild: string) =>
  within(screen.getByText(guild).closest("li") as HTMLElement);

beforeEach(() => {
  vi.clearAllMocks();
  hooks.clear.mockResolvedValue(undefined);
  hooks.remove.mockResolvedValue(undefined);
  hooks.rows = [
    row("kept", "completed", "Imported server"),
    row("gone", "purged", "Deleted server"),
  ];
});

describe("DiscordImportPage — row actions", () => {
  it("offers Clear only on a deleted import, and Delete on one that still holds its history", () => {
    render(<DiscordImportPage />);

    const kept = rowOf("Imported server");
    expect(
      kept.getByRole("button", { name: "Delete import" }),
    ).toBeInTheDocument();
    expect(kept.queryByRole("button", { name: "Clear" })).toBeNull();

    const gone = rowOf("Deleted server");
    expect(gone.getByRole("button", { name: "Clear" })).toBeInTheDocument();
    expect(gone.queryByRole("button", { name: "Delete import" })).toBeNull();
  });

  it("clears the row it was clicked on", async () => {
    render(<DiscordImportPage />);
    fireEvent.click(
      rowOf("Deleted server").getByRole("button", { name: "Clear" }),
    );
    await waitFor(() =>
      expect(hooks.clear).toHaveBeenCalledWith({ id: "gone" }),
    );
  });
});

describe("DiscordImportPage — a date cutoff (#2858)", () => {
  it("says on the row when an import took only messages since a date", () => {
    hooks.rows = [
      {
        ...row("partial", "completed", "Recent server"),
        messages_after: "2024-06-01T12:00:00Z",
      },
    ];
    render(<DiscordImportPage />);
    expect(
      rowOf("Recent server").getByText(/Messages since/),
    ).toBeInTheDocument();
  });
});

describe("DiscordImportPage — watching an import (#2857)", () => {
  const progress = {
    counts: { pending: 12, running: 1, completed: 3, failed: 1, skipped: 0 },
    running: [
      {
        discord_channel_id: "c-rush",
        discord_channel_name: "rush",
        imported_count: 240,
        error: null,
        target_channel_id: "frapp-rush",
      },
    ],
    recent: [
      {
        discord_channel_id: "c-general",
        discord_channel_name: "general",
        imported_count: 1,
        error: null,
        target_channel_id: "frapp-general",
      },
    ],
    failed: [
      {
        discord_channel_id: "c-exec",
        discord_channel_name: "exec",
        imported_count: 0,
        error: "Discord refused the bot (Missing Access).",
        target_channel_id: null,
      },
    ],
  };

  beforeEach(() => {
    hooks.progress.mockReturnValue({
      data: progress,
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    hooks.rows = [
      row("moving", "running", "Running server"),
      row("kept", "completed", "Imported server"),
      row("gone", "purged", "Deleted server"),
    ];
  });

  it("opens the import channel by channel, with links into chat, and closes again", () => {
    render(<DiscordImportPage />);
    const running = rowOf("Running server");
    fireEvent.click(running.getByRole("button", { name: "Watch" }));

    expect(hooks.progress).toHaveBeenCalledWith("moving", { active: true });
    expect(
      running.getByText(
        "Channels and threads: 3 done · 1 importing · 12 waiting · 1 failed",
      ),
    ).toBeInTheDocument();
    expect(running.getByText("Importing now")).toBeInTheDocument();
    expect(running.getByText("240 messages so far")).toBeInTheDocument();
    expect(running.getByText("1 message")).toBeInTheDocument();
    expect(
      running.getByText("Discord refused the bot (Missing Access)."),
    ).toBeInTheDocument();
    expect(
      running
        .getAllByRole("link", { name: /Open in chat/ })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/chat?channel=frapp-rush", "/chat?channel=frapp-general"]);

    fireEvent.click(running.getByRole("button", { name: "Hide" }));
    expect(running.queryByText("Importing now")).toBeNull();
    expect(running.getByRole("button", { name: "Watch" })).toBeInTheDocument();
  });

  it("calls it Details on a finished import, read once rather than polled", () => {
    render(<DiscordImportPage />);
    const kept = rowOf("Imported server");
    expect(kept.queryByRole("button", { name: "Watch" })).toBeNull();
    fireEvent.click(kept.getByRole("button", { name: "Details" }));
    expect(hooks.progress).toHaveBeenCalledWith("kept", { active: false });
    expect(kept.getByText("Finished")).toBeInTheDocument();
  });

  it("offers neither on a deleted import, which has no channels left to show", () => {
    render(<DiscordImportPage />);
    const gone = rowOf("Deleted server");
    expect(gone.queryByRole("button", { name: "Watch" })).toBeNull();
    expect(gone.queryByRole("button", { name: "Details" })).toBeNull();
  });

  it("says when the channels could not be loaded, and retries", () => {
    const refetch = vi.fn();
    hooks.progress.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    });
    render(<DiscordImportPage />);
    const running = rowOf("Running server");
    fireEvent.click(running.getByRole("button", { name: "Watch" }));
    expect(
      running.getByText("Couldn’t load the import’s channels"),
    ).toBeInTheDocument();
    fireEvent.click(running.getByRole("button", { name: /Retry/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it("keeps showing what it has when one poll fails", () => {
    hooks.progress.mockReturnValue({
      data: progress,
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    });
    render(<DiscordImportPage />);
    const running = rowOf("Running server");
    fireEvent.click(running.getByRole("button", { name: "Watch" }));
    expect(running.getByText("Importing now")).toBeInTheDocument();
    expect(
      running.queryByText("Couldn’t load the import’s channels"),
    ).toBeNull();
    // It says the read is not current, and can be retried.
    expect(
      running.getByText(/Couldn’t refresh the channels/),
    ).toBeInTheDocument();
    fireEvent.click(running.getByRole("button", { name: "Try again" }));
    expect(
      hooks.progress.mock.results.at(-1)?.value.refetch,
    ).toHaveBeenCalled();
  });

  it("closes a bot import's panel when another row becomes the polled one", () => {
    hooks.rows = [
      row("moving", "running", "Running server"),
      { ...row("uploaded", "running", "Uploaded server"), source: "upload" },
    ];
    render(<DiscordImportPage />);
    fireEvent.click(
      rowOf("Running server").getByRole("button", { name: "Watch" }),
    );
    expect(
      rowOf("Running server").getByText("Importing now"),
    ).toBeInTheDocument();
    fireEvent.click(
      rowOf("Uploaded server").getByRole("button", { name: "Watch" }),
    );
    // The bot row no longer updates, so its panel must not stay open.
    expect(rowOf("Running server").queryByText("Importing now")).toBeNull();
  });

  it("keeps the row's own progress live after Hide", () => {
    render(<DiscordImportPage />);
    const running = rowOf("Running server");
    fireEvent.click(running.getByRole("button", { name: "Watch" }));
    fireEvent.click(running.getByRole("button", { name: "Hide" }));
    // The detail poll still follows the import; only the panel closed.
    expect(hooks.detail).toHaveBeenLastCalledWith("moving");
    expect(running.queryByText("Importing now")).toBeNull();
  });

  it("says where a stopped import stopped, rather than that it is importing", () => {
    hooks.rows = [row("broke", "failed", "Failed server")];
    render(<DiscordImportPage />);
    const failed = rowOf("Failed server");
    fireEvent.click(failed.getByRole("button", { name: "Details" }));
    expect(failed.getByText("Stopped at")).toBeInTheDocument();
    expect(failed.queryByText("Importing now")).toBeNull();
    expect(failed.getByText("240 messages")).toBeInTheDocument();
  });

  it("has no channel panel for an upload, whose Watch keeps its count live", () => {
    hooks.rows = [
      { ...row("uploaded", "running", "Uploaded server"), source: "upload" },
    ];
    render(<DiscordImportPage />);
    const uploaded = rowOf("Uploaded server");
    fireEvent.click(uploaded.getByRole("button", { name: "Watch" }));
    expect(hooks.detail).toHaveBeenLastCalledWith("uploaded");
    expect(hooks.progress).not.toHaveBeenCalled();
    expect(uploaded.queryByRole("button", { name: "Hide" })).toBeNull();
  });
});
