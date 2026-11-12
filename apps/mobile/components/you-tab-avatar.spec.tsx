/** @vitest-environment jsdom */
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";

/**
 * #3839: the You tab's glyph is the member's own avatar. It is never filled
 * with the chapter accent (foundations.md §6); the active state is a ring in
 * the accent. The picked status (#3845) sits on it, as it sat on Chat home's
 * avatar before, and is hidden while Online.
 */

const ACCENT = "#7FB2FF";
const state: { status: string | null; user: Record<string, unknown> } = {
  status: "online",
  user: { display_name: "Paul Carlson" },
};

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentUser: () => ({ data: state.user, dataUpdatedAt: 1 }),
  useOwnAvatarTint: () => null,
}));

vi.mock("@/lib/account/own-status", () => ({
  useOwnStatus: () => (state.status ? { status: state.status } : null),
}));

import { YouTabAvatar } from "./you-tab-avatar";

const mounted: ReactTestRenderer[] = [];

function render(focused: boolean) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <YouTabAvatar focused={focused} accent={ACCENT} />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

const byTestId = (tree: ReactTestRenderer, id: string) =>
  tree.root.findAll(
    (node) => typeof node.type === "string" && node.props.testID === id,
  );

const flatten = (style: unknown) =>
  Object.assign({}, ...[style].flat(Infinity)) as Record<string, unknown>;

beforeEach(() => {
  state.status = "online";
  state.user = { display_name: "Paul Carlson" };
});

afterEach(() => {
  for (const tree of mounted.splice(0)) act(() => tree.unmount());
});

describe("YouTabAvatar", () => {
  it("draws the initials on the neutral avatar fill, never the accent", () => {
    const tree = render(true);
    const initials = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" && node.props.children === "PC",
    );
    const avatar = flatten(initials.parent!.props.style);
    expect(avatar.backgroundColor).toBe(signetDarkTokens.color.surface.popover);
    expect(avatar.borderColor).toBe(signetDarkTokens.color.border.hairline);
    expect(flatten(initials.props.style).color).toBe(
      signetDarkTokens.color.text.foreground,
    );
  });

  it("rings the avatar in the accent only while the tab is active", () => {
    expect(byTestId(render(false), "you-tab-ring")).toHaveLength(0);
    const [ring] = byTestId(render(true), "you-tab-ring");
    expect(flatten(ring!.props.style).borderColor).toBe(ACCENT);
  });

  it("draws no status dot while Online, or before the status is known", () => {
    const hasDot = (tree: ReactTestRenderer) =>
      tree.root.findAll((node) =>
        String(node.props.testID ?? "").startsWith("you-tab-status-"),
      ).length > 0;
    expect(hasDot(render(false))).toBe(false);
    state.status = null;
    expect(hasDot(render(false))).toBe(false);
  });

  it("draws a picked status's dot", () => {
    state.status = "dnd";
    const tree = render(false);
    expect(
      tree.root.findAll((node) => node.props.testID === "you-tab-status-dnd")
        .length,
    ).toBeGreaterThan(0);
  });

  it("is hidden from a screen reader, which hears the tab's label", () => {
    const [slot] = byTestId(render(false), "you-tab-avatar");
    expect(slot!.props.accessibilityElementsHidden).toBe(true);
    expect(slot!.props.importantForAccessibility).toBe("no-hide-descendants");
  });
});
