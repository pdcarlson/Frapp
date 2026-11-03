// Pins ./helpers/copy-lines.mjs, the rule frapp-naming reads copy by: which lines
// of a source file are copy, and what a download name looks like.
//
// Every input in "nothing on an earlier line" hid real copy from the scanner
// the rule replaced. Each line is judged alone now, so what came before it
// can't matter, and these keep it that way.

import { test } from "node:test";
import assert from "node:assert/strict";

import { copyMatches, SIGNET_DOWNLOAD_NAME } from "./helpers/copy-lines.mjs";

const hits = (files, pattern = /\bSignet\b/g) => copyMatches(files, pattern).map(({ rel, line }) => `${rel}:${line}`);
const downloads = (files) => hits(files, SIGNET_DOWNLOAD_NAME);

test("a Signet string, JSX text or JSON value is copy", () => {
  const files = [
    { rel: "a.ts", source: 'const reason = "Signet needs your photos.";\n' },
    { rel: "b.tsx", source: "<Text>\n  Return to Signet to resume.\n</Text>\n" },
    { rel: "c.json", source: '{ "expo": { "name": "Signet" } }\n' },
    { rel: "d.ts", source: 'const id = "PRODID:-//Signet//Chapter Events//EN";\n' },
  ];
  assert.deepEqual(hits(files), ["a.ts:1", "b.tsx:2", "c.json:1", "d.ts:1"]);
});

test("nothing on an earlier line can hide copy on a code line", () => {
  const files = [
    { rel: "a.ts", source: 'const accept = "image/*";\nconst r = "Signet needs your photos.";\n' },
    { rel: "b.json", source: '{\n  "assetBundlePatterns": ["**/*"],\n  "x": "Signet reads it."\n}\n' },
    { rel: "c.ts", source: 'const clean = url.replace(/\\/*$/, "");\nconst r = "Signet";\n/** doc */\n' },
    { rel: "d.ts", source: 'const re = /`/;\nconst g = `**/*.ts`;\nconst t = "Signet";\n' },
    { rel: "e.tsx", source: "<Text>\n  Upload files matching\n  /* or pick one\n</Text>\n<Text>Return to Signet.</Text>\n" },
    { rel: "f.tsx", source: "<Text>Press ` then</Text>\nconst css = `\n  /* all\n`;\n<Text>Return to Signet.</Text>\n" },
    { rel: "g.tsx", source: "<Text>Don't worry</Text><Picker accept={'image/*'} />\n<Text>Return to Signet.</Text>\n" },
    { rel: "h.ts", source: 'const accept = x//TODO: restore /* glob\nexport const r = "Signet";\n' },
    { rel: "i.ts", source: 'const pats = [\n  /x/, // plain\n  /`/g,\n];\nconst t = "Signet";\n' },
  ];
  assert.deepEqual(hits(files), ["a.ts:2", "b.json:3", "c.ts:2", "d.ts:3", "e.tsx:5", "f.tsx:5", "g.tsx:2", "h.ts:2", "i.ts:5"]);
});

test("a comment earlier on the same line exempts nothing after it closes", () => {
  const files = [
    { rel: "a.tsx", source: "<Text>\n  {/* keep on one line */}Tap and//or hold to open Signet.\n</Text>\n" },
    { rel: "b.tsx", source: "/* x */ <Text>Type // to reply in Signet</Text>\n" },
    { rel: "c.ts", source: ' * end of doc */ const t = "Signet";\n' },
    { rel: "d.tsx", source: "<Text>\n  Help lives at https://frapp.live/help. Return to Signet.\n</Text>\n" },
  ];
  assert.deepEqual(hits(files), ["a.tsx:2", "b.tsx:1", "c.ts:1", "d.tsx:2"]);
});

test("every JavaScript line break ends a comment line", () => {
  for (const brk of ["\r", "\r\n", "\u2028", "\u2029"]) {
    assert.deepEqual(hits([{ rel: "a.tsx", source: `// design note${brk}<Text>Welcome to Signet</Text>\n` }]), ["a.tsx:2"], JSON.stringify(brk));
    assert.deepEqual(downloads([{ rel: "a.ts", source: `// note${brk}const f = "signet-events.ics";\n` }]), ["a.ts:2"], JSON.stringify(brk));
  }
});

test("a design-system note names Signet only in the comment its line starts with", () => {
  const allowed = [
    { rel: "a.ts", source: 'import { SignetTokens } from "@repo/theme/signet";\n' },
    { rel: "b.ts", source: "// Signet gold, never the chapter accent.\n" },
    { rel: "c.ts", source: "/**\n * Signet is dark-only by design.\n */\n" },
    { rel: "d.tsx", source: "{/* Static: Signet is dark-only */}\n" },
    { rel: "e.ts", source: "/* Signet tokens */\n" },
    { rel: "f.tsx", source: 'import { SignetCrest } from "../components/signet-crest";\n<SignetCrest className="h-8 w-8" />\nfill={SIGNET_CREST_GOLD}\n' },
    { rel: "g.tsx", source: 'className="bg-[var(--signet-gold)]"\nsrc="/brand/signet-emblem-B.png"\n' },
  ];
  assert.deepEqual(hits(allowed), []);
  // After code, or on a star-less continuation line, it reports: fail closed.
  const reported = [
    { rel: "a.ts", source: "x; // Signet gold\n" },
    { rel: "b.ts", source: "foo(); /* Signet gold */ bar();\n" },
    { rel: "c.tsx", source: "{/* The\n    Signet gold ring */}\n" },
    { rel: "d.ts", source: 'color: "#131211", // the Signet stage\n' },
  ];
  assert.deepEqual(hits(reported), ["a.ts:1", "b.ts:1", "c.tsx:2", "d.ts:1"]);
});

test("a signet- download name is copy, a design-system file name is not", () => {
  assert.deepEqual(
    downloads([
      { rel: "a.ts", source: 'const name = `${slug || "signet-event"}.ics`;\n' },
      { rel: "b.ts", source: 'const icon = require("./signet-emblem-B.png");\n' },
      { rel: "c.ts", source: '/* was signet-events */ const name = "signet-dues.ics";\n' },
      { rel: "d.ts", source: "// the old fallback was signet-event.ics\n" },
      { rel: "e.ts", source: "downloadBlob(blob, `signet-${filenamePrefix}-${day}.csv`);\n" },
      // The `.ics` is on the next line, out of sight: why frapp-naming pins this fallback by value.
      { rel: "f.ts", source: '.replace(/^-+|-+$/g, "") || "signet-event";\ndownloadBlob(icsBlob, `${slug}.ics`);\n' },
    ]),
    ["a.ts:1", "c.ts:1", "e.ts:1"],
  );
});

test("the blind spot: copy on a line that starts with comment punctuation", () => {
  // Pinned so that closing or widening it is a deliberate change.
  assert.deepEqual(
    hits([
      { rel: "a.ts", source: "const help = `\n* Signet reads your calendar\n`;\n" },
      { rel: "b.tsx", source: "<Text>\n  // Signet, in JSX text\n</Text>\n" },
    ]),
    [],
  );
});
