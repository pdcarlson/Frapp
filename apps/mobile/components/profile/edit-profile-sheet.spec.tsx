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

const ref = React.createRef<never>();

function sheet(profile: ViewerProfile | null) {
  return (
    <FrappThemeProvider>
      <EditProfileSheet ref={ref} profile={profile} />
    </FrappThemeProvider>
  );
}

function render(profile: ViewerProfile | null = PROFILE): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(sheet(profile), {
      createNodeMock: (element) =>
        (element.type as unknown) === "BottomSheetModal"
          ? { dismiss, present: vi.fn() }
          : null,
    });
  });
  mounted.push(tree);
  // What gorhom reports as `present()` starts bringing the sheet up.
  act(() => {
    modal(tree).props.onAnimate(-1, 0);
  });
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

/** What the screen hands the sheet when `/v1/users/me` refetches. */
function refetch(tree: ReactTestRenderer, profile: ViewerProfile) {
  act(() => {
    tree.update(sheet(profile));
  });
}

const modal = (tree: ReactTestRenderer) =>
  tree.root.find((node) => (node.type as unknown) === "BottomSheetModal");

function pressCancel(tree: ReactTestRenderer) {
  const cancel = tree.root.find(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      screenText({ root: node } as unknown as ReactTestRenderer) === "Cancel",
  );
  act(() => {
    cancel.props.onPress();
  });
}

