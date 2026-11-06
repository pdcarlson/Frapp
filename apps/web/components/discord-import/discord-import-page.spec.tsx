import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { cardFilledContainers } from "@/tests/card-surfaces";

/**
 * `/discord-import` as the chapter's one import (#2882 redesign): the start,
 * the import running, finished, or being deleted. Which import is "the one"
 * is `currentImport` (tested on its own); this is what the page draws for it.
 */

const { hooks } = vi.hoisted(() => ({
  hooks: {
    rows: [] as unknown[],
    // A failed list read. With rows cached the page keeps them; with none
    // (`listCached: false`) it draws the error state.
    listError: false,
    listCached: true,
    offline: false,
    loading: false,
    botAvailable: true,
    // The page's query string, for the `?wizard=bot` resume.
    search: "",
    // Records the props each wizard mount receives.
    wizard: vi.fn(),
    clear: vi.fn(),
    remove: vi.fn(),
    cancel: vi.fn(),
    progress: vi.fn(),
    refetch: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(hooks.search),
}));

vi.mock("@repo/hooks", () => ({
  DISCORD_CONNECT_MESSAGES: {},
  useDiscordImports: () => ({
    data: hooks.listCached ? hooks.rows : undefined,
    isPending: hooks.loading,
    isLoading: hooks.loading,
    isError: hooks.listError,
    fetchStatus: "idle",
    refetch: hooks.refetch,
  }),
  useDiscordAvailability: () => ({
    data: { available: hooks.botAvailable },
  }),
  useDiscordConnection: () => ({ data: { connected: false } }),
  useDiscordImportProgress: (id: string, options: { active: boolean }) =>
    hooks.progress(id, options),
  useCancelDiscordImport: () => ({
    mutateAsync: hooks.cancel,
    isPending: false,
  }),
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
  useNetwork: () => ({ isOffline: hooks.offline, probeOnce: vi.fn() }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("./import-wizard", () => ({
  ImportWizard: (props: {
    onCancel: () => void;
    onStarted: (id: string) => void;
  }) => {
    hooks.wizard(props);
    return (
      <div data-testid="wizard">
        <button type="button" onClick={props.onCancel}>
          Close wizard
        </button>
        <button type="button" onClick={() => props.onStarted("started")}>
          Start import
        </button>
      </div>
    );
  },
}));

const { DiscordImportPage } = await import("./discord-import-page");

const row = (id: string, status: string, guild: string) => ({
  id,
  status,
  source: "bot",
  guild_name: guild,
  total_messages: 5307,
  imported_messages: 5307,
  channels_total: null as number | null,
  channels_done: null as number | null,
  messages_skipped: 0,
  attachments_imported: 0,
  warnings: [] as string[],
  error: null as string | null,
  created_at: "2026-09-28T18:06:33Z",
  completed_at: null as string | null,
});

const STALE =
  "Couldn't refresh the import. This is the last update that loaded.";

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

const n = (count: number) => count.toLocaleString("en-US");

beforeEach(() => {
  vi.clearAllMocks();
  hooks.listError = false;
  hooks.listCached = true;
  hooks.offline = false;
  hooks.loading = false;
  hooks.botAvailable = true;
  hooks.search = "";
  hooks.clear.mockResolvedValue(undefined);
  hooks.remove.mockResolvedValue(undefined);
  hooks.cancel.mockResolvedValue(undefined);
  hooks.progress.mockReturnValue({
    data: progress,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  hooks.rows = [];
});

describe("DiscordImportPage — nothing imported yet", () => {
  it("says what comes over and offers the two ways in, on the page surface", () => {
    const { container } = render(<DiscordImportPage />);

    expect(
      screen.getByRole("heading", {
        name: "Bring your chapter's Discord history into Frapp",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Connect Discord/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: /Upload an export/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Comes over")).toBeInTheDocument();
    expect(
      screen.getByText("DMs, voice, and who holds which role"),
    ).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("disables Connect Discord where the bot is unavailable", () => {
    hooks.botAvailable = false;
    render(<DiscordImportPage />);
    expect(
      screen.getByRole("button", { name: /Connect Discord/ }),
    ).toBeDisabled();
  });

  // The wizard's own first step is the landing's two cards, so a pick opens
  // the wizard past it.
  it.each([
    ["Connect Discord", "bot", "connect"],
    ["Upload an export", "upload", "consent"],
  ])("opens the wizard past its first step on %s", (name, source, step) => {
    render(<DiscordImportPage />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(name) }));

    expect(screen.getByTestId("wizard")).toBeInTheDocument();
    expect(hooks.wizard).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialSource: source,
        initialStep: step,
        handshake: null,
      }),
    );
  });

  it("treats a draft as nothing imported", () => {
    hooks.rows = [row("left", "draft", "Half-set-up server")];
    render(<DiscordImportPage />);
    expect(
      screen.getByRole("heading", {
        name: "Bring your chapter's Discord history into Frapp",
      }),
    ).toBeInTheDocument();
  });

  it("names the last import deleted until it is dismissed", async () => {
    hooks.rows = [row("gone", "purged", "Deleted server")];
    render(<DiscordImportPage />);

    expect(
      screen.getByText("The import from Deleted server was deleted."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(hooks.clear).toHaveBeenCalledWith({ id: "gone" }),
    );
  });
});

describe("DiscordImportPage — reads", () => {
  it("says what failed when the first read fails", () => {
    hooks.listError = true;
    hooks.listCached = false;
    const { container } = render(<DiscordImportPage />);

    expect(
      screen.getByRole("heading", { name: "Couldn't load the import" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Confirm your chapter access and retry."),
    ).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("says the import is unavailable offline when nothing is cached", () => {
    hooks.offline = true;
    hooks.listCached = false;
    render(<DiscordImportPage />);
    expect(
      screen.getByRole("heading", { name: "Import unavailable offline" }),
    ).toBeInTheDocument();
  });

  it("announces its loading state", () => {
    hooks.loading = true;
    hooks.listCached = false;
    render(<DiscordImportPage />);
    expect(screen.getByText("Loading the import")).toBeInTheDocument();
  });

  it("keeps the import and says it is the last that loaded when a refresh fails", () => {
    hooks.rows = [row("kept", "completed", "Imported server")];
    hooks.listError = true;
    render(<DiscordImportPage />);

    expect(
      screen.getByRole("heading", { name: "Your Discord history is in Frapp" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(STALE);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(hooks.refetch).toHaveBeenCalled();
  });

  it("has the notice's live region mounted before a refresh fails, so its line is announced", () => {
    hooks.rows = [row("kept", "completed", "Imported server")];
    const { container, rerender } = render(<DiscordImportPage />);
    const regions = [...container.querySelectorAll('[role="status"]')];

    hooks.listError = true;
    rerender(<DiscordImportPage />);

    expect(regions).toContain(
      screen.getByText(STALE).closest('[role="status"]'),
    );
  });
});

describe("DiscordImportPage — the wizard", () => {
  // A resume is spent once its wizard closes, whichever way it closes.
  it.each([
    ["is cancelled", "Close wizard"],
    ["starts an import", "Start import"],
  ])("opens past the start after a ?wizard=bot resume that %s", (_, close) => {
    hooks.search = "wizard=bot&handshake=one-time";
    render(<DiscordImportPage />);
    expect(hooks.wizard).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialSource: "bot",
        initialStep: "connect",
        handshake: "one-time",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: close }));
    expect(screen.queryByTestId("wizard")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Upload an export/ }));
    expect(hooks.wizard).toHaveBeenLastCalledWith(
      expect.objectContaining({
        initialSource: "upload",
        initialStep: "consent",
        handshake: null,
      }),
    );
  });

  // The wizard holds every choice in its own state, so a branch that unmounts
  // it sends the admin back to the first step with nothing kept.
  it.each([
    [
      "fails with nothing cached",
      { listError: true },
      "Couldn't load the import",
    ],
    [
      "goes offline with nothing cached",
      { offline: true },
      "Import unavailable offline",
    ],
    ["reloads with nothing cached", { loading: true }, "Loading the import"],
  ])("keeps an open wizard through a read that %s", (_, state, branch) => {
    const { container, rerender } = render(<DiscordImportPage />);
    fireEvent.click(screen.getByRole("button", { name: /Connect Discord/ }));
    expect(screen.getByTestId("wizard")).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);

    Object.assign(hooks, state, { listCached: false });
    rerender(<DiscordImportPage />);
    expect(screen.getByTestId("wizard")).toBeInTheDocument();
    expect(screen.queryByText(branch)).toBeNull();
  });
});

describe("DiscordImportPage — importing", () => {
  beforeEach(() => {
    hooks.rows = [
      {
        ...row("moving", "running", "Tau Nu Discord"),
        imported_messages: 12840,
        channels_total: 10,
        channels_done: 4,
      },
    ];
  });

  it("counts the messages in, says it can be left, and offers Stop", async () => {
    render(<DiscordImportPage />);

    expect(screen.getByText("Importing · Tau Nu Discord")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: `${n(12840)} messages in so far` }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/4 of 10 channels and threads done\./),
    ).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stop import" }));
    await waitFor(() =>
      expect(hooks.cancel).toHaveBeenCalledWith({ id: "moving" }),
    );
  });

  it("calls a queued import waiting to start", () => {
    hooks.rows = [row("queued", "ready", "Tau Nu Discord")];
    render(<DiscordImportPage />);
    expect(
      screen.getByText("Waiting to start · Tau Nu Discord"),
    ).toBeInTheDocument();
  });

  it("opens every channel live, with links into chat, and closes again", () => {
    render(<DiscordImportPage />);
    expect(hooks.progress).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "See every channel" }));
    expect(hooks.progress).toHaveBeenCalledWith("moving", { active: true });
    expect(
      screen.getByText(
        "Channels and threads: 3 done · 1 importing · 12 waiting · 1 failed",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Importing now")).toBeInTheDocument();
    expect(
      screen.getByText("Discord refused the bot (Missing Access)."),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("link", { name: /Open in chat/ })
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/chat?channel=frapp-rush", "/chat?channel=frapp-general"]);

    fireEvent.click(screen.getByRole("button", { name: "Hide channels" }));
    expect(screen.queryByText("Importing now")).toBeNull();
  });

  it("has no channel panel for an upload, which records no channel order", () => {
    hooks.rows = [
      { ...row("uploaded", "running", "Uploaded server"), source: "upload" },
    ];
    render(<DiscordImportPage />);
    expect(
      screen.queryByRole("button", { name: "See every channel" }),
    ).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "See every channel" }));
    expect(
      screen.getByText("Couldn’t load the import’s channels"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("DiscordImportPage — finished", () => {
  // Staging's import, 2026-09-30.
  const done = {
    ...row("big", "completed", "Tau Nu Discord"),
    imported_messages: 145574,
    attachments_imported: 11612,
    channels_total: 1146,
    channels_done: 1146,
    completed_at: "2026-09-30T20:12:00Z",
    warnings: [
      '"IMG_2231.heic" is a file type Frapp doesn\'t store (application/octet-stream) and was not imported. The message it belongs to was.',
      '"scan" has no file type Frapp could tell, so it was not imported. The message it belongs to was.',
      'Storage couldn\'t take "flyer.pdf", so it was not imported. The message it belongs to was.',
    ],
  };

  beforeEach(() => {
    hooks.rows = [done];
  });

  it("says what came over, and opens chat", () => {
    render(<DiscordImportPage />);

    expect(
      screen.getByRole("heading", { name: "Your Discord history is in Frapp" }),
    ).toBeInTheDocument();
    expect(screen.getByText(n(145574))).toBeInTheDocument();
    expect(screen.getByText(n(11612))).toBeInTheDocument();
    expect(screen.getByText(n(1146))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open chat" })).toHaveAttribute(
      "href",
      "/chat",
    );
  });

  it("groups what didn't come over by reason, in plain words", () => {
    render(<DiscordImportPage />);

    expect(screen.getByText("3 things didn't come over")).toBeInTheDocument();
    expect(
      screen.getByText("File types Frapp doesn't store"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Files with no type Frapp could tell"),
    ).toBeInTheDocument();
    expect(screen.getByText("Files storage couldn't take")).toBeInTheDocument();
    expect(screen.getByText("IMG_2231.heic")).toBeInTheDocument();
    expect(screen.queryByText(/Only the last/)).toBeNull();
  });

  it("names a stopped import as stopped, without Open chat", () => {
    hooks.rows = [
      { ...done, status: "failed", error: "Discord stopped answering." },
    ];
    render(<DiscordImportPage />);
    expect(
      screen.getByRole("heading", { name: "The import stopped on an error" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Discord stopped answering.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open chat" })).toBeNull();
  });

  it("says when an import took only messages since a date (#2858)", () => {
    hooks.rows = [{ ...done, messages_after: "2024-06-01T12:00:00Z" }];
    render(<DiscordImportPage />);
    expect(screen.getByText(/messages since/)).toBeInTheDocument();
  });

  it("reads the channels once rather than polling them", () => {
    render(<DiscordImportPage />);
    fireEvent.click(screen.getByRole("button", { name: "See every channel" }));
    expect(hooks.progress).toHaveBeenCalledWith("big", { active: false });
  });
});

describe("DiscordImportPage — deleting the import (#2944)", () => {
  const large = {
    ...row("big", "completed", "Tau Nu Discord"),
    imported_messages: 145574,
    attachments_imported: 11612,
  };

  beforeEach(() => {
    hooks.rows = [large];
  });

  it("asks first, naming what goes and what stays, and Cancel sends nothing", async () => {
    render(<DiscordImportPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete import" }));

    const dialog = within(await screen.findByRole("dialog"));
    expect(
      dialog.getByText("Delete the import from Tau Nu Discord?"),
    ).toBeInTheDocument();
    const description = dialog.getByText(/This deletes/).textContent ?? "";
    expect(description).toContain(
      `the ${n(145574)} messages and ${n(11612)} attachments it brought in`,
    );
    expect(description).toContain(
      "The roles and read permissions it created stay.",
    );
    expect(description).toContain("This cannot be undone.");

    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(hooks.remove).not.toHaveBeenCalled();
  });

  it("deletes the import it was confirmed for", async () => {
    render(<DiscordImportPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete import" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Delete import" }));
    await waitFor(() =>
      expect(hooks.remove).toHaveBeenCalledWith({ id: "big" }),
    );
  });

  // The import is polled while it moves. A dialog inside a branch that swaps
  // out would unmount and settle as a cancel, dropping the confirmation.
  it.each([
    ["a failed poll", { listError: true }],
    ["the error state", { listError: true, listCached: false }],
  ])("keeps an open confirmation through %s", async (_, state) => {
    const { rerender } = render(<DiscordImportPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete import" }));
    await screen.findByRole("dialog");

    Object.assign(hooks, state);
    rerender(<DiscordImportPage />);

    const dialog = within(screen.getByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Delete import" }));
    await waitFor(() =>
      expect(hooks.remove).toHaveBeenCalledWith({ id: "big" }),
    );
  });

  // A purge that failed part-way: the import is `failed`, Delete is offered
  // again, and its counts must not read as though nothing were gone.
  it("says how many a failed deletion already removed, and asks about what is left", async () => {
    hooks.rows = [{ ...large, status: "failed", purged_messages: 100000 }];
    render(<DiscordImportPage />);
    expect(screen.getByText(/100,000 already deleted/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete import" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(
      dialog.getByText(/An earlier deletion already removed/).textContent,
    ).toContain(`This deletes the ${n(45574)} left`);
  });

  it("counts a deleting import's messages down from the API's count", () => {
    hooks.rows = [{ ...large, status: "purging", purged_messages: 5874 }];
    render(<DiscordImportPage />);
    expect(
      screen.getByRole("heading", { name: "Deleting the import" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`Deleting: ${n(139700)} of ${n(145574)} messages left`),
    ).toBeInTheDocument();
    expect(screen.getByText("4%")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete import" })).toBeNull();
  });

  it("says what it is still doing once the messages are gone", () => {
    hooks.rows = [{ ...large, status: "purging", purged_messages: 145574 }];
    render(<DiscordImportPage />);
    expect(
      screen.getByText(
        "Messages deleted. Finishing with its channels and archive files.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).toBeNull();
  });
});
