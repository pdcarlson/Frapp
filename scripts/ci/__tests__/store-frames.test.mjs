import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FRAME_LAYOUTS,
  STORE_FRAMES,
  frameCopyProblems,
  frameText,
  stripHtml,
} from "../../demo/store-frames.mjs";
import { GOOGLE_PLAY_PRESET, PLAY_SCREENSHOT_LIMITS } from "../../demo/store-screenshots.mjs";

test("the set is a count both stores take, one frame per slug, in slug order", () => {
  const { minCount, maxCount } = PLAY_SCREENSHOT_LIMITS;
  assert.ok(STORE_FRAMES.length >= minCount && STORE_FRAMES.length <= maxCount);
  const slugs = STORE_FRAMES.map((f) => f.slug);
  assert.equal(new Set(slugs).size, slugs.length, "slugs are unique");
  assert.deepEqual([...slugs].sort(), slugs, "the numbered slugs are the upload order");
});

test("every caption passes the listing copy rules", () => {
  assert.deepEqual(STORE_FRAMES.flatMap(frameCopyProblems), []);
});

test("the copy rules refuse Signet and ranking or price wording", () => {
  const frame = (sub) => ({ slug: "x", eyebrow: "Chat", title: "A <em>b</em>", sub });
  assert.equal(frameCopyProblems(frame("Signet keeps your chapter together")).length, 1);
  assert.equal(frameCopyProblems(frame("The #1 chapter app")).length, 1);
  assert.equal(frameCopyProblems(frame("Now 10% off")).length, 1);
  assert.deepEqual(frameCopyProblems(frame("Know what's on this week")), []);
});

test("frame text drops the markup that marks the gold words", () => {
  assert.equal(frameText(STORE_FRAMES[0]).includes("<"), false);
});

test("every lifted card is cut from inside the capture", () => {
  for (const { slug, callout } of STORE_FRAMES) {
    if (!callout) continue;
    const { x, y, w, h } = callout;
    for (const v of [x, y, w, h]) assert.ok(v >= 0 && v <= 1, `${slug}: ${v}`);
    assert.ok(x + w <= 1 && y + h <= 1, `${slug}: runs off the capture`);
  }
});

test("there is one layout per store, and the strip is one frame wide per screen", () => {
  assert.equal(FRAME_LAYOUTS.length, 2);
  const play = FRAME_LAYOUTS.find((l) => l.preset === GOOGLE_PLAY_PRESET);
  const html = stripHtml(play, "/tmp/raw");
  assert.equal(html.match(/<section class="frame">/g).length, STORE_FRAMES.length);
  assert.match(html, new RegExp(`width: ${GOOGLE_PLAY_PRESET.viewport.width * STORE_FRAMES.length}px`));
});
