/** @vitest-environment jsdom */
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/**
 * #3845, PR 3: the ME button carries the member's picked status bottom-right
 * (none while Online), and its menu opens with a Status row.
 */

const state: { settings: Record<string, unknown> | undefined } = {
  settings: undefined,
};

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useUserSettings: () => ({ data: state.settings }),
  useNotifications: () => ({ data: [] }),
}));

import {
  AccountButton,
  AccountMenu,
  type AccountMenuState,
} from "./home-header";

const mounted: ReactTestRenderer[] = [];

function menuState(visible: boolean): AccountMenuState {
  return { visible, top: 0, open: vi.fn(), close: vi.fn() };
}

function render(node: React.ReactNode) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <QueryClientProvider client={new QueryClient()}>
        <FrappThemeProvider>{node}</FrappThemeProvider>
      </QueryClientProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

const settings = (status: string) => ({
  status,
  status_expires_at: null,
  custom_status: null,
  custom_status_expires_at: null,
});

const button = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityLabel === "Your account",
  );

beforeEach(() => {
  state.settings = settings("online");
});

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

describe("AccountButton", () => {
  const props = { initials: "AR", photoUrl: null, fetchedAt: 0 };

  it("draws no status dot while Online", () => {
    const tree = render(<AccountButton menu={menuState(false)} {...props} />);
    expect(
      tree.root.findAll((node) =>
        String(node.props.testID ?? "").startsWith("account-status-"),
      ),
    ).toHaveLength(0);
    expect(button(tree).props.accessibilityValue).toBeUndefined();
  });

  it("draws Do Not Disturb's dot and names it", () => {
    state.settings = settings("dnd");
    const tree = render(<AccountButton menu={menuState(false)} {...props} />);
    expect(
      tree.root.findAll((node) => node.props.testID === "account-status-dnd")
        .length,
    ).toBeGreaterThan(0);
    expect(button(tree).props.accessibilityValue).toEqual({
      text: "Do Not Disturb",
    });
  });
});

describe("AccountMenu", () => {
  it("opens with a Status row that opens the sheet", () => {
    state.settings = { ...settings("invisible"), custom_status: "Studying" };
    const onStatus = vi.fn();
    const menu = menuState(true);
    const tree = render(<AccountMenu menu={menu} onStatus={onStatus} />);
    const text = screenText(tree);
    expect(text.indexOf("Invisible")).toBeLessThan(text.indexOf("Profile"));
    expect(text).toContain("Studying");
    act(() => {
      tree.root
        .find((node) => node.props.testID === "account-menu-status")
        .props.onPress();
    });
    expect(menu.close).toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalled();
  });
});
