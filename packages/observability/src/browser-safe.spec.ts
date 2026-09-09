import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * This package is imported by web and landing bundles. A `node:` import or a
 * `process.env` read here would pull Node-only APIs into those graphs, or put
 * a salt-shaped lookup in a client package.
 *
 * Specs are excluded: this file names the forbidden strings in its assertions.
 */
describe("browser-safe surface", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const sources = readdirSync(dir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"),
  );

  it("has production sources to scan", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it("does not import node: APIs or read process.env", () => {
    for (const file of sources) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/\bfrom ["']node:/);
      // Require the property-access form so comments can name `process.env`
      // without failing the scan.
      expect(source, file).not.toMatch(/\bprocess\.env\./);
      expect(source, file).not.toContain("require(\"crypto\")");
      expect(source, file).not.toContain("require('crypto')");
    }
  });
});
