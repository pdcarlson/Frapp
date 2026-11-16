import { describe, expect, it } from "vitest";
import { boxesIntersect, type Box } from "./geometry";
import { placeTextItems, textOutsideBoxes, type RawTextItem } from "./text-layer";
import {
  dropContained,
  namePatterns,
  suggestPageBoxes,
  suggestionNote,
} from "./suggest-boxes";

/** A letter page's flip from PDF space (origin bottom-left) to top-left. */
const flip = (x: number, y: number) => [x, 792 - y];

/** One run of 12-point text at (x, y) in PDF space, 6 points per character. */
function run(str: string, x: number, y: number): RawTextItem {
  return { str, transform: [12, 0, 0, 12, x, y], width: str.length * 6, height: 12 };
}

function page(items: RawTextItem[]) {
  return { width: 612, height: 792, items: placeTextItems(items, flip, 0) };
}

function suggest(items: RawTextItem[], names: string[] = []): Box[] {
  return suggestPageBoxes(page(items), namePatterns(names));
}

/** The words a box set would drop from the searchable layer. */
function dropped(items: RawTextItem[], boxes: Box[]): string[] {
  const placed = placeTextItems(items, flip, 0);
  const kept = new Set(textOutsideBoxes(placed, boxes));
  return placed.filter((item) => !kept.has(item)).map((item) => item.str);
}

