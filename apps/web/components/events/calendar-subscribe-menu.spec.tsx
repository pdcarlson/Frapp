import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarSubscribeMenu } from "./calendar-subscribe-menu";

const LINK = {
  url: "https://api.frapp.live/v1/calendar-feed/feed.ics?token=abc",
  webcal_url: "webcal://api.frapp.live/v1/calendar-feed/feed.ics?token=abc",
};

const { linkHook, resetSpy, toastSpy } = vi.hoisted(() => ({
  linkHook: vi.fn(),
  resetSpy: vi.fn(),
  toastSpy: vi.fn(),
}));

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
});
