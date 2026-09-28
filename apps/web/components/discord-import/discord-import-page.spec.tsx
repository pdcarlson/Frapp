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
  useDiscordImport: () => ({ data: null }),
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
