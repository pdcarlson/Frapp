/** @vitest-environment jsdom */
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { useRouter } from "expo-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * #3839: the inbox's bell is back on Chat home's header, beside Messages, now
 * that the avatar that held its count is the You tab. Its count is house gold
 * and leaves out chat pushes, which the channel rows already badge.
 */

const state: { notifications: unknown[] } = { notifications: [] };

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useNotifications: () => ({ data: state.notifications }),
}));

import { NotificationsButton } from "./home-header";

const mounted: ReactTestRenderer[] = [];

function render() {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NotificationsButton />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

const bell = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === "Notifications",
  );

const badge = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      (node.type as unknown) === "View" &&
      node.props.testID === "notifications-badge",
  );

const row = (
  id: string,
  screen: string,
  readAt: string | null = null,
) => ({
  id,
  type: "x",
  title: "t",
  body: "b",
  data: { target: { screen } },
  read_at: readAt,
  created_at: "2026-11-12T12:00:00Z",
});

beforeEach(() => {
  state.notifications = [];
});

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

describe("NotificationsButton", () => {
  it("draws no badge and no value with nothing unread", () => {
    const tree = render();
    expect(badge(tree)).toHaveLength(0);
    expect(bell(tree).props.accessibilityValue).toBeUndefined();
  });

  it("counts unread rows other than chat pushes, in house gold", () => {
    state.notifications = [
      row("n-1", "event"),
      row("n-2", "tasks"),
      row("n-3", "event", "2026-11-12T12:05:00Z"),
      // A chat push's row: the channel list already badges it.
      row("n-4", "chat"),
    ];
    const tree = render();
    const [dot] = badge(tree);
    expect(dot).toBeDefined();
    const style = Object.assign({}, ...[dot!.props.style].flat(Infinity));
    expect(style.backgroundColor).toBe(signetDarkTokens.color.gold.house);
    expect(bell(tree).props.accessibilityValue).toEqual({ text: "2 unread" });
  });

  it("opens the inbox", () => {
    const tree = render();
    const push = vi.mocked(useRouter().push);
    push.mockClear();
    act(() => bell(tree).props.onPress());
    expect(push).toHaveBeenCalledWith("/notifications");
  });
});
