import React from "react";
import { act } from "react";
import { Alert, Platform, Share } from "react-native";
import * as Linking from "expo-linking";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@gorhom/bottom-sheet", () => ({
  BottomSheetModal: "BottomSheetModal",
  BottomSheetView: "View",
}));

const LINK = {
  url: "https://api.frapp.live/v1/calendar-feed/feed.ics?token=abc",
  webcal_url: "webcal://api.frapp.live/v1/calendar-feed/feed.ics?token=abc",
};

const state = vi.hoisted(() => ({
  data: undefined as typeof LINK | undefined,
  isError: false,
  enabledCalls: [] as boolean[],
  reset: vi.fn(),
  copy: vi.fn(),
  google: { available: false, connected: false } as Record<string, unknown>,
  start: vi.fn(),
  confirm: vi.fn(),
  disconnect: vi.fn(),
  authSession: vi.fn(),
}));

vi.mock("expo-web-browser", () => ({
  openAuthSessionAsync: state.authSession,
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCalendarFeedLink: ({ enabled }: { enabled: boolean }) => {
    state.enabledCalls.push(enabled);
    return { data: state.data, isError: state.isError };
  },
  useResetCalendarFeedLink: () => ({
    mutateAsync: state.reset,
    isPending: false,
  }),
  useGoogleCalendarStatus: () => ({ data: state.google }),
  useStartGoogleCalendarConnect: () => ({
    mutateAsync: state.start,
    isPending: false,
  }),
  useConfirmGoogleCalendarConnect: () => ({ mutateAsync: state.confirm }),
  useDisconnectGoogleCalendar: () => ({
    mutateAsync: state.disconnect,
    isPending: false,
  }),
}));

vi.mock("expo-clipboard", () => ({ setStringAsync: state.copy }));

import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import { CalendarSubscribeSheet } from "./calendar-subscribe-sheet";

function render(open = true): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <CalendarSubscribeSheet ref={null} open={open} onDismiss={() => {}} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function row(tree: ReactTestRenderer, label: string) {
  return tree.root.find(
    (node) =>
      node.props.accessibilityRole === "button" &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  );
}

const originalOS = Platform.OS;

