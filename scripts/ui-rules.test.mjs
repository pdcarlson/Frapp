import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

// The UI lint rules (`packages/eslint-config/ui-rules.js`) have little or
// nothing to fire on in the real tree, so `npm run lint` stays green whether
// they work or not: a selector typo, or a later config object that replaces
// `no-restricted-syntax` for a glob, would switch a rule off silently. This
// lints small snippets through each app's real config, as if they were files
// at the given paths, and pins what fires where.
//
// It needs the installed ESLint and both apps' configs, so it runs in CI's
// lint job (`npm run check:ui-rules`).

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const linters = new Map();
function linter(app) {
  if (!linters.has(app)) {
    linters.set(app, new ESLint({ cwd: path.join(REPO_ROOT, "apps", app) }));
  }
  return linters.get(app);
}

/** The UI-rule messages a snippet gets at `file` under `app`'s config. */
async function uiHits(app, file, code) {
  const eslint = linter(app);
  const filePath = path.join(REPO_ROOT, "apps", app, file);
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages
    .filter((m) => m.ruleId === "no-restricted-syntax")
    .map((m) => m.message);
}

const has = (hits, words) => hits.some((m) => m.includes(words));

const WEB_FILE = "components/zz-ui-rules-probe.tsx";
const MOBILE_FILE = "components/zz-ui-rules-probe.tsx";

test("web: each UI rule fires", async () => {
  const cases = [
    ['export const A = () => <p title="Party 🎉">x</p>;', "No emoji"],
    ["export const A = () => <p>Done ✅</p>;", "No emoji"],
    ['export const t = () => toast("Saved \\u{1F389}");', "No emoji"],
    ["export const t = (x: string) => `${x} \\u{1F525}`;", "No emoji"],
    ['export const A = () => <input type="time" />;', "native date or time"],
    ['export const A = () => <Input type={"date"} />;', "native date or time"],
    ["export const A = () => <select />;", "native <select>"],
    ['export const f = () => window.confirm("sure?");', "browser confirm"],
    ['export const f = () => globalThis.alert("x");', "browser confirm"],
    ['export const f = () => prompt("x");', "browser confirm"],
    [
      'export const A = () => <div className="z-50 max-h-[--radix-select-content-available-height]" />;',
      "bare --variable",
    ],
    ['export const c = cn("p-1", "data-[x]:origin-[--o]");', "bare --variable"],
    ["export const c = (x: string) => `${x} bg-[--accent]`;", "bare --variable"],
    ['export const c = "bg-[color:--accent] w-[length:--w]";', "bare --variable"],
  ];
  for (const [code, words] of cases) {
    const hits = await uiHits("web", WEB_FILE, code);
    assert.ok(has(hits, words), `expected "${words}" for: ${code}\n${hits}`);
  }
});

test("web: what stays legal", async () => {
  const cases = [
    "export const A = () => <p>Done ✓ → © •</p>;",
    'export const A = () => <input type="text" />;',
    // The local name callers give useConfirmDialog's function.
    "export const f = async (confirm: () => Promise<boolean>) => confirm();",
    // Tailwind 4's spellings of a variable value.
    'export const A = () => <div className="max-h-(--h) origin-[var(--o)] bg-[color:var(--a)] data-[state=open]:p-1" />;',
  ];
  for (const code of cases) {
    const hits = await uiHits("web", WEB_FILE, code);
    assert.deepEqual(hits, [], `expected nothing for: ${code}`);
  }
});

test("web: a spec may hold members' emoji and quoted bare-variable classes, and nothing else", async () => {
  const spec = "components/zz-ui-rules-probe.spec.tsx";
  assert.deepEqual(
    await uiHits("web", spec, 'export const r = "\u{1F44D}";'),
    [],
  );
  assert.ok(
    has(
      await uiHits("web", spec, "export const A = () => <select />;"),
      "native <select>",
    ),
  );
  assert.deepEqual(
    await uiHits("web", spec, 'export const bad = "bg-[--accent]";'),
    [],
  );
});

test("web: a grandfathered file is excused from its one rule only", async () => {
  const file = "components/chat/schedule-send.tsx";
  assert.deepEqual(
    await uiHits("web", file, 'export const A = () => <input type="date" />;'),
    [],
  );
  assert.ok(
    has(
      await uiHits("web", file, "export const A = () => <p>Hi 🎉</p>;"),
      "No emoji",
    ),
  );
});

test("mobile: emoji fires in screens and the keyboard module, not in specs", async () => {
  const code = 'export const label = "Live \u{26A1}";';
  assert.ok(has(await uiHits("mobile", MOBILE_FILE, code), "No emoji"));
  assert.ok(has(await uiHits("mobile", "lib/keyboard.tsx", code), "No emoji"));
  assert.deepEqual(
    await uiHits("mobile", "components/zz-ui-rules-probe.spec.tsx", code),
    [],
  );
});

test("mobile: the native-module guard still fires beside the UI rules", async () => {
  const code = 'export const load = () => import("expo-audio");';
  for (const file of [MOBILE_FILE, "components/zz-ui-rules-probe.spec.tsx"]) {
    assert.ok(
      has(await uiHits("mobile", file, code), "non-Expo-Go native module"),
      file,
    );
  }
});
