import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The page a check-in QR opens in a phone's browser when no app claims the
 * link (2026-11-13): an incomplete link, the app hand-off, a signed-in check-in
 * with and without location, and a code that rotated out while they signed in.
 */

const { checkInMutate, ownRowRefetch, sessionUser, searchParams, device } = vi.hoisted(() => ({
  checkInMutate: vi.fn(),
  ownRowRefetch: vi.fn(),
  sessionUser: vi.fn(),
  searchParams: { current: new URLSearchParams() },
  device: { phone: null as "ios" | "android" | null },
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCheckIn: () => ({ mutateAsync: checkInMutate, isPending: false }),
  useMyAttendance: () => ({ refetch: ownRowRefetch }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParams.current,
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/use-phone-platform", () => ({
  usePhonePlatform: () => device.phone,
}));
vi.mock("@/lib/auth/rejected-session", () => ({
  getLiveSessionUser: sessionUser,
}));
// Sign out has its own spec; here it only has to render.
vi.mock("@/components/auth/signed-in-as", () => ({
  SignedInAs: ({ email }: { email: string | null }) => (
    <p>{`Signed in as ${email ?? ""}`}</p>
  ),
}));

import CheckInPage from "./page";

type Geo = Pick<Geolocation, "getCurrentPosition">;

function setGeolocation(geo: Geo | undefined) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: geo,
  });
}

function grantedAt(lat: number, lng: number, accuracy: number): Geo {
  return {
    getCurrentPosition: vi.fn((success: PositionCallback) =>
      success({
        coords: { latitude: lat, longitude: lng, accuracy },
      } as GeolocationPosition),
    ),
  };
}

function denied(): Geo {
  return {
    getCurrentPosition: vi.fn(
      (_success: PositionCallback, failure?: PositionErrorCallback | null) =>
        failure?.({ code: 1, message: "denied" } as GeolocationPositionError),
    ),
  };
}

const LINK = "event=ev-1&t=tok-abc";

beforeEach(() => {
  checkInMutate.mockReset();
  checkInMutate.mockResolvedValue({});
  ownRowRefetch.mockReset();
  ownRowRefetch.mockResolvedValue({
    isSuccess: true,
    data: { attendance: { status: "PRESENT", check_in_time: null } },
  });
  sessionUser.mockReset();
  sessionUser.mockResolvedValue({ id: "u-1", email: "brother@school.edu" });
  searchParams.current = new URLSearchParams(LINK);
  device.phone = null;
});

afterEach(() => {
  setGeolocation(undefined);
});

describe("web check-in link page", () => {
  it("says a link missing its code is incomplete", async () => {
    searchParams.current = new URLSearchParams("event=ev-1");
    render(<CheckInPage />);

    expect(
      await screen.findByText(
        "This check-in link is incomplete. Point your camera at the code again.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check in here" })).toBeNull();
  });

  it("offers the app on an iPhone, opening this check-in by the app's scheme", async () => {
    device.phone = "ios";
    sessionUser.mockResolvedValue(null);
    render(<CheckInPage />);

    const open = await screen.findByRole("link", { name: "Open in Frapp" });
    expect(open.getAttribute("href")).toBe(
      "frapp://check-in?event=ev-1&t=tok-abc",
    );
    expect(
      screen.getByRole("link", { name: "Get Frapp" }).getAttribute("href"),
    ).toBe("https://apps.apple.com/app/id6812025642");
    // Signed out: sign in, and come back to this exact link.
    expect(
      screen.getByRole("link", { name: "Sign in" }).getAttribute("href"),
    ).toBe(`/sign-in?redirectTo=${encodeURIComponent(`/check-in?${LINK}`)}`);
  });

  it("hands Android the intent link", async () => {
    device.phone = "android";
    sessionUser.mockResolvedValue(null);
    render(<CheckInPage />);

    expect(
      (
        await screen.findByRole("link", { name: "Open in Frapp" })
      ).getAttribute("href"),
    ).toBe(
      "intent://check-in?event=ev-1&t=tok-abc#Intent;scheme=frapp;package=live.frapp.mobile;end",
    );
  });

  it("checks a signed-in member in with one tap, sending the code and where they are", async () => {
    const geo = grantedAt(40.1, -75.2, 12);
    setGeolocation(geo);
    render(<CheckInPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Check in here" }),
    );

    expect(await screen.findByText("You're checked in")).toBeTruthy();
    expect(geo.getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
    expect(checkInMutate).toHaveBeenCalledWith({
      eventId: "ev-1",
      token: "tok-abc",
      lat: 40.1,
      lng: -75.2,
      accuracy_meters: 12,
    });
  });

  it("still checks in without coordinates when location is refused", async () => {
    setGeolocation(denied());
    render(<CheckInPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Check in here" }),
    );

    expect(await screen.findByText("You're checked in")).toBeTruthy();
    expect(checkInMutate).toHaveBeenCalledWith({
      eventId: "ev-1",
      token: "tok-abc",
    });
  });

  it("says where to allow location when the event needed it, and offers Try again", async () => {
    device.phone = "ios";
    setGeolocation(denied());
    checkInMutate.mockRejectedValueOnce({
      statusCode: 400,
      message:
        "This check-in needs your location. Allow location for Frapp and scan again.",
    });
    render(<CheckInPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Check in here" }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "In Safari, tap aA",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("You're checked in")).toBeTruthy();
    expect(checkInMutate).toHaveBeenCalledTimes(2);
  });

  it("tells a member whose code rotated out to scan again", async () => {
    setGeolocation(undefined);
    checkInMutate.mockRejectedValueOnce({
      statusCode: 403,
      message:
        "That check-in code is not valid for this event, or it has expired",
    });
    render(<CheckInPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Check in here" }),
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "That code has changed since you scanned it. Point your camera at the screen again.",
    );
    // The same code can't work twice, so nothing offers to resend it.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("counts an earlier check-in as done", async () => {
    checkInMutate.mockRejectedValueOnce({
      statusCode: 409,
      message: "Already checked in for this event",
    });
    render(<CheckInPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Check in here" }),
    );

    expect(await screen.findByText("You're already checked in")).toBeTruthy();
  });

  it("says an officer's mark rather than checked in, when the row is one (#3703)", async () => {
    checkInMutate.mockRejectedValueOnce({
      statusCode: 409,
      message: "Already checked in for this event",
    });
    ownRowRefetch.mockResolvedValueOnce({
      isSuccess: true,
      data: { attendance: { status: "EXCUSED", check_in_time: null } },
    });
    render(<CheckInPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Check in here" }),
    );

    expect(
      await screen.findByText("An officer marked you excused for this event."),
    ).toBeTruthy();
    expect(screen.queryByText("You're already checked in")).toBeNull();
  });

  it("sends one check-in for a double tap", async () => {
    let finish: (value: unknown) => void = () => {};
    checkInMutate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<CheckInPage />);

    const button = await screen.findByRole("button", { name: "Check in here" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(checkInMutate).toHaveBeenCalledTimes(1));
    finish({});
    expect(await screen.findByText("You're checked in")).toBeTruthy();
    expect(checkInMutate).toHaveBeenCalledTimes(1);
  });

  it("shows Checking in… while it works", async () => {
    let finish: (value: unknown) => void = () => {};
    checkInMutate.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    render(<CheckInPage />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Check in here" }),
    );

    const pending = await screen.findByRole("button", { name: "Checking in…" });
    expect(pending).toHaveProperty("disabled", true);
    finish({});
    await waitFor(() =>
      expect(screen.getByText("You're checked in")).toBeTruthy(),
    );
  });
});
