/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText, textHeadings } from "@/test/screen-text";

/**
 * s22's title (#2485), rendered.
 *
 * The tab navigator's header used to name this screen, and its title was the
 * heading a screen reader found. No screen has that header now, so the title
 * the screen draws itself has to be the heading. It renders
 * `app/(tabs)/host-check-in.tsx` but lives here: a spec under `app/` ships as
 * a route module (`lib/routes.spec.ts`).
 */

const EVENT = {
  id: "evt-1",
  name: "Chapter Meeting",
  location: null,
  start_time: "2026-09-25T18:00:00Z",
  end_time: "2026-09-25T19:00:00Z",
  point_value: 10,
  is_mandatory: false,
  check_in_zone: [],
};

const hooks = vi.hoisted(() => ({
  event: null as unknown,
  token: { data: undefined, error: null } as Record<string, unknown>,
  attendance: [] as unknown,
  mintCalls: [] as unknown[][],
  attendanceCalls: [] as unknown[][],
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  usePermissionList: () => ["*"],
  useEvent: () => ({ data: hooks.event }),
  useMintCheckInToken: (...args: unknown[]) => {
    hooks.mintCalls.push(args);
    return hooks.token;
  },
  useAttendance: (...args: unknown[]) => {
    hooks.attendanceCalls.push(args);
    return { data: hooks.attendance };
  },
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

vi.mock("react-native-qrcode-svg", () => ({ default: "QRCode" }));

import HostCheckInScreen from "@/app/(tabs)/host-check-in";

const { __refocus: refocus, __blur: blur } = expoRouter as unknown as {
  __refocus: () => void;
  __blur: () => void;
};

const MINTED = {
  data: {
    qrPayload: "frapp://check-in?e=evt-1&t=signed",
    manualCode: "4KQ-88",
    expiresAt: "2099-01-01T00:00:00Z",
  },
  // Just landed. Set per test, since how long ago decides whether it draws.
  dataUpdatedAt: 0,
  error: null,
  isPending: false,
  isError: false,
  isFetching: false,
  refetch: vi.fn(),
};

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <HostCheckInScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

function headings(tree: ReactTestRenderer): unknown[] {
  return textHeadings(tree).map((node) => node.props.children);
}

describe("Host check-in's title (#2485)", () => {
  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    hooks.event = EVENT;
    hooks.token = { data: undefined, error: null };
  });

  it("is the screen's heading, and names the event it hosts", () => {
    expect(headings(render())).toEqual(["Chapter Meeting"]);
  });

  it("still gives the screen a heading before the event has loaded", () => {
    hooks.event = undefined;
    expect(headings(render())).toEqual(["Host check-in"]);
  });
});

describe("Host check-in while the room fills (2026-11 polish, #20)", () => {
  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    hooks.event = EVENT;
    hooks.token = { ...MINTED, dataUpdatedAt: Date.now() };
    hooks.attendance = [
      { status: "PRESENT" },
      { status: "LATE" },
      { status: "ABSENT" },
    ];
    hooks.mintCalls = [];
    hooks.attendanceCalls = [];
  });

  const lastCall = (calls: unknown[][]) => calls[calls.length - 1];

  it("re-reads the count every 10 seconds while it is on screen, and stops when it isn't", () => {
    // Nothing pushes another member's check-in here, so without the poll the
    // count stayed at its value from when the screen opened.
    const tree = render();
    expect(lastCall(hooks.attendanceCalls)).toEqual([
      "evt-1",
      { refetchInterval: 10_000 },
    ]);
    expect(lastCall(hooks.mintCalls)).toEqual(["evt-1", true]);

    // The tab stays mounted once the officer leaves; nothing should poll.
    act(() => blur());
    expect(lastCall(hooks.attendanceCalls)).toEqual([
      "evt-1",
      { refetchInterval: false },
    ]);
    expect(lastCall(hooks.mintCalls)).toEqual(["evt-1", false]);

    act(() => refocus());
    expect(lastCall(hooks.attendanceCalls)).toEqual([
      "evt-1",
      { refetchInterval: 10_000 },
    ]);
    act(() => tree.unmount());
  });

  it("draws the count of members who are there, and the code members type", () => {
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("2\n checked in");
    expect(text).toContain("4KQ-88");
    act(() => tree.unmount());
  });

  it("sizes the code to the screen, within its bounds", () => {
    const tree = render();
    const qr = () => tree.root.findByType("QRCode" as never);
    const body = tree.root.find(
      (node) =>
        node.type === ("View" as never) &&
        typeof node.props.onLayout === "function",
    );
    const layout = (width: number) =>
      act(() =>
        body.props.onLayout({ nativeEvent: { layout: { width, height: 700 } } }),
      );

    // 402 wide, less the body's 32 and the card's 16 on each side.
    layout(402);
    expect(qr().props.size).toBe(306);
    // A tablet: past the cap the code only gets coarser.
    layout(1024);
    expect(qr().props.size).toBe(340);
    act(() => tree.unmount());
  });

  it("draws a code left from an earlier visit as loading, not live, until the new one lands", () => {
    // The poll stops while the screen is out of sight, so a code cached then
    // can be minutes old on the way back. Drawn at once with its live dot, a
    // member scanning it would be refused.
    hooks.token = {
      ...MINTED,
      dataUpdatedAt: Date.now() - 5 * 60_000,
      isFetching: true,
    };
    const tree = render();
    expect(tree.root.findAllByType("QRCode" as never)).toHaveLength(0);
    const text = screenText(tree);
    expect(text).not.toContain("Rotates in");
    expect(text).not.toContain("4KQ-88");
    expect(
      tree.root.findAll(
        (node) =>
          node.type === ("View" as never) &&
          node.props.accessibilityRole === "progressbar",
      ),
    ).toHaveLength(1);

    // The refetch focus started lands.
    hooks.token = { ...MINTED, dataUpdatedAt: Date.now() };
    act(() =>
      tree.update(
        <FrappThemeProvider>
          <HostCheckInScreen />
        </FrappThemeProvider>,
      ),
    );
    expect(tree.root.findAllByType("QRCode" as never)).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("judges the cached code against the time the officer came back, not when they left", () => {
    const tree = render();
    expect(tree.root.findAllByType("QRCode" as never)).toHaveLength(1);

    act(() => blur());
    const later = Date.now() + 2 * 60_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(later);
    try {
      act(() => refocus());
      expect(tree.root.findAllByType("QRCode" as never)).toHaveLength(0);
    } finally {
      clock.mockRestore();
    }
    act(() => tree.unmount());
  });

  it("keeps drawing a code the poll just replaced, which still redeems", () => {
    // A code past its countdown redeems for one more window, and the 10s poll
    // lands inside it, so the screen must not blank between rotations.
    hooks.token = {
      ...MINTED,
      data: { ...MINTED.data, expiresAt: "2000-01-01T00:00:00Z" },
      dataUpdatedAt: Date.now() - 9_000,
    };
    const tree = render();
    expect(tree.root.findAllByType("QRCode" as never)).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("ends to More, where its one row opened it", () => {
    vi.mocked(vi.mocked(expoRouter.useRouter)().navigate).mockClear();
    const tree = render();
    const end = tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) &&
        node.props.accessibilityLabel === "End hosting and go back",
    );
    act(() => end.props.onPress());
    // Not `back()`: a hidden tab's history lands on Chat home.
    expect(vi.mocked(expoRouter.useRouter)().navigate).toHaveBeenCalledWith(
      "/more",
    );
    act(() => tree.unmount());
  });

  it("offers a retry for a code that didn't load, but not for one that can't", () => {
    hooks.token = {
      data: undefined,
      error: { statusCode: 502 },
      isPending: false,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    };
    const transient = render();
    expect(
      transient.root.findAll(
        (node) => node.props.accessibilityLabel === "Try again",
      ),
    ).not.toHaveLength(0);
    act(() => transient.unmount());

    hooks.token = { ...hooks.token, error: { statusCode: 503 } };
    const unconfigured = render();
    expect(screenText(unconfigured)).toContain("aren't set up");
    expect(
      unconfigured.root.findAll(
        (node) => node.props.accessibilityLabel === "Try again",
      ),
    ).toHaveLength(0);
    act(() => unconfigured.unmount());
  });
});
