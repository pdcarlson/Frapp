import { describe, expect, it } from "vitest";
import { compactControlClassName } from "./table-controls";

/*
 * `compactControlClassName` is 32px to a pointer and must stay 44px to a
 * finger (`components.md` §2's touch floor). Chat's chrome and the dense list
 * rows both use it, so shortening it drops every one of those targets at once,
 * and no type sees a class string change.
 */
describe("compactControlClassName", () => {
  const tokens = compactControlClassName.split(/\s+/);

  it("restores the 44px touch target on a coarse pointer", () => {
    expect(tokens).toEqual(
      expect.arrayContaining(["pointer-coarse:h-11", "pointer-coarse:w-11"]),
    );
  });

  it("is a 32px box to a fine pointer", () => {
    expect(tokens).toEqual(expect.arrayContaining(["h-8", "w-8"]));
  });
});
