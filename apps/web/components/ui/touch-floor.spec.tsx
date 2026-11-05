import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buttonVariants } from "./button";
import { Input } from "./input";
import { Select, SelectTrigger, SelectValue } from "./select";
import { Switch } from "./switch";
import { Table, TableHead, TableHeader, TableRow } from "./table";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

/*
 * `foundations.md` §9's control size scale: every primitive is dense to a
 * mouse and returns to the 44px touch floor (`components.md` §2) under
 * `pointer-coarse`. Dropping the coarse class leaves every phone-browser
 * control at 32-40px, and nothing a type checks would notice, so this pins
 * both halves. It also pins the rule that padding does not split by pointer: a
 * `pointer-coarse:px-*` class survives a caller's plain `pl-9` through `cn()`
 * and puts the toolbar search glyph on top of the typed text.
 */
const classes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

describe("control size scale", () => {
  it.each([
    ["default", "h-10", "pointer-coarse:h-11"],
    ["sm", "h-9", "pointer-coarse:h-11"],
    ["toolbar", "h-9", "pointer-coarse:h-11"],
    ["icon", "h-9", "pointer-coarse:h-11"],
  ] as const)(
    "Button %s is %s to a mouse and 44 to a finger",
    (size, fine, coarse) => {
      const tokens = buttonVariants({ size }).split(/\s+/);
      expect(tokens).toEqual(expect.arrayContaining([fine, coarse]));
      expect(tokens.some((t) => /^pointer-coarse:p[xlr]-/.test(t))).toBe(false);
    },
  );

  it("Input is the Field step, with one padding for both pointers", () => {
    render(<Input aria-label="Name" />);
    const tokens = classes(screen.getByLabelText("Name"));
    expect(tokens).toEqual(
      expect.arrayContaining(["h-10", "pointer-coarse:h-11", "px-3"]),
    );
    expect(tokens.some((t) => t.startsWith("pointer-coarse:p"))).toBe(false);
  });

  it("a caller's left padding still wins on touch", () => {
    render(<Input aria-label="Search" className="pl-9" />);
    const tokens = classes(screen.getByLabelText("Search"));
    expect(tokens).toContain("pl-9");
    expect(tokens.some((t) => /^pointer-coarse:p[xl]-/.test(t))).toBe(false);
  });

  it("SelectTrigger is the Field step", () => {
    render(
      <Select>
        <SelectTrigger aria-label="Role">
          <SelectValue placeholder="Pick" />
        </SelectTrigger>
      </Select>,
    );
    expect(classes(screen.getByLabelText("Role"))).toEqual(
      expect.arrayContaining(["h-10", "pointer-coarse:h-11"]),
    );
  });

  it("a tab is 36 to a mouse and 44 to a finger, by min-height", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">List</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const tokens = classes(screen.getByRole("tab"));
    expect(tokens).toEqual(
      expect.arrayContaining(["min-h-9", "pointer-coarse:min-h-11"]),
    );
    expect(tokens.some((t) => t.startsWith("pointer-coarse:py-"))).toBe(false);
  });

  it("a table header is 36 to a mouse and 44 to a finger", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    expect(classes(screen.getByRole("columnheader"))).toEqual(
      expect.arrayContaining(["h-9", "pointer-coarse:h-11"]),
    );
  });

  it("the toggle is the board's 36x22 to a mouse and 50x30 to a finger (#3057)", () => {
    render(<Switch aria-label="Notify" />);
    const track = screen.getByRole("switch");
    expect(classes(track)).toEqual(
      expect.arrayContaining([
        "h-[22px]",
        "w-9",
        "pointer-coarse:h-[30px]",
        "pointer-coarse:w-[50px]",
      ]),
    );
    // Thumb travel is the track's inner width minus the thumb: 36-2-18 and 50-2-24.
    const thumb = track.firstElementChild!;
    expect(classes(thumb)).toEqual(
      expect.arrayContaining([
        "h-[18px]",
        "pointer-coarse:h-6",
        "data-[state=checked]:translate-x-4",
        "pointer-coarse:data-[state=checked]:translate-x-6",
      ]),
    );
  });
});
