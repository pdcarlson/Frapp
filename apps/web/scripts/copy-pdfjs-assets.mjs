#!/usr/bin/env node
/**
 * Copies the data pdf.js fetches at runtime into `public/pdfjs/<version>/`,
 * for backwork bulk upload (#3499).
 *
 * pdf.js decodes JPEG 2000 and JBIG2 images, the formats most copier scans
 * use, with WebAssembly it loads from `wasmUrl`. Without these files a scanned
 * exam renders blank, and flattening would upload a blank page. Fonts a PDF
 * doesn't embed, CJK character maps and ICC colour profiles load the same way.
 *
 * The folder is versioned so a pdfjs-dist bump can't serve a stale decoder
 * from a cached path, and it's gitignored: `pdfjs-dist` in node_modules is the
 * only copy that's tracked. Because it isn't tracked, the root `turbo.json`
 * lists `public/pdfjs/**` as a build output, or a cached build would deploy
 * without it. `lib/backwork-bulk/pdf.ts` builds the same URL from
 * `pdfjs.version`.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(web, "package.json"));
const pkgDir = dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

const outRoot = join(web, "public", "pdfjs");
const out = join(outRoot, version);
const FOLDERS = ["wasm", "standard_fonts", "cmaps", "iccs"];

// Drop other versions' folders so an old decoder never lingers in a deploy.
if (existsSync(outRoot)) {
  for (const entry of readdirSync(outRoot)) {
    if (entry !== version) rmSync(join(outRoot, entry), { recursive: true, force: true });
  }
}
mkdirSync(out, { recursive: true });
for (const folder of FOLDERS) {
  cpSync(join(pkgDir, folder), join(out, folder), { recursive: true });
}
console.log(`copied pdfjs-dist ${version} data -> public/pdfjs/${version}/`);
