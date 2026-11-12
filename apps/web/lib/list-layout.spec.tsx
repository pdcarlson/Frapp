import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const viewer = vi.hoisted(() => ({ id: "viewer-1" as string | null }));
vi.mock("@repo/hooks", () => ({ useViewerUserId: () => viewer.id }));

import {
  listLayoutStorageKey,
  readListLayout,
  resetListLayoutForTests,
  writeListLayout,
} from "@/lib/list-layout";
import { ListLayoutToggle } from "@/components/shared/list-layout-toggle";

afterEach(() => {
  window.localStorage.clear();
  resetListLayoutForTests();
  viewer.id = "viewer-1";
  vi.restoreAllMocks();
});

describe("list-layout (#4175)", () => {
  it("keeps the pick per screen and per viewer", () => {
    writeListLayout("directory", "viewer-1", "grid");
    expect(
      window.localStorage.getItem(
        listLayoutStorageKey("directory", "viewer-1"),
      ),
    ).toBe("grid");
    expect(readListLayout("directory", "viewer-1")).toBe("grid");
    expect(readListLayout("directory", "viewer-2")).toBeNull();
    expect(readListLayout("directory", null)).toBeNull();
  });

  it("reads an unknown stored value as nothing stored", () => {
    window.localStorage.setItem(
      listLayoutStorageKey("directory", "viewer-1"),
      "calendar",
    );
    expect(readListLayout("directory", "viewer-1")).toBeNull();
  });

  it("holds a pick in memory when storage refuses it", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    writeListLayout("directory", "viewer-1", "grid");
    expect(readListLayout("directory", "viewer-1")).toBe("grid");
  });
});

describe("ListLayoutToggle", () => {
  it("opens on List, and remembers Grid once picked", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ListLayoutToggle screen="directory" />);

    expect(
      screen.getByRole("radiogroup", { name: "Layout" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "List" })).toBeChecked();

    await user.click(screen.getByRole("radio", { name: "Grid" }));
    expect(screen.getByRole("radio", { name: "Grid" })).toBeChecked();
    unmount();

    render(<ListLayoutToggle screen="directory" />);
    expect(screen.getByRole("radio", { name: "Grid" })).toBeChecked();
  });

  it("follows a pick made in another tab", () => {
    render(<ListLayoutToggle screen="directory" />);
    act(() => {
      window.localStorage.setItem(
        listLayoutStorageKey("directory", "viewer-1"),
        "grid",
      );
      window.dispatchEvent(new StorageEvent("storage"));
    });
    expect(screen.getByRole("radio", { name: "Grid" })).toBeChecked();
  });
});
