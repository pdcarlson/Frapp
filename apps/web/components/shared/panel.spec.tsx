import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sheet } from "@/components/ui/sheet";
import {
  PanelBody,
  PanelContent,
  PanelFooter,
  PanelHeader,
} from "./panel";

/**
 * The panel's shape is the § Surface size rule (`components.md`): one width
 * from the right edge, a title row and footer that stay put, and a body that
 * is the only thing that scrolls. Nothing else checks it, so a regression to a
 * narrow sheet or a footer that scrolls away would otherwise pass.
 */
function renderPanel() {
  render(
    <Sheet open>
      <PanelContent aria-describedby={undefined}>
        <PanelHeader>Create channel</PanelHeader>
        <PanelBody>
          <p>Body</p>
        </PanelBody>
        <PanelFooter>
          <button type="button">Save</button>
        </PanelFooter>
      </PanelContent>
    </Sheet>,
  );
}

describe("Panel", () => {
  it("opens from the right at the one panel width", () => {
    renderPanel();
    const panel = screen.getByRole("dialog");
    expect(panel).toHaveClass("right-0", "sm:w-[576px]", "sm:max-w-[576px]");
    expect(panel).toHaveAccessibleName("Create channel");
  });

  it("scrolls only the body, so the title row and footer stay on screen", () => {
    renderPanel();
    const body = screen.getByText("Body").parentElement!;
    expect(body).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
    const footer = screen.getByRole("button", { name: "Save" }).parentElement!;
    expect(footer).toHaveClass("shrink-0");
    expect(footer).not.toHaveClass("overflow-y-auto");
  });
});
