import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const {
  googleHook,
  startSpy,
  confirmSpy,
  disconnectSpy,
  toastSpy,
  identities,
  feedLink,
} = vi.hoisted(() => ({
  googleHook: vi.fn(),
  startSpy: vi.fn(),
  confirmSpy: vi.fn(),
  disconnectSpy: vi.fn(),
  toastSpy: vi.fn(),
  identities: vi.fn(),
  feedLink: vi.fn<(options: { enabled: boolean }) => unknown>(() => ({
    data: undefined,
    isFetching: false,
    refetch: vi.fn(),
  })),
}));

const OFF = {
  available: true,
  connected: false,
  status: null,
  google_email: null,
  last_synced_at: null,
};

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useActiveChapterId: () => "chap-1",
    useCalendarFeedLink: feedLink,
    useResetCalendarFeedLink: () => ({
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useCurrentChapter: () => ({ data: { name: "FIJI Lambda" } }),
    useGoogleCalendarStatus: googleHook,
    useStartGoogleCalendarConnect: () => ({
      mutateAsync: startSpy,
      isPending: false,
    }),
    useConfirmGoogleCalendarConnect: () => ({ mutateAsync: confirmSpy }),
    useDisconnectGoogleCalendar: () => ({
      mutateAsync: disconnectSpy,
      isPending: false,
    }),
  };
});
vi.mock("@/components/linked-apps/discord-row", () => ({
  DiscordRow: () => null,
}));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getUserIdentities: identities,
      getUser: async () => ({ data: { user: { email: "me@frapp.live" } } }),
    },
  }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

import { LinkedAppsSection } from "./linked-apps-section";
import { CalendarSection } from "@/components/personal-settings/calendar-section";

function renderWithClient(ui: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}

function row(name: string) {
  return screen.getByText(name).closest("li")!;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/preferences?section=apps");
  googleHook.mockReturnValue({ data: OFF, isError: false });
  identities.mockResolvedValue({
    data: {
      identities: [
        { provider: "google", identity_data: { email: "g@gmail.com" } },
      ],
    },
    error: null,
  });
  startSpy.mockResolvedValue("https://accounts.google.com/x");
});

describe("Settings → Linked apps (#5407)", () => {
  it("greys Google Calendar until connected, and connects back to Linked apps", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderWithClient(<LinkedAppsSection />);

    expect(row("Google Calendar")).toHaveAttribute("data-linked-state", "off");
    await userEvent.click(
      within(row("Google Calendar")).getByRole("button", { name: "Connect" }),
    );
    expect(startSpy).toHaveBeenCalledWith({
      client: "web",
      webReturn: "linked_apps",
    });
    vi.unstubAllGlobals();
  });

  it("draws a check once connected, and red with Reconnect once expired", () => {
    googleHook.mockReturnValue({
      data: {
        ...OFF,
        connected: true,
        status: "active",
        google_email: "a@b.com",
      },
      isError: false,
    });
    const { rerender } = renderWithClient(<LinkedAppsSection />);
    expect(
      within(row("Google Calendar")).getByRole("img", { name: "Connected" }),
    ).toBeInTheDocument();
    expect(screen.getByText("a@b.com")).toBeInTheDocument();

    googleHook.mockReturnValue({
      data: { ...OFF, connected: true, status: "needs_reconnect" },
      isError: false,
    });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <LinkedAppsSection />
      </QueryClientProvider>,
    );
    expect(
      within(row("Google Calendar")).getByRole("img", { name: "Expired" }),
    ).toBeInTheDocument();
    expect(
      within(row("Google Calendar")).getByRole("button", { name: "Reconnect" }),
    ).toBeInTheDocument();
  });

  it("offers a retry when the connection can't be read, rather than hiding the row", () => {
    const refetch = vi.fn();
    googleHook.mockReturnValue({ data: undefined, isError: true, refetch });
    renderWithClient(<LinkedAppsSection />);
    expect(
      screen.getByText("Couldn't load your connection"),
    ).toBeInTheDocument();
  });

  it("finishes a Google sign-in that came back here, and says it worked", async () => {
    window.history.replaceState(
      null,
      "",
      "/preferences?section=apps&gcal=confirm&gcal_code=c1&gcal_state=s1",
    );
    confirmSpy.mockResolvedValue({});
    renderWithClient(<LinkedAppsSection />);

    await waitFor(() =>
      expect(confirmSpy).toHaveBeenCalledWith({ code: "c1", state: "s1" }),
    );
    expect(window.location.search).toBe("?section=apps");
    await waitFor(() =>
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Google Calendar connected" }),
      ),
    );
  });

  it("lists the ways the account signs in, checked where it has them", async () => {
    renderWithClient(<LinkedAppsSection />);
    expect(await screen.findByText("g@gmail.com")).toBeInTheDocument();
    expect(
      within(row("Google")).getByRole("img", { name: "Connected" }),
    ).toBeInTheDocument();
    expect(
      within(row("Apple")).getByRole("img", { name: "Not connected" }),
    ).toBeInTheDocument();
  });
});

describe("Settings → Calendar (#5407)", () => {
  it("makes no calendar link just because the page opened", () => {
    renderWithClient(<CalendarSection />);
    expect(feedLink).toHaveBeenLastCalledWith({ enabled: false });
    expect(screen.getByRole("button", { name: "Copy link" })).toBeEnabled();
  });

  it("connects Google back to the Calendar section", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderWithClient(<CalendarSection />);
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(startSpy).toHaveBeenCalledWith({
      client: "web",
      webReturn: "calendar",
    });
    vi.unstubAllGlobals();
  });
});
