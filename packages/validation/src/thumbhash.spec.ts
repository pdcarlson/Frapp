import { describe, expect, it } from "vitest";
import { isDecodableThumbhash } from "./thumbhash";

describe("isDecodableThumbhash (#3879)", () => {
  // Real hashes from the reference encoder's demo images.
  it.each([
    "1QcSHQRnh493V4dIh4eXh1h4kJUI",
    "3OcRJYB4d3h/iIeHeEh3eIhw+j3A",
    "VggKDYAW6lZvdYd6d2iZh/p4GE/k",
    "2fcZFIB3iId/h3iJh4aIYJ2V8g==",
    "IQgSLYZ6iHePh4h1eFeHh4dwgwg3",
    "YJqGPQw7sFlslqhFafSE+Q6oJ1h2iHB2Rw==",
  ])("accepts a real hash (%s)", (hash) => {
    expect(isDecodableThumbhash(hash)).toBe(true);
  });

  it.each([
    ["three bytes, which passes a base64 pattern", "AAAA"],
    ["a real hash cut short", "1QcSHQRnh493V4dI"],
    ["not base64", "!!!!"],
    ["empty", ""],
    ["a lone trailing character", "1QcSH"],
  ])("refuses %s", (_, hash) => {
    expect(isDecodableThumbhash(hash)).toBe(false);
  });

  it("refuses a non-string", () => {
    expect(isDecodableThumbhash(42)).toBe(false);
    expect(isDecodableThumbhash(null)).toBe(false);
  });
});
