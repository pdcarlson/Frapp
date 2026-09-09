// Locks the customer-visible auth wordmark and tagline on Signet.
//
// WHY THIS EXISTS. Mobile sign-in and the web pre-auth column already say
// Signet / "Ask your chapter anything." #1950 locks metadata titles only.
// A leftover sweep can put Frapp back in the visible wordmark without that
// walker noticing. #1955.
//
// SCOPE. The rendered title/subtitle props (web) and title/subtitle Text
// nodes (mobile). Do not scan whole web auth files for Frapp — those files
// keep historical Frapp comments. Mobile sign-in has none, so a file-wide
// Frapp ban is safe there. Leave app.json name / Settings → Frapp on 1829.
// Leave landing Frapp copy on 1954.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const MOBILE_SIGN_IN = "apps/mobile/app/(auth)/sign-in.tsx";
const WEB_HOME = "apps/web/app/page.tsx";
const WEB_SIGN_IN = "apps/web/app/sign-in/page.tsx";
const TAGLINE = "Ask your chapter anything.";

function readRepo(rel) {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function literal(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

const WEB_TITLE_SIGNET = /title=(?:["']Signet["']|\{\s*["']Signet["']\s*\})/;
const WEB_TITLE_FRAPP = /title=(?:["']Frapp["']|\{\s*["']Frapp["']\s*\})/;
const WEB_SUBTITLE_TAGLINE = new RegExp(
  `subtitle=(?:["']${literal(TAGLINE)}["']|\\{\\s*["']${literal(TAGLINE)}["']\\s*\\})`,
);
const WEB_SUBTITLE_FRAPP = /subtitle=(?:["'][^"']*\bFrapp\b[^"']*["']|\{\s*["'][^"']*\bFrapp\b[^"']*["']\s*\})/;

test("mobile sign-in wordmark is Signet", () => {
  const source = readRepo(MOBILE_SIGN_IN);
  assert.match(source, /<Text style=\{styles\.title\}>Signet<\/Text>/);
  assert.match(
    source,
    new RegExp(`<Text style=\\{styles\\.subtitle\\}>${literal(TAGLINE)}</Text>`),
  );
  assert.doesNotMatch(source, /<Text style=\{styles\.title\}>Frapp<\/Text>/);
  assert.doesNotMatch(
    source,
    /\bFrapp\b/,
    `${MOBILE_SIGN_IN} has no historical Frapp comments; customer copy must not name Frapp`,
  );
});

test("web pre-auth wordmark is Signet", () => {
  const home = readRepo(WEB_HOME);
  const signIn = readRepo(WEB_SIGN_IN);

  for (const [rel, source] of [
    [WEB_HOME, home],
    [WEB_SIGN_IN, signIn],
  ]) {
    assert.match(source, WEB_TITLE_SIGNET, `${rel} must set title Signet`);
    assert.match(source, WEB_SUBTITLE_TAGLINE, `${rel} must set the Signet tagline`);
    assert.doesNotMatch(source, WEB_TITLE_FRAPP, `${rel} must not set title Frapp`);
    assert.doesNotMatch(
      source,
      WEB_SUBTITLE_FRAPP,
      `${rel} must not set a Frapp subtitle`,
    );
  }

  assert.equal(
    countMatches(home, /title=(?:["']Signet["']|\{\s*["']Signet["']\s*\})/g),
    1,
    `${WEB_HOME} must keep exactly one Signet wordmark`,
  );
  assert.equal(
    countMatches(home, new RegExp(WEB_SUBTITLE_TAGLINE.source, "g")),
    1,
    `${WEB_HOME} must keep exactly one Signet tagline`,
  );
  assert.equal(
    countMatches(signIn, /title=(?:["']Signet["']|\{\s*["']Signet["']\s*\})/g),
    2,
    `${WEB_SIGN_IN} must keep the form and Suspense fallback wordmarks`,
  );
  assert.equal(
    countMatches(signIn, new RegExp(WEB_SUBTITLE_TAGLINE.source, "g")),
    2,
    `${WEB_SIGN_IN} must keep the form and Suspense fallback taglines`,
  );
});
