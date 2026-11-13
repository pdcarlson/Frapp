/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { createFrappClient } from "@repo/api-sdk";
import {
  CHECK_IN_CODES_UNCONFIGURED_MESSAGE,
  FrappClientProvider,
} from "@repo/hooks";
import { FrappThemeProvider } from "@/lib/theme";
import { stackScreen } from "@/test/stack-screen";
import { screenText, textHeadings } from "@/test/screen-text";

/**
 * s22's title (#2485), rendered.
 *
 * The tab navigator's header used to name this screen, and its title was the
 * heading a screen reader found. No screen has that header now, so the title
 * the screen draws itself has to be the heading. It renders
 * `app/(app)/host-check-in.tsx` but lives here: a spec under `app/` ships as
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
  /**
   * The real `useMintCheckInToken`, on the client `renderWithClient`
   * provides, in place of `token`. Set for the life of one tree.
   */
  realMint: false,
  /** What `useCheckInScreenReport` answers, and what it was asked. */
  presence: { kind: "none" } as Record<string, unknown>,
  reportCalls: [] as unknown[][],
}));

vi.mock("@/lib/events/check-in-screen-report", () => ({
  useCheckInScreenReport: (eventId: string, active: boolean) => {
    hooks.reportCalls.push([eventId, active]);
    return hooks.presence;
  },
}));

vi.mock("@repo/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/hooks")>();
  return {
    ...actual,
    usePermissionList: () => ["*"],
    useEvent: () => ({ data: hooks.event }),
    useMintCheckInToken: (eventId: string, enabled?: boolean) => {
      hooks.mintCalls.push([eventId, enabled]);
      return hooks.realMint
        ? actual.useMintCheckInToken(eventId, enabled)
        : hooks.token;
    },
    useAttendance: (...args: unknown[]) => {
      hooks.attendanceCalls.push(args);
      return { data: hooks.attendance };
    },
  };
});

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

vi.mock("react-native-qrcode-svg", () => ({ default: "QRCode" }));

import HostCheckInScreen from "@/app/(app)/host-check-in";

const { __refocus: refocus, __blur: blur } = expoRouter as unknown as {
  __refocus: () => void;
  __blur: () => void;
};

/** How long the server says the code has left in its window when minted. */
const ROTATES_IN_MS = 20_000;

/**
 * How long after it was asked for a code may be drawn as live: its rotation,
 * one more window, less the time a member needs to scan it.
 */
const LIVE_FOR_MS = ROTATES_IN_MS + 30_000 - 10_000;

/**
 * The phone's two clocks, as the screen reads them (`deviceNow` in
 * `@repo/hooks`): `performance.now()` and `Date.now()`, which the specs move
 * together or apart.
 */
const clock = { monotonic: 0, wall: 0 };
/** Time passes, on both clocks. */
const advance = (ms: number) => {
  clock.monotonic += ms;
  clock.wall += ms;
};

/**
 * The mint hook's result for a request that started `ago` ms ago on both of
 * the phone's clocks (`useMintCheckInToken`).
 */
function mintedAgo(
  ago: number,
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
      requestedAt: { monotonic: clock.monotonic - ago, wall: clock.wall - ago },
    },
    error: null,
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
}

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

/** The screen on the real `useMintCheckInToken` (`hooks.realMint`). */
function renderWithClient(
  client: unknown,
  queryClient: QueryClient,
): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappClientProvider
        client={client as ReturnType<typeof createFrappClient>}
      >
        <QueryClientProvider client={queryClient}>
          <FrappThemeProvider>
            <HostCheckInScreen />
          </FrappThemeProvider>
        </QueryClientProvider>
      </FrappClientProvider>,
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

