import fs from "node:fs";
import path from "node:path";
import { ActionSheetIOS, Alert, Linking, Platform } from "react-native";
import { phoneHref } from "@repo/validation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showActionMenu } from "./action-menu";

// The stub has no Linking; the phone row opens tel: and sms: through it.
vi.mock("react-native", async () => {
  const { reactNativeStub } = await import("@/test/react-native-stub");
  return { ...reactNativeStub, Linking: { openURL: vi.fn() } };
});
import { showMemberMenu } from "./directory/member-menu";
import { showPhoneActions } from "./directory/phone-actions";

const sheet = vi.mocked(ActionSheetIOS.showActionSheetWithOptions);
const dialog = vi.mocked(Alert.alert);
const platform = Platform as { OS: string };
const os = Platform.OS;

beforeEach(() => {
  sheet.mockClear();
  dialog.mockClear();
});
afterEach(() => {
  platform.OS = os;
});

describe("showActionMenu on iOS", () => {
  it("lists the rows then Cancel, and runs the row picked", () => {
    platform.OS = "ios";
    const first = vi.fn();
    const second = vi.fn();
    showActionMenu({
      title: "Ada",
      message: "(518) 555-0142",
      rows: [
        { label: "Call", onPress: first },
        { label: "Text", onPress: second },
      ],
      userInterfaceStyle: "dark",
    });

    expect(dialog).not.toHaveBeenCalled();
    const [options, pick] = sheet.mock.calls.at(-1)!;
    expect(options).toEqual({
      title: "Ada",
      message: "(518) 555-0142",
      options: ["Call", "Text", "Cancel"],
      cancelButtonIndex: 2,
      userInterfaceStyle: "dark",
    });
    expect(options).not.toHaveProperty("destructiveButtonIndex");
    pick(1);
    expect(second).toHaveBeenCalledTimes(1);
    pick(2); // Cancel runs nothing.
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("marks one destructive row by its index, several by their indices", () => {
    platform.OS = "ios";
    const row = (label: string, destructive = false) => ({
      label,
      ...(destructive ? { style: "destructive" as const } : {}),
      onPress: vi.fn(),
    });
    showActionMenu({ rows: [row("Choose"), row("Remove", true)] });
    expect(sheet.mock.calls.at(-1)![0].destructiveButtonIndex).toBe(1);

    showActionMenu({ rows: [row("Block", true), row("Remove", true)] });
    expect(sheet.mock.calls.at(-1)![0].destructiveButtonIndex).toEqual([0, 1]);
  });

  it("follows the system's appearance unless told, and takes its own Cancel label", () => {
    platform.OS = "ios";
    showActionMenu({
      rows: [{ label: "Dismiss", onPress: vi.fn() }],
      cancelLabel: "Never mind",
      android: { title: "Ignored on iOS", maxButtons: 0 },
    });
    const [options] = sheet.mock.calls.at(-1)!;
    expect(options).not.toHaveProperty("userInterfaceStyle");
    expect(options.title).toBeUndefined();
    expect(options.options).toEqual(["Dismiss", "Never mind"]);
  });
});

describe("showActionMenu on Android", () => {
  it("draws each row as a button, with its style only when it has one", () => {
    platform.OS = "android";
    const remove = vi.fn();
    showActionMenu({
      title: "a@school.edu",
      rows: [
        { label: "Share link", onPress: vi.fn() },
        { label: "Send again", style: "default", onPress: vi.fn() },
        { label: "Revoke invite", style: "destructive", onPress: remove },
      ],
      userInterfaceStyle: "dark",
    });

    expect(sheet).not.toHaveBeenCalled();
    const [title, message, buttons, options] = dialog.mock.calls.at(-1)!;
    expect(title).toBe("a@school.edu");
    expect(message).toBeUndefined();
    expect(buttons).toEqual([
      { text: "Share link", onPress: expect.any(Function) },
      { text: "Send again", style: "default", onPress: expect.any(Function) },
      {
        text: "Revoke invite",
        style: "destructive",
        onPress: expect.any(Function),
      },
    ]);
    expect(buttons![0]).not.toHaveProperty("style");
    expect(options).toEqual({ cancelable: true });
    buttons![2]!.onPress!();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("takes Android's own title, message, order, Cancel button and cap", () => {
    platform.OS = "android";
    const rows = ["One", "Two", "Three", "Four"].map((label) => ({
      label,
      onPress: vi.fn(),
    }));
    showActionMenu({
      title: "iOS title",
      message: "iOS message",
      rows,
      android: {
        title: "Android title",
        message: "Android message",
        rows: [...rows].reverse(),
        cancelButton: true,
        maxButtons: 2,
      },
    });
    const [title, message, buttons] = dialog.mock.calls.at(-1)!;
    expect(title).toBe("Android title");
    expect(message).toBe("Android message");
    expect(buttons!.map((button) => [button.text, button.style])).toEqual([
      ["Cancel", "cancel"],
      ["Four", undefined],
      ["Three", undefined],
    ]);
    expect(buttons![0]).not.toHaveProperty("onPress");
  });
});

// The call sites outside a rendered screen, pinned argument for argument on
// both platforms, so a drift from what they drew before the helper shows here.
describe("call sites", () => {
  it("showPhoneActions: name, number, Call and Text", () => {
    platform.OS = "ios";
    showPhoneActions("Ada", "(518) 555-0142");
    expect(sheet.mock.calls.at(-1)![0]).toEqual({
      title: "Ada",
      message: "(518) 555-0142",
      options: ["Call", "Text", "Cancel"],
      cancelButtonIndex: 2,
      userInterfaceStyle: "dark",
    });

    platform.OS = "android";
    showPhoneActions("Ada", "(518) 555-0142");
    expect(dialog.mock.calls.at(-1)).toEqual([
      "Ada",
      "(518) 555-0142",
      [
        { text: "Call", onPress: expect.any(Function) },
        { text: "Text", onPress: expect.any(Function) },
      ],
      { cancelable: true },
    ]);
  });

  it("showPhoneActions: Call dials and Text messages, on both platforms", () => {
    const openURL = vi.mocked(Linking.openURL).mockResolvedValue(true);
    const tel = phoneHref("(518) 555-0142", "call");
    const sms = phoneHref("(518) 555-0142", "text");
    try {
      platform.OS = "ios";
      showPhoneActions("Ada", "(518) 555-0142");
      const pick = sheet.mock.calls.at(-1)![1];
      pick(0);
      pick(1);
      pick(2);
      expect(openURL.mock.calls).toEqual([[tel], [sms]]);

      openURL.mockClear();
      platform.OS = "android";
      showPhoneActions("Ada", "(518) 555-0142");
      const buttons = dialog.mock.calls.at(-1)![2]!;
      buttons[0]!.onPress!();
      buttons[1]!.onPress!();
      expect(openURL.mock.calls).toEqual([[tel], [sms]]);
    } finally {
      openURL.mockReset();
    }
  });

  it("showMemberMenu: destructive Block and Remove, every Android row styled", () => {
    platform.OS = "ios";
    showMemberMenu("Ada", ["edit", "block", "remove"], vi.fn());
    expect(sheet.mock.calls.at(-1)![0]).toEqual({
      title: "Ada",
      options: [
        "Edit name and graduation year",
        "Block Ada",
        "Remove from chapter",
        "Cancel",
      ],
      destructiveButtonIndex: [1, 2],
      cancelButtonIndex: 3,
      userInterfaceStyle: "dark",
    });

    platform.OS = "android";
    showMemberMenu("Ada", ["edit", "unblock"], vi.fn());
    expect(dialog.mock.calls.at(-1)).toEqual([
      "Ada",
      undefined,
      [
        {
          text: "Edit name and graduation year",
          style: "default",
          onPress: expect.any(Function),
        },
        {
          text: "Unblock Ada",
          style: "default",
          onPress: expect.any(Function),
        },
      ],
      { cancelable: true },
    ]);
  });
});

// #5168's acceptance test: the iOS sheet is opened from one place only.
// The Ask proposal keeps its own call while #4898's slices hold the Ask files.
const STILL_OPENS_ITS_OWN = ["components/ask/ask-proposal.tsx"];

it("is the only file that opens ActionSheetIOS's sheet", () => {
  const root = path.resolve(__dirname, "..");
  const skip = new Set(["node_modules", ".expo", "dist", "ios", "android"]);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name) || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        /\.(ts|tsx)$/.test(entry.name) &&
        !/\.spec\.tsx?$/.test(entry.name) &&
        !full.endsWith(path.join("test", "react-native-stub.ts")) &&
        full !== path.join(root, "lib", "action-menu.ts") &&
        /showActionSheetWithOptions/.test(fs.readFileSync(full, "utf8"))
      )
        offenders.push(path.relative(root, full));
    }
  };
  walk(root);
  // Every exception is still a real caller, so the list can't go stale.
  expect(
    offenders.filter((file) => STILL_OPENS_ITS_OWN.includes(file)),
  ).toEqual(STILL_OPENS_ITS_OWN);
  expect(
    offenders.filter((file) => !STILL_OPENS_ITS_OWN.includes(file)),
  ).toEqual([]);
});
