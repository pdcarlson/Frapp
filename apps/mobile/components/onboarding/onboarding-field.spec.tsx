/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { signetDarkTokens } from "@repo/theme/signet";
import { FrappThemeProvider } from "@/lib/theme";
import { sheetFieldStyles } from "@/components/sheet-scaffold";
import { flatStyle } from "@/test/flat-style";
import { OnboardingTextInput } from "./onboarding-field";

/**
 * Onboarding's text field is the sheets' field (`sheetFieldStyles`), which is
 * 44pt tall, held at the spec's 48 for sign-in, join and setup. That height
 * is one override on a shared style other work edits, so it's pinned here.
 */

function renderField(): ReactTestRenderer["root"] {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <OnboardingTextInput placeholder="you@school.edu" />
      </FrappThemeProvider>,
    );
  });
  return tree.root.findByType("TextInput" as never);
}

describe("OnboardingTextInput", () => {
  it("is the 44pt touch Field step, the same as the sheets' field it's built on", () => {
    const input = renderField();
    const sheetField = sheetFieldStyles(
      signetDarkTokens,
      signetDarkTokens.color.gold.askText,
    ).field;

    expect(sheetField.minHeight).toBe(signetDarkTokens.touch.minimum);
    expect(flatStyle(input.props.style).minHeight).toBe(
      signetDarkTokens.touch.minimum,
    );
  });
});
