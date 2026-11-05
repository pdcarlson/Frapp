import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { FloatingField } from "./floating-field";

describe("FloatingField", () => {
  it("names the field by its in-field label, filled or empty", () => {
    render(<FloatingField id="email" label="Email" type="email" defaultValue="" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("id", "email");
    // A single space, so `:placeholder-shown` can tell empty from filled
    // without the placeholder ever reading as content.
    expect(input).toHaveAttribute("placeholder", " ");
  });

  it("floats the label on focus, on a value and on autofill", () => {
    render(<FloatingField id="password" label="Password" type="password" />);
    const label = screen.getByText("Password");
    expect(label.className).toMatch(/peer-focus:top-2/);
    expect(label.className).toMatch(/peer-\[:not\(:placeholder-shown\)\]:top-2/);
    expect(label.className).toMatch(/peer-autofill:top-2/);
  });
});
