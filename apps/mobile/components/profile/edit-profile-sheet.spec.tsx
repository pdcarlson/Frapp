/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
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

import { EditProfileSheet, type EditProfileField } from "./edit-profile-sheet";

const PROFILE: ViewerProfile = {
  displayName: "Alex Rivera",
  initials: "AR",
  email: "alex@example.test",
  phone: null,
  graduationYear: 2027,
  major: null,
  currentCity: "Troy, NY",
  currentCompany: null,
  bio: null,
  photoUrl: null,
  birthdayMonth: null,
  birthdayDay: null,
  birthdayYear: null,
  birthdayVisibility: "nobody",
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
      options.onSettled?.();
    };
    settle.fail = () => {
      isPending = false;
      options.onError(new Error());
      options.onSettled?.();
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
    expect(input(tree, "Major").props.value).toBe("");
    expect(input(tree, "Graduation year").props.value).toBe("2027");
    expect(input(tree, "City").props.value).toBe("Troy, NY");
    expect(input(tree, "Company").props.value).toBe("");
    expect(input(tree, "Bio").props.value).toBe("");
    expect(saveButton(tree).props.disabled).toBe(true);
  });

  it("centers one-line fields and gives the bio its line height (components.md § Text input)", () => {
    const tree = render();
    const style = (label: string): Record<string, unknown> =>
      Object.assign({}, ...[input(tree, label).props.style].flat(Infinity));

    // A lineHeight on a single-line iOS field draws the text below center.
    expect(style("Name")).not.toHaveProperty("lineHeight");
    expect(style("City")).not.toHaveProperty("lineHeight");
    // The bio wraps, so it keeps body's leading and starts at the top.
    expect(style("Bio").lineHeight).toBe(25);
    expect(style("Bio").textAlignVertical).toBe("top");
  });

  it("sends only what changed, then closes", () => {
    mutate.mockImplementation((_body, options) => {
      options.onSuccess();
      options.onSettled?.();
    });
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

  it("refuses a blank name once Save is pressed, and sends nothing", () => {
    const tree = render();

    type(tree, "Name", "  ");
    // Still being typed: no error yet (components.md, "When an error shows").
    expect(screenText(tree)).not.toContain("Your name can't be empty.");
    // And Save stays pressable, so pressing it can say why: a greyed Save
    // over an error the member can't see yet is a dead end.
    expect(saveButton(tree).props.disabled).toBe(false);
    act(() => {
      saveButton(tree).props.onPress();
    });
    expect(screenText(tree)).toContain("Your name can't be empty.");
    expect(mutate).not.toHaveBeenCalled();
  });

  // The reported bug: "2" on the way to "2027" turned the field red.
  it("waits for the member to leave the year before refusing it", () => {
    const tree = render();

    type(tree, "Graduation year", "2");
    type(tree, "Graduation year", "20");
    expect(screenText(tree)).not.toContain("Use a year between");
    // The last style slot is the invalid border.
    expect(input(tree, "Graduation year").props.style.at(-1)).toBeNull();

    act(() => {
      input(tree, "Graduation year").props.onBlur();
    });
    expect(screenText(tree)).toContain("Use a year between");

    // From here it follows the value, so the fix clears it at once.
    type(tree, "Graduation year", "2028");
    expect(screenText(tree)).not.toContain("Use a year between");
    act(() => {
      saveButton(tree).props.onPress();
    });
    expect(mutate.mock.calls[0]![0]).toEqual({ graduation_year: 2028 });
  });

  it("refuses a graduation year the API would reject", () => {
    const tree = render();

    type(tree, "Graduation year", "1850");
    act(() => {
      saveButton(tree).props.onPress();
    });
    expect(screenText(tree)).toContain("Use a year between");
    expect(mutate).not.toHaveBeenCalled();
  });

  // #5282: the birthday's audience is a switch that names what it shares.
  const shareSwitch = (tree: ReactTestRenderer) =>
    tree.root.findAll(
      (node) =>
        typeof node.props.onValueChange === "function" &&
        node.props.accessibilityLabel === "Share my birthday with my chapter",
    );

  it("draws no share switch until a month and day are typed (#5282)", () => {
    const tree = render();
    expect(shareSwitch(tree)).toHaveLength(0);

    type(tree, "Birthday month, 1 to 12", "3");
    expect(shareSwitch(tree)).toHaveLength(0);
    type(tree, "Birthday day", "14");
    expect(shareSwitch(tree).length).toBeGreaterThan(0);
    expect(shareSwitch(tree)[0]!.props.value).toBe(false);
    expect(screenText(tree)).toContain("Only you see it.");
  });

  it("shares the birthday with the chapter when switched on (#5282)", () => {
    const tree = render();
    type(tree, "Birthday month, 1 to 12", "3");
    type(tree, "Birthday day", "14");
    act(() => {
      shareSwitch(tree)[0]!.props.onValueChange(true);
    });
    expect(screenText(tree)).toContain(
      "Members see the day, not the year, on your profile and the chapter calendar.",
    );
    act(() => {
      saveButton(tree).props.onPress();
    });
    expect(mutate.mock.calls[0]![0]).toEqual({
      birthday_month: 3,
      birthday_day: 14,
      birthday_year: null,
      birthday_visibility: "chapter",
    });
  });

  it("sends a major", () => {
    const tree = render();

    type(tree, "Major", " Economics ");
    act(() => {
      saveButton(tree).props.onPress();
    });
    expect(mutate.mock.calls[0]![0]).toEqual({ major: "Economics" });
  });

  it("keeps the draft and says so when a save fails", () => {
    mutate.mockImplementation((_body, options) => {
      options.onError(new Error());
      options.onSettled?.();
    });
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

  it("sends one PATCH however often Save is pressed mid-save", () => {
    heldSave();
    const tree = render();

    type(tree, "Company", "Acme");
    // Two taps in one batch, before `isPending` reaches a render.
    act(() => {
      saveButton(tree).props.onPress();
      saveButton(tree).props.onPress();
    });
    refetch(tree, PROFILE); // and one after it has
    act(() => {
      saveButton(tree).props.onPress();
    });

    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("makes the fields read-only while a save runs", () => {
    heldSave();
    const tree = render();

    expect(input(tree, "City").props.editable).toBe(true);
    type(tree, "City", "Albany, NY");
    act(() => {
      saveButton(tree).props.onPress();
    });
    refetch(tree, PROFILE);

    expect(input(tree, "City").props.editable).toBe(false);
  });

  it("leaves a sheet reopened mid-save open when the save lands", () => {
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
    act(() => {
      modal(tree).props.onAnimate(-1, 0); // reopened
    });
    act(() => save.succeed());

    expect(dismiss).not.toHaveBeenCalled();
  });

  // `display_name` defaults to '' and reads back as unset, so a member who
  // never set a name opens Edit on a blank Name field.
  it("keeps Save off over a stored blank name until something is typed", () => {
    const tree = render({ ...PROFILE, displayName: null });

    expect(saveButton(tree).props.disabled).toBe(true);
  });

  it("says what's wrong with the year under the whole row, not in its column", () => {
    const tree = render();

    type(tree, "Graduation year", "20");
    act(() => {
      input(tree, "Graduation year").props.onBlur();
    });
    const alert = tree.root.find(
      (node) =>
        (node.type as unknown) === "Text" &&
        node.props.accessibilityRole === "alert",
    );
    expect(
      screenText({ root: alert } as unknown as ReactTestRenderer),
    ).toContain("Use a year between");
    // Not inside the 96-wide column that holds the year's field, or the
    // Major / Grad year row.
    let ancestor = input(tree, "Graduation year").parent;
    for (let depth = 0; depth < 2 && ancestor; depth += 1) {
      expect(ancestor.findAll((node) => node === alert)).toHaveLength(0);
      ancestor = ancestor.parent;
    }
  });

  // Paul, 2026-11-06: an undergrad has no after-graduation city or company.
  it("hides City and Company until the graduation year arrives", () => {
    const undergrad = { ...PROFILE, graduationYear: 2099, currentCity: null };
    const tree = render(undergrad);

    expect(screenText(tree)).not.toContain("After graduation");
    expect(() => input(tree, "City")).toThrow();

    type(tree, "Graduation year", "2020");
    expect(screenText(tree)).toContain("After graduation");
    expect(input(tree, "City").props.value).toBe("");
  });

  it("keeps City showing for an undergrad who already has one, so it can be cleared", () => {
    const tree = render({ ...PROFILE, graduationYear: 2099 });

    expect(input(tree, "City").props.value).toBe("Troy, NY");
    type(tree, "City", "");
    expect(input(tree, "City").props.value).toBe("");
  });

  it("opens on a blank name without calling it an error", () => {
    const tree = render({ ...PROFILE, displayName: null });

    expect(input(tree, "Name").props.value).toBe("");
    expect(screenText(tree)).not.toContain("Your name can't be empty.");
    type(tree, "Company", "Acme");
    expect(screenText(tree)).not.toContain("Your name can't be empty.");
    act(() => {
      saveButton(tree).props.onPress();
    });
    expect(screenText(tree)).toContain("Your name can't be empty.");
  });

  // The sheet stays mounted across visits, so a save must leave it able to
  // send the next one.
  it("sends the next save after one succeeds", () => {
    const save = heldSave();
    const tree = render();

    type(tree, "City", "Albany, NY");
    act(() => {
      saveButton(tree).props.onPress();
    });
    refetch(tree, { ...PROFILE, currentCity: "Albany, NY" });
    act(() => save.succeed());
    type(tree, "Company", "Acme");
    act(() => {
      saveButton(tree).props.onPress();
    });

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[1]![0]).toEqual({ current_company: "Acme" });
  });

  it("lets the member retry once a failed save settles", () => {
    const save = heldSave();
    const tree = render();

    type(tree, "City", "Albany, NY");
    act(() => {
      saveButton(tree).props.onPress();
    });
    act(() => save.fail());
    act(() => {
      saveButton(tree).props.onPress();
    });

    expect(mutate).toHaveBeenCalledTimes(2);
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
    act(() => {
      saveButton(tree).props.onPress();
    });
    expect(screenText(tree)).toContain("Your name can't be empty.");
    act(() => {
      modal(tree).props.onDismiss();
    });

    expect(input(tree, "Name").props.value).toBe("Alex Rivera");
    expect(input(tree, "Company").props.value).toBe("");
    expect(screenText(tree)).not.toContain("Your name can't be empty.");
    expect(saveButton(tree).props.disabled).toBe(true);
  });

  // Before it settles, `useUpdateUser` writes the row the server saved over
  // the same account's cached profile (a loaded s15 always has one), so the
  // screen hands the sheet the saved profile first.
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

  // gorhom fires no `onAnimate` when a caught close snaps back to the same
  // detent, so a close that starts can't be taken to mean the sheet is down.
  it("still closes on Cancel after a close was caught and snapped back", () => {
    const tree = render();

    act(() => {
      modal(tree).props.onAnimate(0, -1);
    });
    pressCancel(tree);

    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it("saves a field typed back to its old value after a refetch moved it", () => {
    const tree = render();

    type(tree, "City", "Troy, N");
    refetch(tree, { ...PROFILE, currentCity: "Albany, NY" });
    expect(input(tree, "City").props.value).toBe("Troy, N");
    type(tree, "City", "Troy, NY");
    act(() => {
      saveButton(tree).props.onPress();
    });

    expect(mutate.mock.calls[0]![0]).toEqual({ current_city: "Troy, NY" });
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

/**
 * #5280. The You tab's rows open the sheet at the field tapped: once the sheet
 * settles open it scrolls that field into view and focuses it, once a visit.
 */
// #5798: the phone formats as it is typed, one keystroke at a time.
describe("EditProfileSheet phone formatting (#5798)", () => {
  function typeEach(tree: ReactTestRenderer, text: string) {
    for (const char of text) {
      const shown = input(tree, "Phone").props.value as string;
      type(tree, "Phone", shown + char);
    }
  }

  it("formats a US number as it is typed", () => {
    const tree = render();
    typeEach(tree, "5185550142");
    expect(input(tree, "Phone").props.value).toBe("(518) 555-0142");
  });

  it("keeps a number starting with + in its country's format", () => {
    const tree = render();
    typeEach(tree, "+442079460958");
    expect(input(tree, "Phone").props.value).toBe("+44 20 7946 0958");
  });

  it("shows a stored number formatted", () => {
    const tree = render({ ...PROFILE, phone: "+15185550142" });
    expect(input(tree, "Phone").props.value).toBe("(518) 555-0142");
  });
});

describe("EditProfileSheet opens at a field (#5280)", () => {
  const scrollTo = vi.fn();
  const focus = new Map<string, ReturnType<typeof vi.fn>>();
  const { lg } = signetDarkTokens.spacing;

  beforeEach(() => {
    scrollTo.mockReset();
    focus.clear();
  });

  function renderAt(openAt: EditProfileField, profile = PROFILE) {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(
        <FrappThemeProvider>
          <EditProfileSheet ref={ref} profile={profile} openAt={openAt} />
        </FrappThemeProvider>,
        {
          createNodeMock: (element) => {
            const type = element.type as unknown;
            if (type === "BottomSheetModal")
              return { dismiss, present: vi.fn() };
            if (type === "BottomSheetScrollView") return { scrollTo };
            if (type === "BottomSheetTextInput") {
              const label = String(
                (element.props as { accessibilityLabel?: string })
                  .accessibilityLabel,
              );
              const spy = focus.get(label) ?? vi.fn();
              focus.set(label, spy);
              return { focus: spy };
            }
            return null;
          },
        },
      );
    });
    mounted.push(tree);
    act(() => {
      modal(tree).props.onAnimate(-1, 0);
    });
    return tree;
  }

  /** What the layout pass reports: the sheet's height and its content's. */
  function laidOut(tree: ReactTestRenderer, height: number, content: number) {
    const scroll = tree.root.find(
      (node) => (node.type as unknown) === "BottomSheetScrollView",
    );
    act(() => {
      scroll.props.onLayout({ nativeEvent: { layout: { y: 0, height } } });
      scroll.props.onContentSizeChange(0, content);
    });
  }

  /** Places the block holding the field labelled `label` at `y`. */
  function placed(
    tree: ReactTestRenderer,
    label: string,
    y: number,
    height = 48,
  ) {
    let block = input(tree, label).parent;
    while (block && typeof block.props.onLayout !== "function") {
      block = block.parent;
    }
    act(() => {
      block!.props.onLayout({ nativeEvent: { layout: { y, height } } });
    });
  }

  /** The keyboard has shrunk the sheet's body to `height`. */
  function keyboardUp(tree: ReactTestRenderer, height: number) {
    const scroll = tree.root.find(
      (node) => (node.type as unknown) === "BottomSheetScrollView",
    );
    act(() => {
      scroll.props.onLayout({ nativeEvent: { layout: { y: 0, height } } });
    });
  }

  const settleOpen = (tree: ReactTestRenderer) =>
    act(() => {
      modal(tree).props.onChange(0);
    });

  it("waits for the sheet to settle open, then scrolls the field to the top and focuses it", () => {
    const tree = renderAt("bio");
    laidOut(tree, 600, 1400);
    placed(tree, "Bio", 500);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(focus.get("Bio")).not.toHaveBeenCalled();

    settleOpen(tree);
    expect(scrollTo).toHaveBeenCalledWith({ y: 500 - lg, animated: true });
    expect(focus.get("Bio")).toHaveBeenCalledTimes(1);
  });

  it("goes there once a visit, and again on the next visit", () => {
    const tree = renderAt("bio");
    laidOut(tree, 600, 1400);
    placed(tree, "Bio", 500);

    settleOpen(tree);
    settleOpen(tree);
    expect(focus.get("Bio")).toHaveBeenCalledTimes(1);

    act(() => {
      modal(tree).props.onDismiss();
    });
    act(() => {
      modal(tree).props.onAnimate(-1, 0);
    });
    settleOpen(tree);
    expect(focus.get("Bio")).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("leaves a field near the top where it is, so the header stays in view", () => {
    const tree = renderAt("displayName");
    laidOut(tree, 600, 1400);
    placed(tree, "Name", 72);

    settleOpen(tree);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(focus.get("Name")).toHaveBeenCalledTimes(1);
  });

  it("never scrolls past the end of the content", () => {
    const tree = renderAt("company", { ...PROFILE, graduationYear: 2020 });
    laidOut(tree, 600, 1400);
    placed(tree, "Company", 1300);

    settleOpen(tree);
    expect(scrollTo).toHaveBeenCalledWith({ y: 800, animated: true });
    expect(focus.get("Company")).toHaveBeenCalledTimes(1);
  });

  it("doesn't scroll a form shorter than the sheet", () => {
    const tree = renderAt("bio");
    laidOut(tree, 700, 640);
    placed(tree, "Bio", 450, 100);

    settleOpen(tree);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(focus.get("Bio")).toHaveBeenCalledTimes(1);
  });

  it("checks the field again once the keyboard has shrunk the sheet, and only then", () => {
    const tree = renderAt("bio");
    laidOut(tree, 700, 700);
    placed(tree, "Bio", 450, 100);
    settleOpen(tree);
    expect(scrollTo).not.toHaveBeenCalled();

    keyboardUp(tree, 450);
    expect(scrollTo).toHaveBeenCalledWith({ y: 250, animated: true });

    keyboardUp(tree, 700);
    keyboardUp(tree, 300);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("does nothing as the sheet finishes closing", () => {
    const tree = renderAt("bio");
    laidOut(tree, 600, 1400);
    placed(tree, "Bio", 500);

    act(() => {
      modal(tree).props.onChange(-1);
    });
    expect(scrollTo).not.toHaveBeenCalled();
    expect(focus.get("Bio")).not.toHaveBeenCalled();
  });

  it("scrolls to a field that shares a row, by its row", () => {
    const tree = renderAt("graduationYear");
    laidOut(tree, 600, 1400);
    placed(tree, "Graduation year", 400);

    settleOpen(tree);
    expect(scrollTo).toHaveBeenCalledWith({ y: 400 - lg, animated: true });
    expect(focus.get("Graduation year")).toHaveBeenCalledTimes(1);
  });

  it("scrolls a birthday to its heading and focuses the month", () => {
    const tree = renderAt("birthdayMonth");
    laidOut(tree, 600, 1400);
    const heading = tree.root.find(
      (node) =>
        typeof node.props.onLayout === "function" &&
        node.findAll(
          (child) =>
            (child.type as unknown) === "Text" &&
            child.props.children === "Birthday",
        ).length > 0 &&
        node.findAll(
          (child) => (child.type as unknown) === "BottomSheetTextInput",
        ).length === 0,
    );
    act(() => {
      heading.props.onLayout({
        nativeEvent: { layout: { y: 380, height: 20 } },
      });
    });
    placed(tree, "Birthday month, 1 to 12", 412, 72);

    settleOpen(tree);
    expect(scrollTo).toHaveBeenCalledWith({ y: 380 - lg, animated: true });
    expect(focus.get("Birthday month, 1 to 12")).toHaveBeenCalledTimes(1);
  });

  // The You tab draws City from the stored year; a year typed ahead and kept
  // from a failed save must not leave that row opening a sheet without it.
  it("keeps City and Company while the stored year shows them, under a year typed ahead", () => {
    const graduate = { ...PROFILE, graduationYear: 2020, currentCity: null };
    const tree = renderAt("city", graduate);
    type(tree, "Graduation year", "2099");
    expect(input(tree, "City").props.value).toBe("");

    settleOpen(tree);
    expect(focus.get("City")).toHaveBeenCalledTimes(1);
  });

  it("opens a birthday at its month", () => {
    const tree = renderAt("birthdayMonth");
    settleOpen(tree);
    expect(focus.get("Birthday month, 1 to 12")).toHaveBeenCalledTimes(1);
    expect(focus.get("Birthday day")).not.toHaveBeenCalled();
  });

  it("raises no keyboard while a save runs, when the fields are read-only", () => {
    isPending = true;
    const tree = renderAt("phone");
    settleOpen(tree);
    expect(focus.get("Phone")).not.toHaveBeenCalled();
  });
});
