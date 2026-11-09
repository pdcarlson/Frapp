import { ActionSheetIOS, Alert } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachChoices,
  PHOTO_CHOICE,
  POLL_CHOICE,
  presentAttachChoices,
} from "./attach-choices";

beforeEach(() => {
  vi.mocked(ActionSheetIOS.showActionSheetWithOptions).mockClear();
  vi.mocked(Alert.alert).mockClear();
});

describe("attachChoices (#3701)", () => {
  it("offers only what can work now, photo first", () => {
    const photo = vi.fn();
    const poll = vi.fn();
    expect(attachChoices({ photo, poll }).map((c) => c.label)).toEqual([
      PHOTO_CHOICE,
      POLL_CHOICE,
    ]);
    expect(attachChoices({ poll }).map((c) => c.label)).toEqual([POLL_CHOICE]);
    expect(attachChoices({})).toEqual([]);
  });
});

describe("presentAttachChoices (#3701)", () => {
  it("runs a lone choice at once, with no menu: a + for photos only stays one tap", () => {
    const photo = vi.fn();
    presentAttachChoices(attachChoices({ photo }), "ios");
    expect(photo).toHaveBeenCalledTimes(1);
    expect(ActionSheetIOS.showActionSheetWithOptions).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("offers Photo, Poll and Cancel as iOS's action sheet, and runs the pick", () => {
    const photo = vi.fn();
    const poll = vi.fn();
    presentAttachChoices(attachChoices({ photo, poll }), "ios");
    const [options, choose] = vi.mocked(
      ActionSheetIOS.showActionSheetWithOptions,
    ).mock.calls[0]!;
    expect(options.options).toEqual([PHOTO_CHOICE, POLL_CHOICE, "Cancel"]);
    expect(options.cancelButtonIndex).toBe(2);
    choose(1);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(photo).not.toHaveBeenCalled();
    choose(2);
    expect(photo).not.toHaveBeenCalled();
  });

  it("offers them as an alert on Android", () => {
    const photo = vi.fn();
    const poll = vi.fn();
    presentAttachChoices(attachChoices({ photo, poll }), "android");
    const buttons = vi.mocked(Alert.alert).mock.calls[0]![2]!;
    expect(buttons.map((b) => b.text)).toEqual([
      "Cancel",
      PHOTO_CHOICE,
      POLL_CHOICE,
    ]);
    buttons[2]!.onPress!();
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("does nothing with nothing to offer", () => {
    presentAttachChoices([], "ios");
    expect(ActionSheetIOS.showActionSheetWithOptions).not.toHaveBeenCalled();
  });
});