describe("suggested redaction boxes", () => {
  it("boxes the space after a Name label, where a handwritten name goes", () => {
    const items = [run("Name:", 72, 720), run("CHEM 1010 Exam 2", 72, 690)];
    const boxes = suggest(items);
    expect(boxes).toHaveLength(1);
    const [box] = boxes;
    // Starts after the label, so the label itself stays readable.
    expect(box!.x).toBeCloseTo(72 + 5 * 6 + 3);
    expect(box!.width).toBeGreaterThanOrEqual(200);
    // Reaches above the printed line for handwriting, not down to the next line.
    expect(box!.y).toBeLessThan(72 - 12);
    expect(dropped(items, boxes)).toEqual([]);
  });

  it("covers a name typed after the label, in the same run or the next", () => {
    expect(dropped([run("Name: Jane Doe", 72, 720)], suggest([run("Name: Jane Doe", 72, 720)]))).toEqual([
      "Name: Jane Doe",
    ]);
    const items = [run("Student Name:", 72, 720), run("Alexandria Montgomery-Fitzgerald III", 160, 720)];
    const [box] = suggest(items);
    expect(box!.x + box!.width).toBeGreaterThanOrEqual(160 + 36 * 6);
  });

  it("stops a field at the next field on the line", () => {
    const items = [run("Name:", 72, 720), run("Section:", 300, 720)];
    const boxes = suggest(items);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.x + boxes[0]!.width).toBeLessThan(300);
  });

  it("boxes a Name and an ID field on one line separately", () => {
    const boxes = suggest([run("Name:", 72, 720), run("ID #", 320, 720)]);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.x + boxes[0]!.width).toBeLessThan(320);
    expect(boxes[1]!.x).toBeGreaterThan(320);
  });

  it("matches a label followed by a blank line of underscores", () => {
    expect(suggest([run("NAME ____________", 72, 720)])).toHaveLength(1);
  });

  it("never matches the word name in a question", () => {
    expect(suggest([run("1. Name the enzyme that unwinds DNA.", 72, 720)])).toEqual([]);
  });

  it("boxes an email address and a student ID number, not the rest of the line", () => {
    const items = [run("Contact jdoe3@school.edu or ID 901234567 for 2024 grades", 72, 600)];
    const boxes = suggest(items);
    expect(boxes).toHaveLength(2);
    const [email, id] = boxes;
    expect(email!.x).toBeCloseTo(72 + 8 * 6 - 3, 0);
    expect(email!.width).toBeLessThan(20 * 6);
    expect(id!.x).toBeGreaterThan(email!.x + email!.width);
    // A four-digit year or course number is not an ID.
    expect(suggest([run("CHEM 1010, Spring 2024, 100 points", 72, 600)])).toEqual([]);
  });

  it("boxes a chapter member's full name in either order, and never a lone first name", () => {
    const names = ["Jordan Ellis", "Sam"];
    expect(suggest([run("Graded by Jordan Ellis", 72, 600)], names)).toHaveLength(1);
    expect(suggest([run("ELLIS, JORDAN", 72, 600)], names)).toHaveLength(1);
    expect(suggest([run("Jordan R. Ellis", 72, 600)], names)).toHaveLength(1);
    expect(suggest([run("Sam said Jordan won", 72, 600)], names)).toEqual([]);
    // A name split across two runs on the same line still matches.
    const split = [run("Jordan", 72, 600), run("Ellis", 120, 600)];
    expect(suggest(split, names)).toHaveLength(1);
    expect(dropped(split, suggest(split, names))).toEqual(["Jordan", "Ellis"]);
  });

  it("boxes a rotated run whole", () => {
    const rotated = placeTextItems(
      [{ str: "Name: Jane Doe", transform: [0, 12, -12, 0, 40, 400], width: 84, height: 12 }],
      flip,
      0,
    );
    const boxes = suggestPageBoxes({ width: 612, height: 792, items: rotated }, []);
    expect(boxes).toHaveLength(1);
    expect(boxesIntersect(boxes[0]!, rotated[0]!.rect)).toBe(true);
  });

  it("keeps boxes on the page", () => {
    const [box] = suggest([run("Name:", 500, 720)]);
    expect(box!.x + box!.width).toBeLessThanOrEqual(612);
  });

  it("leaves out a box inside another, and keeps overlapping fields apart", () => {
    const outer = { x: 0, y: 0, width: 10, height: 10 };
    const inner = { x: 2, y: 2, width: 3, height: 3 };
    const overlapping = { x: 5, y: 5, width: 10, height: 10 };
    expect(dropContained([inner, outer, overlapping, { ...outer }])).toEqual([outer, overlapping]);
  });

  it("never reaches over the printed line above a field", () => {
    const items = [run("Answer all questions in pen.", 72, 734), run("Name:", 72, 720)];
    const [box] = suggest(items);
    // The line above sits at baseline 58; the field stays below its descenders.
    expect(box!.y).toBeGreaterThan(58 + 12 * 0.3 + 2);
    expect(dropped(items, [box!])).toEqual([]);
  });

  it("never reaches down over the printed line below a field", () => {
    const items = [run("Name:", 72, 720), run("Answer all questions in pen.", 72, 702)];
    const [box] = suggest(items);
    expect(dropped(items, [box!])).toEqual([]);
    // Lines set closer than that still get a field that covers the line.
    const [tight] = suggest([run("Name:", 72, 720), run("Answer all questions.", 72, 708)]);
    expect(tight!.y + tight!.height).toBeGreaterThan(72);
    expect(tight!.y).toBeLessThanOrEqual(72 - 12 * 0.6);
  });

  it("ends a field at text further along the line, such as a header's course name", () => {
    const items = [run("Name:", 72, 720), run("CHEM 101 Midterm 2", 400, 720)];
    const boxes = suggest(items);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.x + boxes[0]!.width).toBeLessThan(400);
    expect(dropped(items, boxes)).toEqual([]);
  });

  it("ends a field with its underscores, and at a field right beside it", () => {
    const [blank] = suggest([run("Name: ________", 72, 720), run("Exam 2", 300, 720)]);
    expect(blank!.x + blank!.width).toBeLessThan(72 + 14 * 6 + 6);
    const [short] = suggest([run("Name:", 72, 720), run("Date:", 140, 720)]);
    expect(short!.x + short!.width).toBeLessThan(140);
  });

  it("matches a label with a note in brackets", () => {
    expect(suggest([run("Name (Last, First):", 72, 720)])).toHaveLength(1);
    expect(suggest([run("Student ID (9 digits) ________", 72, 720)])).toHaveLength(1);
  });

  it("isn't cut short by rotated text beside it", () => {
    const items = placeTextItems(
      [run("Name:", 72, 720), { str: "DRAFT DRAFT", transform: [0, 40, -40, 0, 200, 730], width: 300, height: 40 }],
      flip,
      0,
    );
    const boxes = suggestPageBoxes({ width: 612, height: 792, items }, []);
    const field = boxes.find((box) => box.x < 120);
    expect(field!.height).toBeGreaterThan(12 * 1.45);
  });

  it("matches roster names past a note, a suffix or a curly apostrophe", () => {
    const names = ["Alex Kim (he/him)", "John Smith Jr.", "Sean O'Brien"];
    expect(suggest([run("Graded: Alex Kim", 72, 600)], names)).toHaveLength(1);
    expect(suggest([run("John Smith", 72, 600)], names)).toHaveLength(1);
    expect(suggest([run("Sean O\u2019Brien", 72, 600)], names)).toHaveLength(1);
    expect(namePatterns(["Alex Kim (he/him)"])[0]).toMatchObject({ first: "alex", last: "kim" });
  });

  it("covers an ID number inside its field once", () => {
    const boxes = suggest([run("Student ID: 901234567", 72, 720)]);
    expect(boxes).toHaveLength(1);
  });

  it("says what was boxed and what is still the person's to find", () => {
    const box = { x: 0, y: 0, width: 5, height: 5 };
    expect(suggestionNote(null)).toMatch(/Looking/);
    expect(suggestionNote({ id: "a", boxes: { 1: [box], 3: [box, box] }, textLength: 900 })).toMatch(
      /^Boxed 3 spots on pages 1 and 3:/,
    );
    expect(suggestionNote({ id: "a", boxes: { 2: [box] }, textLength: 900 })).toMatch(/^Boxed 1 spot on page 2:/);
    expect(suggestionNote({ id: "a", boxes: {}, textLength: 3 })).toMatch(/scan/);
    expect(suggestionNote({ id: "a", boxes: {}, textLength: 900 })).toMatch(/^Found no/);
    expect(suggestionNote({ id: "a", boxes: {}, textLength: -1 })).toMatch(/^Couldn't search/);
  });
});
