import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installTextInputFocusShim } from "./text-input-focus-shim";

const require = createRequire(import.meta.url);

describe("installTextInputFocusShim (#5061)", () => {
  it("gives a react-native-web style State a currentlyFocusedInput that returns the focused field", () => {
    const node = { blur: () => {}, focus: () => {} };
    const state: Record<string, unknown> = {
      _node: node as unknown,
      currentlyFocusedField(this: { _node: unknown }) {
        return this._node;
      },
    };

    expect(installTextInputFocusShim({ State: state })).toBe(true);
    const read = state.currentlyFocusedInput as () => unknown;
    expect(read()).toBe(node);

    state._node = null;
    expect(read()).toBeNull();
  });

  it("leaves an existing currentlyFocusedInput (native) alone", () => {
    const native = () => "native";
    const state = {
      currentlyFocusedInput: native,
      currentlyFocusedField: () => "web",
    };

    expect(installTextInputFocusShim({ State: state })).toBe(false);
    expect(state.currentlyFocusedInput).toBe(native);
  });

  it("does nothing without a State to patch", () => {
    expect(installTextInputFocusShim({})).toBe(false);
    expect(installTextInputFocusShim({ State: {} })).toBe(false);
  });

  // The gap this shim fills, read from the installed packages: if either side
  // changes (react-native-web adds the method, or the sheet stops calling it),
  // this fails and the shim can be reconsidered or deleted.
  it("is still needed: react-native-web lacks the method the bottom sheet calls", () => {
    const rnwModule = require("react-native-web/dist/cjs/modules/TextInputState");
    const rnwState = (rnwModule.default ?? rnwModule) as Record<
      string,
      unknown
    >;
    expect(typeof rnwState.currentlyFocusedField).toBe("function");
    expect(rnwState.currentlyFocusedInput).toBeUndefined();

    const sheetInput = readFileSync(
      join(
        require.resolve("@gorhom/bottom-sheet/package.json"),
        "..",
        "lib/commonjs/components/bottomSheetTextInput/BottomSheetTextInput.js",
      ),
      "utf8",
    );
    expect(sheetInput).toContain("State.currentlyFocusedInput()");
  });

  it("is imported by the root layout, so every sheet gets it", () => {
    const layout = readFileSync(join(__dirname, "../app/_layout.tsx"), "utf8");
    expect(layout).toMatch(/^import "@\/lib\/text-input-focus-shim";$/m);
  });
});
