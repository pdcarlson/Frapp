/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

/** The welcome card in a new member's first channel on the phone (#5627). */
const mocks = vi.hoisted(() => ({
  due: true,
  events: [] as unknown[],
  clear: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => "ch-1",
  useCurrentUser: () => ({
    data: { id: "u-1", display_name: "Jordan Avery", avatar_url: null },
    dataUpdatedAt: 1,
  }),
  useEvents: () => ({ data: mocks.events, isPending: false }),
  usePickableRoles: () => ({ roles: [], isLoading: false }),
}));
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ chapterName: "Beta Theta Omega" }),
}));
vi.mock("@/lib/onboarding/welcome-due", () => ({
  isWelcomeDue: () => Promise.resolve(mocks.due),
  clearWelcomeDue: () => mocks.clear(),
}));
vi.mock("@/components/profile/profile-photo", () => ({
  ProfilePhoto: () => null,
}));
vi.mock("@/components/settings/chat-density-sheet", () => ({
  ChatDensityOptions: () => null,
}));

import { useRouter } from "expo-router";
import { WelcomeCard } from "@/components/onboarding/welcome-card";

type Node = ReactTestRenderer["root"];

const soon = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

async function render(): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <WelcomeCard />
      </FrappThemeProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  return tree;
}

const texts = (root: Node) =>
  root
    .findAllByType("Text" as never, { deep: true })
    .map((text) => text.props.children);

const labelled = (root: Node, label: string) =>
  root
    .findAllByType("Pressable" as never, { deep: true })
    .find((p) => p.props.accessibilityLabel === label);

describe("WelcomeCard (phone)", () => {
  beforeEach(() => {
    mocks.due = true;
    mocks.events = [];
    mocks.clear.mockClear();
  });

  it("greets by first name, lists the next two events and opens one", async () => {
    mocks.events = [
      { id: "e2", name: "Car wash", start_time: soon(9) },
      { id: "e1", name: "Chapter meeting", start_time: soon(2) },
      { id: "e3", name: "Formal", start_time: soon(20) },
    ];
    const { root } = await render();

    expect(texts(root)).toContain("Welcome to Beta Theta Omega, Jordan");
    expect(texts(root)).toContain("Chapter meeting");
    expect(texts(root)).toContain("Car wash");
    expect(texts(root)).not.toContain("Formal");
    expect(texts(root)).toContain("Finish your profile");

    const meeting = root
      .findAllByType("Pressable" as never, { deep: true })
      .find((p) =>
        String(p.props.accessibilityLabel).startsWith("Chapter meeting"),
      );
    act(() => meeting?.props.onPress());
    expect(vi.mocked(useRouter)().push).toHaveBeenCalledWith({
      pathname: "/event-details",
      params: { id: "e1" },
    });
  });

  it("shows nothing when it isn't due", async () => {
    mocks.due = false;
    const { root } = await render();

    expect(root.findAllByProps({ testID: "welcome-card" })).toHaveLength(0);
  });

  it("closes for good", async () => {
    const { root } = await render();

    act(() => labelled(root, "Close the welcome card")?.props.onPress());

    expect(mocks.clear).toHaveBeenCalled();
    expect(root.findAllByProps({ testID: "welcome-card" })).toHaveLength(0);
  });
});
