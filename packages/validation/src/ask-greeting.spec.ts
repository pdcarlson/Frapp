import { describe, expect, it } from "vitest";
import { ASK_STARTER, askFirstName, askGreeting } from "./ask-greeting";

const at = (hour: number) => new Date(2026, 10, 17, hour, 30);

describe("Ask's greeting (#4904)", () => {
  it("says morning before noon, afternoon before 5pm and evening after, with the first name", () => {
    expect(askGreeting(at(9), "Marcus Ellison")).toBe("Good morning, Marcus.");
    expect(askGreeting(at(12), "Marcus Ellison")).toBe("Good afternoon, Marcus.");
    expect(askGreeting(at(16), "Marcus Ellison")).toBe("Good afternoon, Marcus.");
    expect(askGreeting(at(17), "Marcus Ellison")).toBe("Good evening, Marcus.");
    expect(askGreeting(at(0), "Marcus Ellison")).toBe("Good morning, Marcus.");
  });

  it("greets without a name when there is none", () => {
    expect(askGreeting(at(20), null)).toBe("Good evening.");
    expect(askGreeting(at(20), "   ")).toBe("Good evening.");
    expect(askFirstName("  Ana   Ruiz ")).toBe("Ana");
  });

  it("says hello by first name on the first open", () => {
    expect(ASK_STARTER.hello("Marcus Ellison")).toBe("Hey Marcus, I'm Frapp.");
    expect(ASK_STARTER.hello(null)).toBe("Hey, I'm Frapp.");
  });
});
