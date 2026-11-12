import React from "react";
import { act } from "react";
import { Alert, Platform } from "react-native";
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
    const open = vi.mocked(Linking.openURL);
    open.mockClear();
    const tree = render();
    expect(screenText(tree)).not.toContain("Apple Calendar");
    act(() => row(tree, "Google Calendar").props.onPress());
    const google = new URL(open.mock.calls[0][0]);
    expect(google.searchParams.get("cid")).toBe(LINK.webcal_url);
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
});
