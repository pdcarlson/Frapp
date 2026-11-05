/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/** How long the server says the code has left in its window when minted. */
const ROTATES_IN_MS = 20_000;

/**
 * The mint hook's result for a request that started at `requestedAt` on the
 * phone's clock (`useMintCheckInToken`).
 */
function mintedAt(
  requestedAt: number,
  response: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    data: {
      response: {
        qrPayload: "frapp://check-in?e=evt-1&t=signed",
        manualCode: "4KQ-88",
        expiresAt: "2099-01-01T00:00:00Z",
        rotatesInMs: ROTATES_IN_MS,
        ...response,
      },
      requestedAt,
    },
    error: null,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
}

/**
 * The last moment a code asked for at `requestedAt` may be drawn as live:
 * its rotation, one more window, less the time a member needs to scan it.
 */
const liveUntil = (requestedAt: number) =>
  requestedAt + ROTATES_IN_MS + 30_000 - 10_000;

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
    hooks.token = mintedAt(Date.now());
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
    hooks.token = { ...mintedAt(Date.now() - 5 * 60_000), isFetching: true };
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
    hooks.token = mintedAt(Date.now());
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

  describe("on the phone's own clock", () => {
    const NOW = Date.parse("2026-11-05T19:00:00Z");
    let clock: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      clock = vi.spyOn(Date, "now").mockReturnValue(NOW);
    });
    afterEach(() => clock.mockRestore());

    const qrCount = (tree: ReactTestRenderer) =>
      tree.root.findAllByType("QRCode" as never).length;

    it("draws a code that will still redeem for a scan, and not one that won't", () => {
      // The server keeps accepting a code for a window after it rotates, but a
      // member still has to scan it, get a fix and post.
      hooks.token = mintedAt(NOW - liveUntil(0) + 1);
      const inside = render();
      expect(qrCount(inside)).toBe(1);
      act(() => inside.unmount());

      hooks.token = mintedAt(NOW - liveUntil(0));
      const past = render();
      expect(qrCount(past)).toBe(0);
      act(() => past.unmount());
    });

    it("keeps drawing a code past its rotation while the next is on its way", () => {
      // 5s past the rotation: still 15s of redeeming left, so the screen
      // doesn't blank between rotations.
      hooks.token = { ...mintedAt(NOW - ROTATES_IN_MS - 5_000), isFetching: true };
      const tree = render();
      expect(qrCount(tree)).toBe(1);
      expect(screenText(tree)).toContain("0:00");
      act(() => tree.unmount());
    });

    it("counts down from when it asked, whatever the phone's clock says the server's time is", () => {
      // `expiresAt` is the server's clock. A phone 45s fast would read it as
      // long gone; one far slow, as hours away. Neither moves the countdown.
      for (const expiresAt of ["2000-01-01T00:00:00Z", "2099-01-01T00:00:00Z"]) {
        hooks.token = mintedAt(NOW, { expiresAt });
        const tree = render();
        expect(screenText(tree)).toContain("0:20");
        act(() => tree.unmount());
      }
    });

    it("blanks a code that ran out while the officer was away, until the new one lands", () => {
      hooks.token = mintedAt(NOW);
      const tree = render();
      expect(qrCount(tree)).toBe(1);

      act(() => blur());
      clock.mockReturnValue(liveUntil(NOW));
      act(() => refocus());
      expect(qrCount(tree)).toBe(0);
      expect(screenText(tree)).not.toContain("Rotates in");

      hooks.token = mintedAt(liveUntil(NOW));
      act(() =>
        tree.update(
          <FrappThemeProvider>
            <HostCheckInScreen />
          </FrappThemeProvider>,
        ),
      );
      expect(qrCount(tree)).toBe(1);
      expect(screenText(tree)).toContain("0:20");
      act(() => tree.unmount());
    });
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