// #3322: the Events header's Subscribe sheet.
describe("CalendarSubscribeSheet", () => {
  beforeEach(() => {
    state.data = LINK;
    state.isError = false;
    state.enabledCalls = [];
    state.reset.mockReset();
    state.copy.mockReset();
    state.copy.mockResolvedValue(true);
    state.google = { available: false, connected: false };
    state.start.mockReset();
    state.confirm.mockReset();
    state.disconnect.mockReset();
    state.authSession.mockReset();
  });

  afterEach(() => {
    Object.defineProperty(Platform, "OS", { value: originalOS });
  });

  it("asks for the link only while open", () => {
    const tree = render(false);
    expect(state.enabledCalls.at(-1)).toBe(false);
    act(() => tree.unmount());
  });

  it("offers Apple Calendar on iPhone, opening the webcal link", () => {
    Object.defineProperty(Platform, "OS", { value: "ios" });
    const open = vi.mocked(Linking.openURL);
    open.mockClear();
    const tree = render();
    expect(screenText(tree)).toContain("Apple Calendar");
    act(() => row(tree, "Apple Calendar").props.onPress());
    expect(open).toHaveBeenCalledWith(LINK.webcal_url);
    act(() => tree.unmount());
  });

  it("leaves Apple Calendar off Android and offers Google Calendar", () => {
    Object.defineProperty(Platform, "OS", { value: "android" });
    const tree = render();
    expect(screenText(tree)).not.toContain("Apple Calendar");
    expect(screenText(tree)).toContain("Google Calendar");
    act(() => tree.unmount());
  });

  // Google Calendar adds a calendar by link only on a computer, so the phone
  // never opens its add page: it says so and offers the link to send on.
  it("sends Google Calendar users to a computer, with the link to share", () => {
    const open = vi.mocked(Linking.openURL);
    open.mockClear();
    const alert = vi.mocked(Alert.alert);
    alert.mockClear();
    const share = vi.mocked(Share.share);
    share.mockClear();
    const tree = render();
    act(() => row(tree, "Google Calendar").props.onPress());
    expect(open).not.toHaveBeenCalled();
    expect(alert.mock.calls[0][1]).toMatch(/on a computer/);
    const buttons = alert.mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    act(() => buttons.find((b) => b.text === "Share link")?.onPress?.());
    expect(share).toHaveBeenCalledWith({ message: LINK.url });
    act(() => tree.unmount());
  });

  it("copies the https link and says so in place", async () => {
    const tree = render();
    await act(async () => {
      row(tree, "Copy link").props.onPress();
    });
    expect(state.copy).toHaveBeenCalledWith(LINK.url);
    expect(screenText(tree)).toContain("Copied");
    act(() => tree.unmount());
  });

  it("dims every row until the link arrives", () => {
    state.data = undefined;
    const tree = render();
    for (const label of ["Google Calendar", "Copy link", "Reset link"]) {
      expect(row(tree, label).props.disabled).toBe(true);
    }
    act(() => tree.unmount());
  });

  it("resets only from the confirm's destructive button", () => {
    const alert = vi.mocked(Alert.alert);
    alert.mockClear();
    state.reset.mockResolvedValue(LINK);
    const tree = render();
    act(() => row(tree, "Reset link").props.onPress());
    expect(state.reset).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as {
      text: string;
      style?: string;
      onPress?: () => void;
    }[];
    const confirm = buttons.find((b) => b.style === "destructive");
    expect(confirm?.text).toBe("Reset link");
    act(() => confirm?.onPress?.());
    expect(state.reset).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  // #3322 step 2: where the server offers it, Google connects instead.
  describe("Google Calendar", () => {
    const OFFERED = {
      available: true,
      connected: false,
      status: null,
      google_email: null,
      last_synced_at: null,
    };
    const CONNECTED = {
      ...OFFERED,
      connected: true,
      status: "active",
      google_email: "member@gmail.com",
    };

    it("signs in to Google in the system sheet and finishes the connection", async () => {
      state.google = OFFERED;
      state.data = undefined;
      state.start.mockResolvedValue("https://accounts.google.com/auth");
      state.authSession.mockResolvedValue({
        type: "success",
        url: "frapp://events?gcal=confirm&gcal_code=code-1&gcal_state=state-1",
      });
      state.confirm.mockResolvedValue(CONNECTED);
      const alert = vi.mocked(Alert.alert);
      alert.mockClear();
      const tree = render();

      // Usable before the subscription link arrives: it doesn't need it.
      expect(row(tree, "Google Calendar").props.disabled).toBe(false);
      await act(async () => {
        row(tree, "Google Calendar").props.onPress();
      });

      expect(state.start).toHaveBeenCalledWith({
        client: "mobile",
        returnUrl: "frapp://events",
      });
      expect(state.authSession).toHaveBeenCalledWith(
        "https://accounts.google.com/auth",
        "frapp://events",
      );
      expect(state.confirm).toHaveBeenCalledWith({
        code: "code-1",
        state: "state-1",
      });
      expect(alert.mock.calls.at(-1)?.[0]).toBe("Google Calendar connected");
      act(() => tree.unmount());
    });

    it("says nothing when the member cancels on Google's page", async () => {
      state.google = OFFERED;
      state.start.mockResolvedValue("https://accounts.google.com/auth");
      state.authSession.mockResolvedValue({ type: "cancel" });
      const alert = vi.mocked(Alert.alert);
      alert.mockClear();
      const tree = render();
      await act(async () => {
        row(tree, "Google Calendar").props.onPress();
      });

      expect(state.confirm).not.toHaveBeenCalled();
      expect(alert).not.toHaveBeenCalled();
      act(() => tree.unmount());
    });

    it("once connected, says so, opens Google Calendar, and offers Disconnect", () => {
      state.google = CONNECTED;
      const open = vi.mocked(Linking.openURL);
      open.mockClear();
      const alert = vi.mocked(Alert.alert);
      alert.mockClear();
      state.disconnect.mockResolvedValue(undefined);
      const tree = render();

      expect(screenText(tree)).toContain("connected as member@gmail.com");
      act(() => row(tree, "Google Calendar, Connected").props.onPress());
      expect(open).toHaveBeenCalledWith("https://calendar.google.com/calendar/r");

      act(() => row(tree, "Disconnect Google Calendar").props.onPress());
      expect(state.disconnect).not.toHaveBeenCalled();
      const buttons = alert.mock.calls.at(-1)?.[2] as {
        text: string;
        onPress?: () => void;
      }[];
      act(() => buttons.find((b) => b.text === "Disconnect")?.onPress?.());
      expect(state.disconnect).toHaveBeenCalledTimes(1);
      act(() => tree.unmount());
    });

    it("asks to reconnect once Google refused the sign-in", () => {
      state.google = { ...CONNECTED, status: "needs_reconnect" };
      const tree = render();

      expect(row(tree, "Google Calendar, Reconnect")).toBeTruthy();
      act(() => tree.unmount());
    });
  });
});
