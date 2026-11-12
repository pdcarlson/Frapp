/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as expoRouter from "expo-router";
import type { RecorderState } from "@/lib/minutes/recorder/machine";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * The recording indicator over every screen: while the phone records, it
 * says so wherever the officer is, and a tap goes back to the controls.
 */
const session = vi.hoisted(() => ({
  state: { phase: "idle", refusal: null } as unknown,
}));
vi.mock("@/lib/minutes/recorder/session", () => ({
  useMeetingRecorder: () => ({ state: session.state, recorder: null }),
}));
const connection = vi.hoisted(() => ({ state: "ONLINE" }));
vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ state: connection.state }),
}));

import { RecordingBar } from "./recording-bar";

const subject = { meetingId: "m1", eventName: "Chapter meeting", maxSeconds: 7200 };
const RECORDING: RecorderState = {
  phase: "recording",
  subject,
  seconds: 3723,
  paused: null,
};

function render(state: RecorderState): ReactTestRenderer {
  session.state = state;
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <RecordingBar />
      </FrappThemeProvider>,
    );
  });
  return tree;
}
const pill = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "Pressable")[0];
const topOf = (tree: ReactTestRenderer) =>
  ([tree.root.findAllByType("View" as never)[0]?.props.style].flat(Infinity) as {
    top?: number;
  }[]).find((style) => style?.top !== undefined)?.top;

beforeEach(() => {
  vi.clearAllMocks();
  connection.state = "ONLINE";
  vi.mocked(expoRouter.usePathname).mockReturnValue("/chat");
  vi.mocked(expoRouter.useGlobalSearchParams).mockReturnValue({});
});

describe("RecordingBar", () => {
  it("is absent when the phone holds no recording", () => {
    expect(render({ phase: "idle", refusal: null }).toJSON()).toBeNull();
  });

  it("says Recording with the running clock on every other screen", () => {
    const tree = render(RECORDING);
    expect(screenText(tree)).toBe("Recording 1:02:03");
    expect(pill(tree).props.accessibilityLabel).toBe("Recording Chapter meeting");
  });

  it("says Paused when a call took the microphone", () => {
    const tree = render({ ...RECORDING, paused: "interrupted" } as RecorderState);
    expect(screenText(tree)).toBe("Paused 1:02:03");
  });

  it("opens the meeting's minutes on a tap", () => {
    const tree = render(RECORDING);
    act(() => pill(tree).props.onPress());
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/minutes-details",
      params: { id: "m1" },
    });
  });

  it("steps aside on that meeting's own minutes, where the row says it", () => {
    vi.mocked(expoRouter.usePathname).mockReturnValue("/minutes-details");
    vi.mocked(expoRouter.useGlobalSearchParams).mockReturnValue({ id: "m1" });
    expect(render(RECORDING).toJSON()).toBeNull();
    // Another meeting's minutes still show it.
    vi.mocked(expoRouter.useGlobalSearchParams).mockReturnValue({ id: "m2" });
    expect(render(RECORDING).toJSON()).not.toBeNull();
  });

  it("stays up while a finished recording hasn't reached the server", () => {
    const tree = render({
      phase: "kept",
      subject,
      seconds: 3600,
      bytes: 1,
      reason: "upload_failed",
      message: null,
    });
    expect(screenText(tree)).toBe("Recording not uploaded");
  });

  it("sits under the connection pill when both have something to say", () => {
    const alone = topOf(render(RECORDING)) ?? 0;
    connection.state = "OFFLINE";
    expect(topOf(render(RECORDING))).toBeGreaterThan(alone);
  });
});