describe("Host check-in while the room fills", () => {
  let clockSpies: { mockRestore: () => void }[] = [];
  beforeEach(() => {
    clock.monotonic = 5_000_000;
    clock.wall = Date.parse("2026-11-05T19:00:00Z");
    clockSpies = [
      vi.spyOn(performance, "now").mockImplementation(() => clock.monotonic),
      vi.spyOn(Date, "now").mockImplementation(() => clock.wall),
    ];
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    hooks.event = EVENT;
    hooks.token = mintedAgo(0);
    hooks.attendance = [
      { status: "PRESENT" },
      { status: "LATE" },
      { status: "ABSENT" },
    ];
    hooks.mintCalls = [];
    hooks.attendanceCalls = [];
    hooks.presence = { kind: "none" };
    hooks.reportCalls = [];
  });
  afterEach(() => {
    for (const spy of clockSpies) spy.mockRestore();
  });

  describe("as the check-in zone (#4532)", () => {
    const presenceText = (tree: ReactTestRenderer) =>
      tree.root.findAllByProps({ testID: "check-in-presence" });

    it("reports where it is only while a code is drawn", () => {
      const tree = render();
      expect(lastCall(hooks.reportCalls)).toEqual(["evt-1", true]);

      // No code (it failed and nothing still redeems): no report, so the
      // code isn't made required while members can't get one.
      hooks.token = {
        data: undefined,
        error: new Error("boom"),
        isError: true,
        isPending: false,
        isFetching: false,
        refetch: vi.fn(),
      };
      act(() =>
        tree.update(
          <FrappThemeProvider>
            <HostCheckInScreen />
          </FrappThemeProvider>,
        ),
      );
      expect(lastCall(hooks.reportCalls)).toEqual(["evt-1", false]);

      act(() => blur());
      expect(lastCall(hooks.reportCalls)).toEqual(["evt-1", false]);
      act(() => refocus());
      act(() => tree.unmount());
    });

    it("tells the officer members are checked against this phone", () => {
      hooks.presence = { kind: "screen" };
      const tree = render();
      expect(screenText(tree)).toContain(
        "Members check in within about 100 yards of this phone.",
      );
      act(() => tree.unmount());
    });

    it("tells the officer another officer's screen is the check when this phone has no fix", () => {
      hooks.presence = { kind: "elsewhere" };
      const tree = render();
      expect(screenText(tree)).toContain(
        "Members check in near another officer's screen. This phone can't tell where it is.",
      );
      act(() => tree.unmount());
    });

    it("says distance isn't checked, with a way to Settings once the OS won't ask", () => {
      hooks.presence = {
        kind: "off",
        reason: "permission",
        canAskAgain: false,
      };
      const tree = render();
      expect(screenText(tree)).toContain(
        "Distance isn't checked. Allow location for Frapp to check it.",
      );
      expect(screenText(tree)).toContain("Open Settings");

      hooks.presence = { kind: "off", reason: "imprecise" };
      act(() =>
        tree.update(
          <FrappThemeProvider>
            <HostCheckInScreen />
          </FrappThemeProvider>,
        ),
      );
      expect(screenText(tree)).toContain(
        "Distance isn't checked. This phone can't tell where it is.",
      );
      expect(screenText(tree)).not.toContain("Open Settings");
      act(() => tree.unmount());
    });

    it("says nothing for a drawn zone or before check-in opens", () => {
      const tree = render();
      expect(presenceText(tree)).toHaveLength(0);
      act(() => tree.unmount());
    });
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

    // The screen can stay mounted while the officer is elsewhere; nothing
    // should poll.
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
        body.props.onLayout({
          nativeEvent: { layout: { width, height: 700 } },
        }),
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
    hooks.token = { ...mintedAgo(5 * 60_000), isFetching: true };
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
    hooks.token = mintedAgo(0);
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
    advance(2 * 60_000);
    act(() => refocus());
    expect(tree.root.findAllByType("QRCode" as never)).toHaveLength(0);
    act(() => tree.unmount());
  });

  describe("on the phone's own clocks", () => {
    const qrCount = (tree: ReactTestRenderer) =>
      tree.root.findAllByType("QRCode" as never).length;
    /** How many of the countdown row's dots are drawn in that state. */
    const dots = (tree: ReactTestRenderer, state: "live" | "waiting") =>
      tree.root.findAllByProps({ testID: `rotates-dot-${state}` }).length;

    it("draws a code that will still redeem for a scan, and not one that won't", () => {
      // The server keeps accepting a code for a window after it rotates, but a
      // member still has to scan it, get a fix and post.
      hooks.token = mintedAgo(LIVE_FOR_MS - 1);
      const inside = render();
      expect(qrCount(inside)).toBe(1);
      act(() => inside.unmount());

      hooks.token = mintedAgo(LIVE_FOR_MS);
      const past = render();
      expect(qrCount(past)).toBe(0);
      act(() => past.unmount());
    });

    it("keeps drawing a code past its rotation while the next is on its way", () => {
      // 5s past the rotation: still 15s of redeeming left, so the screen
      // doesn't blank between rotations.
      hooks.token = { ...mintedAgo(ROTATES_IN_MS + 5_000), isFetching: true };
      const tree = render();
      expect(qrCount(tree)).toBe(1);
      // Nothing left to count down: the row says the next code is coming, not
      // a frozen "Rotates in 0:00" beside a live dot.
      const text = screenText(tree);
      expect(text).toContain("Getting a new code");
      expect(text).not.toContain("Rotates in");
      expect(dots(tree, "waiting")).toBeGreaterThan(0);
      expect(dots(tree, "live")).toBe(0);
      act(() => tree.unmount());
    });

    it("counts down with a live dot until the rotation", () => {
      hooks.token = mintedAgo(ROTATES_IN_MS - 1_000);
      const tree = render();
      expect(screenText(tree)).toContain("Rotates in");
      expect(screenText(tree)).not.toContain("Getting a new code");
      expect(dots(tree, "live")).toBeGreaterThan(0);
      act(() => tree.unmount());
    });

    it("counts down from when it asked, whatever the phone's clock says the server's time is", () => {
      // `expiresAt` is the server's clock. A phone 45s fast would read it as
      // long gone; one far slow, as hours away. Neither moves the countdown.
      for (const expiresAt of [
        "2000-01-01T00:00:00Z",
        "2099-01-01T00:00:00Z",
      ]) {
        hooks.token = mintedAgo(0, { expiresAt });
        const tree = render();
        expect(screenText(tree)).toContain("0:20");
        act(() => tree.unmount());
      }
    });

    it("blanks a code that ran out while the officer was away, until the new one lands", () => {
      const tree = render();
      expect(qrCount(tree)).toBe(1);

      act(() => blur());
      advance(LIVE_FOR_MS);
      act(() => refocus());
      expect(qrCount(tree)).toBe(0);
      expect(screenText(tree)).not.toContain("Rotates in");

      hooks.token = mintedAgo(0);
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

    describe("while the screen is up", () => {
      // Only the screen's half-second tick is faked; the clocks are the
      // spies above.
      beforeEach(() => {
        vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      });
      afterEach(() => {
        vi.useRealTimers();
      });
      const tick = () => act(() => vi.advanceTimersByTime(500));

      it("keeps its countdown and its bound when the wall clock steps back", () => {
        // A network time correction or a manual change. Judged on the wall
        // clock alone, the code would read two minutes younger: drawn live,
        // and counting down, long after the server stopped taking it.
        const tree = render();
        advance(15_000);
        clock.wall -= 2 * 60_000;
        tick();
        expect(qrCount(tree)).toBe(1);
        expect(screenText(tree)).toContain("0:05");

        advance(LIVE_FOR_MS - 15_000);
        tick();
        expect(qrCount(tree)).toBe(0);
        act(() => tree.unmount());
      });

      it("keeps a code that still redeems on screen through failed refetches, then says it didn't load", () => {
        // The rotation refetch failed, and the one 10s later too. TanStack
        // keeps the last code beside the error, and members can still redeem
        // it, so swapping it for "Code unavailable" would leave the door with
        // nothing to scan for the rest of its window.
        hooks.token = {
          ...mintedAgo(ROTATES_IN_MS + 10_500),
          error: { statusCode: 502 },
          isError: true,
        };
        const tree = render();
        expect(qrCount(tree)).toBe(1);
        expect(screenText(tree)).toContain("4KQ-88");
        expect(screenText(tree)).not.toContain("Code unavailable");
        // Past its rotation, with the next one failed: the row says so, and
        // that this code still works, instead of a frozen countdown.
        expect(screenText(tree)).toContain(
          "New code didn't load. This one still works.",
        );
        expect(screenText(tree)).not.toContain("Rotates in");
        expect(dots(tree, "waiting")).toBeGreaterThan(0);

        // Past its bound, with the requests still failing: no live code, so
        // the error card, with its retry.
        advance(LIVE_FOR_MS - (ROTATES_IN_MS + 10_500));
        tick();
        expect(qrCount(tree)).toBe(0);
        const text = screenText(tree);
        expect(text).not.toContain("4KQ-88");
        expect(text).toContain("Code unavailable");
        expect(text).toContain("didn't load");
        expect(
          tree.root.findAll(
            (node) => node.props.accessibilityLabel === "Try again",
          ),
        ).not.toHaveLength(0);
        act(() => tree.unmount());
      });

      it("blanks the code it showed before the phone slept", () => {
        // Android's monotonic clock stops while the phone sleeps; the wall
        // clock doesn't. Judged on the monotonic clock alone, a code that
        // died while the screen was off would be drawn live on waking.
        const tree = render();
        clock.wall += 2 * 60_000;
        tick();
        expect(qrCount(tree)).toBe(0);
        expect(screenText(tree)).not.toContain("Rotates in");
        act(() => tree.unmount());
      });
    });
  });

  it("ends to More, where its one row opened it", () => {
    vi.mocked(vi.mocked(expoRouter.useRouter)().dismissTo).mockClear();
    const tree = render();
    const end = tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) &&
        node.props.accessibilityLabel === "End hosting and go back",
    );
    // The app's glass close (#3703), not the bare "✕ End" it replaced, which
    // carried the same label.
    expect(end.props.testID).toBe("glass-close");
    act(() => end.props.onPress());
    // Nothing is under the screen in this spec (no stack), so it falls back
    // to More; on a device it pops to where the officer started.
    expect(vi.mocked(expoRouter.useRouter)().dismissTo).toHaveBeenCalledWith(
      "/you",
    );
    act(() => tree.unmount());
  });

  it("ends by popping to the screen it was opened from, as the swipe does", () => {
    vi.mocked(vi.mocked(expoRouter.useRouter)().dismissTo).mockClear();
    const { element, navigation } = stackScreen(
      [{ name: "(tabs)" }, { name: "event-details" }],
      <FrappThemeProvider>
        <HostCheckInScreen />
      </FrappThemeProvider>,
    );
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(element);
    });
    const end = tree.root.find(
      (node) =>
        node.type === ("Pressable" as never) &&
        node.props.accessibilityLabel === "End hosting and go back",
    );
    act(() => end.props.onPress());
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    expect(vi.mocked(expoRouter.useRouter)().dismissTo).not.toHaveBeenCalled();
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

    // An intermediary's bare 503 is transient too.
    hooks.token = { ...hooks.token, error: { statusCode: 503 } };
    const unavailable = render();
    expect(screenText(unavailable)).toContain("didn't load");
    expect(
      unavailable.root.findAll(
        (node) => node.props.accessibilityLabel === "Try again",
      ),
    ).not.toHaveLength(0);
    act(() => unavailable.unmount());

    hooks.token = {
      ...hooks.token,
      error: { statusCode: 503, message: CHECK_IN_CODES_UNCONFIGURED_MESSAGE },
    };
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

/**
 * What the screen draws from the real `useMintCheckInToken`. An edge's
 * empty-bodied 5xx is `error: undefined` or `""` to openapi-fetch 0.17: read
 * as a success, a rotation refetch's would replace a code that still redeems
 * with an answer that has no code in it.
 */
describe("Host check-in on the real code request", () => {
  const TOKEN_KEY = ["attendance", "evt-1", "check-in-token"];
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
      eventId: "evt-1",
    });
    hooks.event = EVENT;
    hooks.attendance = [];
    hooks.realMint = true;
    queryClient = new QueryClient();
  });
  afterEach(() => {
    hooks.realMint = false;
    queryClient.clear();
  });

  const MINT = {
    data: {
      qrPayload: "https://app.frapp.live/check-in?event=evt-1&t=signed",
      manualCode: "4KQ-88",
      expiresAt: "2099-01-01T00:00:00Z",
      rotatesInMs: ROTATES_IN_MS,
    },
    error: undefined,
    response: new Response(null, { status: 200 }),
  };
  const emptyBodied = (error: undefined | "") => ({
    data: undefined,
    error,
    response: new Response(null, { status: 502 }),
  });
  /** Lets the request in flight answer, and the screen draw it. */
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

  it("keeps the code on screen when a refetch gets an empty-bodied 5xx", async () => {
    for (const error of [undefined, ""] as const) {
      queryClient.clear();
      const get = vi
        .fn()
        .mockResolvedValueOnce(MINT)
        .mockResolvedValue(emptyBodied(error));
      const tree = renderWithClient({ GET: get }, queryClient);
      try {
        await settle();
        expect(tree.root.findAllByType("QRCode" as never)).toHaveLength(1);

        await act(async () => {
          await queryClient.refetchQueries({ queryKey: TOKEN_KEY });
        });
        await settle();
        expect(get).toHaveBeenCalledTimes(2);
        expect(queryClient.getQueryState(TOKEN_KEY)?.status).toBe("error");
        expect(tree.root.findAllByType("QRCode" as never)).toHaveLength(1);
        const text = screenText(tree);
        expect(text).toContain("4KQ-88");
        expect(text).not.toContain("Code unavailable");
      } finally {
        act(() => tree.unmount());
      }
    }
  });

  it("says the code didn't load, with a retry, when the first request gets one", async () => {
    const get = vi.fn().mockResolvedValue(emptyBodied(undefined));
    const tree = renderWithClient({ GET: get }, queryClient);
    try {
      await settle();
      expect(queryClient.getQueryState(TOKEN_KEY)?.status).toBe("error");
      const text = screenText(tree);
      expect(text).toContain("didn't load");
      expect(text).not.toContain("aren't set up");
      expect(
        tree.root.findAll(
          (node) => node.props.accessibilityLabel === "Try again",
        ),
      ).not.toHaveLength(0);
    } finally {
      act(() => tree.unmount());
    }
  });
});
