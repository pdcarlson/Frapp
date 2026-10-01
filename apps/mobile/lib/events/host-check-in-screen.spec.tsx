/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import { FrappThemeProvider } from "@/lib/theme";
import { textHeadings } from "@/test/screen-text";

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

const hooks = vi.hoisted(() => ({ event: null as unknown }));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  usePermissionList: () => ["*"],
  useEvent: () => ({ data: hooks.event }),
  useMintCheckInToken: () => ({ data: undefined, error: null }),
  useAttendance: () => ({ data: [] }),
}));

vi.mock("react-native-qrcode-svg", () => ({ default: "QRCode" }));

import HostCheckInScreen from "@/app/(tabs)/host-check-in";

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
  });

  it("is the screen's heading, and names the event it hosts", () => {
    expect(headings(render())).toEqual(["Chapter Meeting"]);
  });

  it("still gives the screen a heading before the event has loaded", () => {
    hooks.event = undefined;
    expect(headings(render())).toEqual(["Host check-in"]);
  });
});
