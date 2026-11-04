import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { ACCENT_PRESETS } from "@repo/hooks/chapter-identity";
import {
  ORG_PROFILES,
  orgColorsFor,
  orgDefaultAccent,
  orgProfileFor,
} from "@repo/org-archetypes";
import { FrappThemeProvider } from "@/lib/theme";
import { AccentPicker, parseTypedHex, type AccentPickerProps } from "./accent-picker";

function render(props: Partial<AccentPickerProps> = {}) {
  const onChange = vi.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <AccentPicker value="#A6192E" onChange={onChange} {...props} />
      </FrappThemeProvider>,
    );
  });
  return { tree, onChange };
}

const swatches = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (node) =>
      node.type === ("Pressable" as unknown) &&
      node.props.accessibilityRole === "radio",
  );

const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.find(
    (node) =>
      node.type === ("Pressable" as unknown) &&
      node.props.accessibilityLabel === label,
  );

const FIJI = orgColorsFor("Phi Gamma Delta");

describe("AccentPicker", () => {
  it("offers the organization's colors before the presets", () => {
    const { tree } = render({ orgColors: FIJI });
    const labels = swatches(tree).map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual([
      ...FIJI.map((swatch) => swatch.name),
      ...ACCENT_PRESETS.map((swatch) => swatch.name),
    ]);
  });

  it("shows only the presets when the organization is unknown", () => {
    const { tree } = render();
    expect(swatches(tree)).toHaveLength(ACCENT_PRESETS.length);
  });

  it("hands back the tapped swatch as #RRGGBB and marks the stored one selected", () => {
    const { tree, onChange } = render({ orgColors: FIJI });
    expect(byLabel(tree, "Crimson").props.accessibilityState.checked).toBe(
      true,
    );
    act(() => byLabel(tree, "Royal Purple").props.onPress());
    expect(onChange).toHaveBeenCalledWith(FIJI[0]!.hex);
  });

  it("opens on swatches, showing a non-swatch color as its own Current swatch", () => {
    // The house default, the directory placeholder and a typed hex are none
    // of the swatches; the hex field still starts tucked away.
    const { tree } = render({ value: "#C9A56F", orgColors: FIJI });
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Custom color hex",
      ),
    ).toHaveLength(0);
    expect(byLabel(tree, "Current").props.accessibilityState.checked).toBe(
      true,
    );
  });

  it("shows a preset the organization already offers only once", () => {
    // Theta Chi's Military Red is the Crimson preset's hex.
    const { tree } = render({ orgColors: orgColorsFor("Theta Chi") });
    const checked = swatches(tree).filter(
      (node) => node.props.accessibilityState.checked,
    );
    expect(checked.map((node) => node.props.accessibilityLabel)).toEqual([
      "Military Red",
    ]);
  });

  it("passes a typed hex on only once it is a whole color, and says when it isn't", () => {
    const onValidityChange = vi.fn();
    const { tree, onChange } = render({ onValidityChange });
    act(() => byLabel(tree, "Custom color").props.onPress());
    const field = () =>
      tree.root.find(
        (node) =>
          node.type === ("TextInput" as unknown) &&
          node.props.accessibilityLabel === "Custom color hex",
      );
    act(() => field().props.onChangeText("#4f2"));
    expect(onChange).toHaveBeenLastCalledWith("#44FF22");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);
    onChange.mockClear();
    act(() => field().props.onChangeText("#4f26"));
    expect(onChange).not.toHaveBeenCalled();
    expect(onValidityChange).toHaveBeenLastCalledWith(false);
    act(() => field().props.onChangeText("4f2683"));
    expect(onChange).toHaveBeenLastCalledWith("#4F2683");
    expect(onValidityChange).toHaveBeenLastCalledWith(true);

    // Tapping a swatch clears the field, so it never shows a second color.
    act(() => byLabel(tree, "Navy").props.onPress());
    expect(field().props.value).toBe("");
  });
});

describe("parseTypedHex", () => {
  it("reads 3 and 6 digit hex, with or without the #, and nothing else", () => {
    expect(parseTypedHex(" 4f2683 ")).toBe("#4F2683");
    expect(parseTypedHex("#fff")).toBe("#FFFFFF");
    for (const junk of ["", "#", "#4f26", "purple", "#4f26833"]) {
      expect(parseTypedHex(junk)).toBeNull();
    }
  });
});

describe("org profiles", () => {
  it("stores every color as an uppercase #RRGGBB", () => {
    for (const [name, profile] of Object.entries(ORG_PROFILES)) {
      for (const color of profile.colors ?? []) {
        expect(color.hex, `${name} ${color.name}`).toMatch(/^#[0-9A-F]{6}$/);
      }
    }
  });

  it("looks an organization up by name, ignoring case and spacing", () => {
    expect(orgProfileFor("  phi   gamma DELTA ")).toBe(
      ORG_PROFILES["Phi Gamma Delta"],
    );
    expect(orgProfileFor("Not An Organization")).toBeUndefined();
    expect(orgProfileFor(null)).toBeUndefined();
    expect(orgColorsFor(undefined)).toEqual([]);
  });

  it("starts a FIJI chapter on royal purple, not the directory's placeholder gold", () => {
    // The beta chapter was created from a directory row holding #C9A56F, and
    // painted cream (2026-11-04). The wizards now prefer this value.
    expect(orgDefaultAccent("Phi Gamma Delta")).toBe(FIJI[0]!.hex);
    expect(FIJI[0]!.name).toBe("Royal Purple");
    expect(orgProfileFor("Phi Gamma Delta")?.displaysGreekLetters).toBe(false);
  });
});
