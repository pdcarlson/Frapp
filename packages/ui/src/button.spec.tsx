import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders with default props (primary variant)", () => {
    render(<Button>Click me</Button>);

    const button = screen.getByRole("button", { name: "Click me" });
    expect(button).toBeDefined();

    // Check base classes
    expect(button.className).toContain("inline-flex");
    expect(button.className).toContain("items-center");
    expect(button.className).toContain("justify-center");

    // Check primary variant classes
    expect(button.className).toContain("bg-primary");
    expect(button.className).toContain("text-primary-foreground");

    // Default type
    expect(button.getAttribute("type")).toBe("button");
  });

  it("renders with secondary variant", () => {
    render(<Button variant="secondary">Secondary</Button>);

    const button = screen.getByRole("button", { name: "Secondary" });
    expect(button.className).toContain("border-border");
    expect(button.className).toContain("bg-card");
    expect(button.className).toContain("text-card-foreground");
  });

  it("renders with ghost variant", () => {
    render(<Button variant="ghost">Ghost</Button>);

    const button = screen.getByRole("button", { name: "Ghost" });
    expect(button.className).toContain("text-foreground");
    expect(button.className).toContain("hover:bg-accent");
    // Should not have primary or secondary specific classes
    expect(button.className).not.toContain("bg-primary");
    expect(button.className).not.toContain("bg-card");
  });

  it("applies custom className", () => {
    render(<Button className="custom-class-123">Custom</Button>);

    const button = screen.getByRole("button", { name: "Custom" });
    expect(button.className).toContain("custom-class-123");
    expect(button.className).toContain("bg-primary"); // still keeps variant class
  });

  it("respects custom type prop", () => {
    render(<Button type="submit">Submit</Button>);

    const button = screen.getByRole("button", { name: "Submit" });
    expect(button.getAttribute("type")).toBe("submit");
  });

  it("passes through additional HTML props", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Button onClick={onClick} aria-label="Custom Label" data-testid="my-btn">
        Click
      </Button>
    );

    const button = screen.getByTestId("my-btn");
    expect(button.getAttribute("aria-label")).toBe("Custom Label");

    await user.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("handles disabled state", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();

    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>
    );

    const button = screen.getByRole("button", { name: "Disabled" });
    expect(button.hasAttribute("disabled")).toBe(true);

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});
