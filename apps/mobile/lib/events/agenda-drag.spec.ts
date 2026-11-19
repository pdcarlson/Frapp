import { describe, expect, it } from "vitest";
import { agendaDropIndex, agendaRowShift } from "./agenda-drag";

// Three rows, the middle one two lines tall, 4 points apart.
const ROWS = [
  { y: 0, h: 44 },
  { y: 48, h: 64 },
  { y: 116, h: 44 },
];

describe("agendaDropIndex", () => {
  it("stays put until the held row's middle passes a neighbour's", () => {
    expect(agendaDropIndex(ROWS, 0, 0)).toBe(0);
    // The first row's middle (22) has to pass the second's (80).
    expect(agendaDropIndex(ROWS, 0, 50)).toBe(0);
    expect(agendaDropIndex(ROWS, 0, 60)).toBe(1);
    expect(agendaDropIndex(ROWS, 0, 200)).toBe(2);
  });

  it("goes up as far as the rows it passes", () => {
    expect(agendaDropIndex(ROWS, 2, -60)).toBe(1);
    expect(agendaDropIndex(ROWS, 2, -200)).toBe(0);
  });

  it("holds a row it can't measure where it is", () => {
    expect(agendaDropIndex([], 1, 100)).toBe(1);
  });
});

describe("agendaRowShift", () => {
  it("slides the passed rows by the held row and its gap", () => {
    // The first row held over the third: the two below it go up 48.
    expect(agendaRowShift(ROWS, 0, 2, 1)).toBe(-48);
    expect(agendaRowShift(ROWS, 0, 2, 2)).toBe(-48);
    expect(agendaRowShift(ROWS, 0, 2, 0)).toBe(0);
    // The last held over the first: the two above go down 48.
    expect(agendaRowShift(ROWS, 2, 0, 0)).toBe(48);
    expect(agendaRowShift(ROWS, 2, 0, 1)).toBe(48);
  });

  it("leaves rows outside the passed range alone", () => {
    expect(agendaRowShift(ROWS, 0, 1, 2)).toBe(0);
  });
});
