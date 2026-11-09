/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * #3845, PR 3: the phone's status sheet. A pick saves the same body web's
 * menu sends, DND's default comes first, and the custom line keeps web's
 * rules (Today by default, 80 characters, one line).
 */

const mutateAsync = vi.fn();
const state: {
  settings: Record<string, unknown> | undefined;
  writeBlockedReason: string | null;
} = { settings: undefined, writeBlockedReason: null };

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useUserSettings: () => ({ data: state.settings }),
  useUpdateUserSettings: () => ({ mutateAsync, isPending: false }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: state.writeBlockedReason }),
}));

import { StatusSheet } from "./status-sheet";

const dismiss = vi.fn();
const mounted: ReactTestRenderer[] = [];

const ONLINE = {
  status: "online",
  status_expires_at: null,
  custom_status: null,
  custom_status_expires_at: null,
};

function render(): ReactTestRenderer {
  const ref = React.createRef<never>();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <StatusSheet ref={ref} />
      </FrappThemeProvider>,
      {
        createNodeMock: (element) =>
          (element.type as unknown) === "BottomSheetModal"
            ? { dismiss, present: vi.fn() }
            : null,
      },
    );
  });
  mounted.push(tree);
  return tree;
}

const byTestId = (tree: ReactTestRenderer, id: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" && node.props.testID === id,
  );

function press(tree: ReactTestRenderer, id: string) {
  act(() => {
    byTestId(tree, id).props.onPress();
  });
}

const pressableWithText = (tree: ReactTestRenderer, text: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      screenText({ root: node } as unknown as ReactTestRenderer) === text,
  );

beforeEach(() => {
  mutateAsync.mockReset();
  mutateAsync.mockResolvedValue({});
  dismiss.mockReset();
  state.settings = ONLINE;
  state.writeBlockedReason = null;
});

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

describe("StatusSheet", () => {
  it("lists the four statuses, the current one checked", () => {
    const tree = render();
    const text = screenText(tree);
    for (const label of ["Online", "Idle", "Do Not Disturb", "Invisible"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("You'll appear offline");
    expect(byTestId(tree, "status-online").props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
  });

  it("saves Invisible with no end time and closes", () => {
    const tree = render();
    press(tree, "status-invisible");
    expect(mutateAsync).toHaveBeenCalledWith({
      status: "invisible",
      status_expires_at: null,
    });
    expect(dismiss).toHaveBeenCalled();
  });

  it("opens DND's durations with Until I turn it off first", () => {
    const tree = render();
    press(tree, "status-dnd");
    const text = screenText(tree);
    const order = [
      "Until I turn it off",
      "For 1 hour",
      "For 8 hours",
      "Until tomorrow",
    ].map((label) => text.indexOf(label));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    press(tree, "dnd-off");
    expect(mutateAsync).toHaveBeenCalledWith({
      status: "dnd",
      status_expires_at: null,
    });
  });

  it("sends DND for 1 hour as an end time an hour out", () => {
    const tree = render();
    press(tree, "status-dnd");
    const before = Date.now();
    press(tree, "dnd-1h");
    const body = mutateAsync.mock.calls[0]![0];
    expect(body.status).toBe("dnd");
    const end = Date.parse(body.status_expires_at);
    expect(end - before).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
    expect(end - before).toBeLessThanOrEqual(60 * 60 * 1000 + 1000);
  });

  it("shows DND's end under it while it runs", () => {
    state.settings = {
      ...ONLINE,
      status: "dnd",
      status_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    };
    const tree = render();
    expect(screenText(tree)).toMatch(/Until \d/);
  });

  it("saves a custom line that clears today by default", async () => {
    const tree = render();
    press(tree, "status-custom-line");
    act(() => {
      tree.root
        .find((node) => node.props.testID === "custom-status-input")
        .props.onChangeText("  At practice till 6 ");
    });
    await act(async () => {
      pressableWithText(tree, "Save").props.onPress();
    });
    const body = mutateAsync.mock.calls[0]![0];
    expect(body.custom_status).toBe("At practice till 6");
    const end = new Date(body.custom_status_expires_at);
    expect(end.getHours()).toBe(0);
    expect(end.getMinutes()).toBe(0);
    expect(end.getTime()).toBeGreaterThan(Date.now());
    expect(dismiss).toHaveBeenCalled();
  });

  it("sends no end time for Don't clear", async () => {
    const tree = render();
    press(tree, "status-custom-line");
    act(() => {
      tree.root
        .find((node) => node.props.testID === "custom-status-input")
        .props.onChangeText("Studying");
    });
    act(() => {
      pressableWithText(tree, "Don't clear").props.onPress();
    });
    await act(async () => {
      pressableWithText(tree, "Save").props.onPress();
    });
    expect(mutateAsync).toHaveBeenCalledWith({
      custom_status: "Studying",
      custom_status_expires_at: null,
    });
  });

  it("won't save an 81-character line", () => {
    const tree = render();
    press(tree, "status-custom-line");
    act(() => {
      tree.root
        .find((node) => node.props.testID === "custom-status-input")
        .props.onChangeText("x".repeat(81));
    });
    expect(screenText(tree)).toContain("Keep it to 80 characters.");
    expect(pressableWithText(tree, "Save").props.disabled).toBe(true);
  });

  it("clears an existing line", async () => {
    state.settings = { ...ONLINE, custom_status: "At practice" };
    const tree = render();
    expect(screenText(tree)).toContain("At practice");
    press(tree, "status-custom-line");
    await act(async () => {
      pressableWithText(tree, "Clear status").props.onPress();
    });
    expect(mutateAsync).toHaveBeenCalledWith({ custom_status: null });
  });

  it("locks the rows while a write can't reach the server", () => {
    state.writeBlockedReason = "You're offline.";
    const tree = render();
    expect(screenText(tree)).toContain("You're offline.");
    expect(byTestId(tree, "status-invisible").props.disabled).toBe(true);
    expect(byTestId(tree, "status-custom-line").props.disabled).toBe(true);
  });
});
