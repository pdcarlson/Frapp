import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarSubscribeMenu } from "./calendar-subscribe-menu";

const LINK = {
  url: "https://api.frapp.live/v1/calendar-feed/feed.ics?token=abc",
  webcal_url: "webcal://api.frapp.live/v1/calendar-feed/feed.ics?token=abc",
};

const {
  linkHook,
  resetSpy,
  toastSpy,
  googleHook,
  startSpy,
  confirmSpy,
  disconnectSpy,
} = vi.hoisted(() => ({
  linkHook: vi.fn(),
  resetSpy: vi.fn(),
  toastSpy: vi.fn(),
  googleHook: vi.fn(),
  startSpy: vi.fn(),
  confirmSpy: vi.fn(),
  disconnectSpy: vi.fn(),
}));

const NOT_OFFERED = { data: { available: false, connected: false } };
const OFFERED = {
  data: {
    available: true,
    connected: false,
    status: null,
    google_email: null,
    last_synced_at: null,
  },
};
const CONNECTED = {
  data: {
    available: true,
    connected: true,
    status: "active",
    google_email: "member@gmail.com",
    last_synced_at: "2026-11-12T19:00:00.000Z",
  },
};

vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    ...actual,
    useCalendarFeedLink: linkHook,
    useResetCalendarFeedLink: () => ({
      mutateAsync: resetSpy,
      isPending: false,
    }),
    useActiveChapterId: () => "chap-1",
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

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: /subscribe/i }));
}

