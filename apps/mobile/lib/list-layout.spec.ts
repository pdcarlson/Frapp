import AsyncStorage from "@react-native-async-storage/async-storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listLayoutPreference,
  parseListLayout,
  resetListLayoutsForTests,
  setListLayout,
} from "./list-layout";

beforeEach(() => {
  resetListLayoutsForTests();
  vi.clearAllMocks();
});

describe("list-layout (#4175)", () => {
  it("reads anything but grid as the list", () => {
    expect(parseListLayout("grid")).toBe("grid");
    expect(parseListLayout("list")).toBe("list");
    expect(parseListLayout("calendar")).toBe("list");
    expect(parseListLayout(null)).toBe("list");
  });

  it("keeps one stored preference per screen, under the screen's own key", () => {
    expect(listLayoutPreference("directory")).toBe(
      listLayoutPreference("directory"),
    );
    setListLayout("directory", "grid");
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "frapp.directory.layout",
      "grid",
    );
  });
});