/** A save the spec settles by hand, with `isPending` held while it runs. */
function heldSave() {
  const settle = { succeed: () => {}, fail: () => {} };
  mutate.mockImplementation((_body, options) => {
    isPending = true;
    settle.succeed = () => {
      isPending = false;
      options.onSuccess();
    };
    settle.fail = () => {
      isPending = false;
      options.onError(new Error());
    };
  });
  return settle;
}

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

  // A return to the app refetches `/v1/users/me`. A field the member never
  // touched follows the new profile and stays out of the save, so a value
  // another device set isn't written back over.
  it("sends only the typed field when the profile refetches mid-edit", () => {
    const tree = render();

    type(tree, "City", "Albany, NY");
    refetch(tree, {
      ...PROFILE,
      currentCompany: "Set on the web",
      bio: "Also from the web",
    });

    expect(input(tree, "Company").props.value).toBe("Set on the web");
    expect(input(tree, "Bio").props.value).toBe("Also from the web");
    expect(input(tree, "City").props.value).toBe("Albany, NY");
    act(() => {
      saveButton(tree).props.onPress();
    });
    expect(mutate.mock.calls[0]![0]).toEqual({ current_city: "Albany, NY" });
  });

  it("has nothing to save once a refetch brings the typed value", () => {
    const tree = render();

    type(tree, "City", "Albany, NY");
    refetch(tree, { ...PROFILE, currentCity: "Albany, NY" });

    expect(saveButton(tree).props.disabled).toBe(true);
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

  it("keeps the draft when a save in flight fails after the sheet was swiped away", () => {
    const save = heldSave();
    const tree = render();

    type(tree, "City", "Albany, NY");
    act(() => {
      saveButton(tree).props.onPress();
    });
    refetch(tree, PROFILE); // re-render with the save in flight
    act(() => {
      modal(tree).props.onDismiss();
    });
    act(() => save.fail());

    expect(screenText(tree)).toContain("That didn't save");
    expect(input(tree, "City").props.value).toBe("Albany, NY");
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
    pressCancel(tree);

    expect(input(tree, "Company").props.value).toBe("");
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  // Swiping the sheet down or tapping the scrim closes it through gorhom's
  // `onDismiss`, with no Cancel press.
  it("drops the draft and its refusal when the sheet is swiped away", () => {
    const tree = render();

    type(tree, "Name", "");
    type(tree, "Company", "Acme");
    expect(screenText(tree)).toContain("Your name can't be empty.");
    act(() => {
      modal(tree).props.onDismiss();
    });

    expect(input(tree, "Name").props.value).toBe("Alex Rivera");
    expect(input(tree, "Company").props.value).toBe("");
    expect(screenText(tree)).not.toContain("Your name can't be empty.");
    expect(saveButton(tree).props.disabled).toBe(true);
  });

  // `useUpdateUser` writes the saved fields into the cached profile before
  // it settles, so the screen hands the sheet the saved profile first.
  it("closes onto the saved values and drops the edits", () => {
    const save = heldSave();
    const tree = render();

    type(tree, "Company", "Acme");
    act(() => {
      saveButton(tree).props.onPress();
    });
    refetch(tree, { ...PROFILE, currentCompany: "Acme" });
    act(() => save.succeed());

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(input(tree, "Company").props.value).toBe("Acme");
    expect(saveButton(tree).props.disabled).toBe(true);
    // The edit is gone, not just equal: a later change from the web shows.
    refetch(tree, { ...PROFILE, currentCompany: "Changed on the web" });
    expect(input(tree, "Company").props.value).toBe("Changed on the web");
  });

  it("follows the profile again in a field typed back to its old value", () => {
    const tree = render();

    type(tree, "City", "Albany, NY");
    type(tree, "City", "Troy, NY");
    refetch(tree, { ...PROFILE, currentCity: "Set on the web" });
    type(tree, "Bio", "Pre-med.");

    expect(input(tree, "City").props.value).toBe("Set on the web");
    act(() => {
      saveButton(tree).props.onPress();
    });
    expect(mutate.mock.calls[0]![0]).toEqual({ bio: "Pre-med." });
  });

  it("keeps the draft when a save in flight fails after Cancel", () => {
    const save = heldSave();
    const tree = render();

    type(tree, "City", "Albany, NY");
    act(() => {
      saveButton(tree).props.onPress();
    });
    refetch(tree, PROFILE); // re-render with the save in flight
    pressCancel(tree);
    act(() => {
      modal(tree).props.onDismiss();
    });
    act(() => save.fail());

    expect(screenText(tree)).toContain("That didn't save");
    expect(input(tree, "City").props.value).toBe("Albany, NY");
  });

  // gorhom's `dismiss()` on a modal that already closed leaves it stuck
  // mid-dismiss, and the next `present()` draws nothing.
  it("doesn't dismiss again when a save lands after the sheet closed", () => {
    const save = heldSave();
    const tree = render();

    type(tree, "City", "Albany, NY");
    act(() => {
      saveButton(tree).props.onPress();
    });
    refetch(tree, PROFILE);
    act(() => {
      modal(tree).props.onDismiss();
    });
    act(() => save.succeed());

    expect(dismiss).not.toHaveBeenCalled();
    // And the edits drop on success, so the next open shows the profile.
    refetch(tree, { ...PROFILE, currentCity: "Albany, NY" });
    refetch(tree, { ...PROFILE, currentCity: "Changed on the web" });
    expect(input(tree, "City").props.value).toBe("Changed on the web");
  });

  it("doesn't dismiss a sheet that animated closed", () => {
    const save = heldSave();
    const tree = render();

    type(tree, "City", "Albany, NY");
    act(() => {
      saveButton(tree).props.onPress();
    });
    // gorhom starts the close (a swipe or the scrim) before `onDismiss`.
    act(() => {
      modal(tree).props.onAnimate(0, -1);
    });
    act(() => save.succeed());

    expect(dismiss).not.toHaveBeenCalled();
  });

  it("follows the profile in a field that differs from it only by spaces", () => {
    const tree = render();

    type(tree, "City", "Troy, NY ");
    refetch(tree, { ...PROFILE, currentCity: "Set on the web" });
    type(tree, "Bio", "Pre-med.");

    expect(input(tree, "City").props.value).toBe("Set on the web");
    act(() => {
      saveButton(tree).props.onPress();
    });
    expect(mutate.mock.calls[0]![0]).toEqual({ bio: "Pre-med." });
  });
});
