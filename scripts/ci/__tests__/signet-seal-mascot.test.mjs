import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BRAND = join(REPO_ROOT, "spec/ui/brand-identity.md");
const ASSETS = join(REPO_ROOT, "spec/ui/assets.md");

describe("Signet mascot is a seal (the animal)", () => {
  const brand = readFileSync(BRAND, "utf8");
  const assets = readFileSync(ASSETS, "utf8");

  it("records the mascot in brand-identity.md as a seal (the animal)", () => {
    assert.match(brand, /^### The mascot$/m);
    assert.match(brand, /seal \(the animal\)/);
    assert.match(brand, /MUST NOT ship until the USPTO search/);
  });

  it("keeps the wax-seal ban on the mark, not as the mascot", () => {
    assert.match(brand, /No literal signet ring or wax seal/);
    const mascot = brand.slice(brand.indexOf("### The mascot"));
    assert.match(mascot, /not a wax seal/i);
  });

  it("points the asset pass at the same mascot without restyling piecemeal", () => {
    assert.match(assets, /intended mascot \(a seal, the animal\)/);
    assert.match(assets, /MUST NOT restyle the legacy assets toward Signet piecemeal/);
  });

  it("refuses a GitHub closer next to an issue number", () => {
    assert.doesNotMatch(brand, /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i);
    assert.doesNotMatch(assets, /\b(fixes|closes|close|fix|fixed|resolve|resolves|resolved)\s+#/i);
  });
});
