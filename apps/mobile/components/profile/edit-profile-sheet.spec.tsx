/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import type { ViewerProfile } from "@/lib/more/profile";
import { screenText } from "@/test/screen-text";

/**
 * #3387. s15's Edit sheet, rendered: it opens on the profile, refuses what the
 * API would, sends only what changed, and keeps the draft when a save fails.
 * The rules themselves are pinned in `lib/more/edit-profile.spec.ts`.
 */

const mutate = vi.fn();
let isPending = false;

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useUpdateUser: () => ({ mutate, isPending }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#F4CB63" }),
}));

import { EditProfileSheet } from "./edit-profile-sheet";

const PROFILE: ViewerProfile = {
  displayName: "Alex Rivera",
  initials: "AR",
  email: "alex@example.test",
  graduationYear: 2027,
  currentCity: "Troy, NY",
  currentCompany: null,
  bio: null,
  photoUrl: null,
};

/** Stands in for gorhom's modal instance, so a spec can see `dismiss()`. */
const dismiss = vi.fn();
const mounted: ReactTestRenderer[] = [];

function render(profile: ViewerProfile | null = PROFILE): ReactTestRenderer {
  const ref = React.createRef<never>();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <EditProfileSheet ref={ref} profile={profile} />
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

const input = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "BottomSheetTextInput" &&
      node.props.accessibilityLabel === label,
  );

const saveButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      node.props.accessibilityState !== undefined,
  );

function type(tree: ReactTestRenderer, label: string, value: string) {
  act(() => {
    input(tree, label).props.onChangeText(value);
  });
}

beforeEach(() => {
  mutate.mockReset();
  dismiss.mockReset();
  isPending = false;
});

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

describe("EditProfileSheet (#3387)", () => {
  it("opens on the profile, with Save off until something changes", () => {
    const tree = render();

    expect(input(tree, "Name").props.value).toBe("Alex Rivera");
    expect(input(tree, "Graduation year").props.value).toBe("2027");
    expect(input(tree, "City").props.value).toBe("Troy, NY");
    expect(input(tree, "Company").props.value).toBe("");
    expect(input(tree, "Bio").props.value).toBe("");
    expect(saveButton(tree).props.disabled).toBe(true);
  });

  it("sends only what changed, then closes", () => {
    mutate.mockImplementation((_body, options) => options.onSuccess());
    const tree = render();

    type(tree, "Company", "Acme");
    expect(saveButton(tree).props.disabled).toBe(false);
    act(() => {
      saveButton(tree).props.onPress();
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toEqual({ current_company: "Acme" });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("refuses a blank name inline and sends nothing", () => {
    const tree = render();

    type(tree, "Name", "  ");
    expect(screenText(tree)).toContain("Your name can't be empty.");
    expect(saveButton(tree).props.disabled).toBe(true);
    act(() => {
      saveButton(tree).props.onPress();
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it("refuses a graduation year the API would reject", () => {
    const tree = render();

    type(tree, "Graduation year", "1850");
    expect(screenText(tree)).toContain("Graduation year is a year between");
    expect(saveButton(tree).props.disabled).toBe(true);
  });

  it("keeps the draft and says so when a save fails", () => {
    mutate.mockImplementation((_body, options) => options.onError(new Error()));
    const tree = render();

    type(tree, "City", "Albany, NY");
    act(() => {
      saveButton(tree).props.onPress();
    });

    expect(screenText(tree)).toContain("That didn't save");
    expect(input(tree, "City").props.value).toBe("Albany, NY");
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("holds Save while a save is in flight", () => {
    isPending = true;
    const tree = render();

    type(tree, "Company", "Acme");
    expect(screenText(tree)).toContain("Saving…");
    expect(saveButton(tree).props.disabled).toBe(true);
  });

  it("drops the draft on Cancel, so it reopens on the profile", () => {
    const tree = render();

    type(tree, "Company", "Acme");
    const cancel = tree.root.find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        screenText({ root: node } as unknown as ReactTestRenderer) === "Cancel",
    );
    act(() => {
      cancel.props.onPress();
    });

    expect(input(tree, "Company").props.value).toBe("");
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