// #3322: the Events toolbar's calendar subscription menu.
describe("CalendarSubscribeMenu", () => {
  beforeEach(() => {
    linkHook.mockReset();
    linkHook.mockImplementation(({ enabled }: { enabled: boolean }) => ({
      data: enabled ? LINK : undefined,
      isError: false,
    }));
    resetSpy.mockReset();
    toastSpy.mockReset();
    googleHook.mockReset();
    googleHook.mockReturnValue(NOT_OFFERED);
    startSpy.mockReset();
    confirmSpy.mockReset();
    disconnectSpy.mockReset();
    window.history.replaceState(null, "", "/events");
  });

  it("asks for no link until the menu opens", async () => {
    render(<CalendarSubscribeMenu />);
    expect(linkHook).toHaveBeenLastCalledWith({ enabled: false });

    await openMenu();
    expect(linkHook).toHaveBeenLastCalledWith({ enabled: true });
  });

  it("offers each calendar app, Copy link and Reset link", async () => {
    render(<CalendarSubscribeMenu />);
    await openMenu();

    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ).toEqual([
      "Apple Calendar",
      "Google Calendar",
      "Outlook.com",
      "Outlook for school or work",
      "Copy link",
      "Reset link",
    ]);
    expect(
      screen.getByRole("menuitem", { name: "Apple Calendar" }),
    ).toHaveAttribute("href", LINK.webcal_url);
    const google = screen.getByRole("menuitem", { name: "Google Calendar" });
    expect(new URL(google.getAttribute("href")!).searchParams.get("cid")).toBe(
      LINK.webcal_url,
    );
    expect(google).toHaveAttribute("target", "_blank");
    const outlook = screen.getByRole("menuitem", { name: "Outlook.com" });
    expect(new URL(outlook.getAttribute("href")!).searchParams.get("url")).toBe(
      LINK.url,
    );
    const work = screen.getByRole("menuitem", {
      name: "Outlook for school or work",
    });
    expect(new URL(work.getAttribute("href")!).host).toBe("outlook.office.com");
  });

  it("keeps the rows drawn but disabled until the link arrives", async () => {
    linkHook.mockImplementation(() => ({ data: undefined, isError: false }));
    render(<CalendarSubscribeMenu />);
    await openMenu();

    const rows = await screen.findAllByRole("menuitem");
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row).toHaveAttribute("data-disabled");
    }
  });

  it("says so when the link can't be had", async () => {
    linkHook.mockImplementation(() => ({ data: undefined, isError: true }));
    render(<CalendarSubscribeMenu />);
    await openMenu();

    expect(
      await screen.findByText(/couldn't get your calendar link/i),
    ).toBeInTheDocument();
  });

  it("copies the https link", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<CalendarSubscribeMenu />);
    await openMenu();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Copy link" }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK.url));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/copied/i) }),
    );
  });

  it("resets only after the member confirms", async () => {
    resetSpy.mockResolvedValue(LINK);
    render(<CalendarSubscribeMenu />);
    await openMenu();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Reset link" }),
    );

    expect(resetSpy).not.toHaveBeenCalled();
    await userEvent.click(
      await screen.findByRole("button", { name: "Reset link" }),
    );
    await waitFor(() => expect(resetSpy).toHaveBeenCalledTimes(1));
  });

  // #3322 step 2: where the server offers it, Google connects instead.
  describe("Google Calendar", () => {
    it("connects Google from the Google row, not the link", async () => {
      googleHook.mockReturnValue(OFFERED);
      startSpy.mockResolvedValue("https://accounts.google.com/o/oauth2/v2/auth");
      render(<CalendarSubscribeMenu />);
      await openMenu();

      const row = await screen.findByRole("menuitem", {
        name: "Google Calendar",
      });
      expect(row).not.toHaveAttribute("href");
      await userEvent.click(row);

      await waitFor(() =>
        expect(startSpy).toHaveBeenCalledWith({ client: "web" }),
      );
    });

    it("once connected, opens Google Calendar, names the account and offers Disconnect", async () => {
      googleHook.mockReturnValue(CONNECTED);
      disconnectSpy.mockResolvedValue(undefined);
      render(<CalendarSubscribeMenu />);
      await openMenu();

      const row = await screen.findByRole("menuitem", {
        name: /Google Calendar\s*Connected/,
      });
      expect(row).toHaveAttribute("href", "https://calendar.google.com/calendar/r");
      expect(screen.getByText(/connected as member@gmail.com/)).toBeInTheDocument();

      await userEvent.click(
        screen.getByRole("menuitem", { name: "Disconnect Google Calendar" }),
      );
      expect(disconnectSpy).not.toHaveBeenCalled();
      await userEvent.click(
        await screen.findByRole("button", { name: "Disconnect" }),
      );
      await waitFor(() => expect(disconnectSpy).toHaveBeenCalledTimes(1));
    });

    it("asks to reconnect once Google refused the sign-in", async () => {
      googleHook.mockReturnValue({
        data: { ...CONNECTED.data, status: "needs_reconnect" },
      });
      startSpy.mockResolvedValue("https://accounts.google.com/o/oauth2/v2/auth");
      render(<CalendarSubscribeMenu />);
      await openMenu();

      await userEvent.click(
        await screen.findByRole("menuitem", { name: /Reconnect/ }),
      );
      await waitFor(() => expect(startSpy).toHaveBeenCalled());
    });

    it("finishes a sign-in Google sent back, once, and clears it from the address", async () => {
      confirmSpy.mockResolvedValue(CONNECTED.data);
      window.history.replaceState(
        null,
        "",
        "/events?event=e1&gcal=confirm&gcal_code=code-1&gcal_state=state-1",
      );
      const { rerender } = render(<CalendarSubscribeMenu />);
      rerender(<CalendarSubscribeMenu />);

      await waitFor(() =>
        expect(confirmSpy).toHaveBeenCalledWith({
          code: "code-1",
          state: "state-1",
        }),
      );
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(window.location.search).toBe("?event=e1");
      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith({
          description: expect.stringMatching(/Google Calendar connected/),
        }),
      );
    });

    it("says so when the member cancelled on Google's page", async () => {
      window.history.replaceState(null, "", "/events?gcal=denied");
      render(<CalendarSubscribeMenu />);

      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            description: "Google Calendar wasn't connected.",
          }),
        ),
      );
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(window.location.search).toBe("");
    });
  });
});
