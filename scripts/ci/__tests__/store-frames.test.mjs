import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FRAME_LAYOUTS,
  STORE_FRAMES,
  composeProblems,
  frameCopyProblems,
  frameText,
  stripHtml,
} from "../../demo/store-frames.mjs";
import {
  GOOGLE_PLAY_PRESET,
  PLAY_SCREENSHOT_LIMITS,
} from "../../demo/store-screenshots.mjs";

test("the set is a count both stores take, one frame per slug, in slug order", () => {
  const { minCount, maxCount } = PLAY_SCREENSHOT_LIMITS;
  assert.ok(STORE_FRAMES.length >= minCount && STORE_FRAMES.length <= maxCount);
  const slugs = STORE_FRAMES.map((f) => f.slug);
  assert.equal(new Set(slugs).size, slugs.length, "slugs are unique");
  assert.deepEqual(
    [...slugs].sort(),
    slugs,
    "the numbered slugs are the upload order",
  );
});

test("every caption passes the listing copy rules", () => {
  assert.deepEqual(STORE_FRAMES.flatMap(frameCopyProblems), []);
});

test("the copy rules refuse Signet and ranking or price wording", () => {
  const frame = (sub) => ({
    slug: "x",
    eyebrow: "Chat",
    title: "A <em>b</em>",
    sub,
  });
  assert.equal(
    frameCopyProblems(frame("Signet keeps your chapter together")).length,
    1,
  );
  assert.equal(frameCopyProblems(frame("The #1 chapter app")).length, 1);
  assert.equal(frameCopyProblems(frame("Now 10% off")).length, 1);
  for (const claim of [
    "Award-winning",
    "Rated No. 1",
    "Number one for chapters",
    "Top chapter app",
    "On sale now",
  ]) {
    assert.equal(frameCopyProblems(frame(claim)).length, 1, claim);
  }
  assert.deepEqual(frameCopyProblems(frame("Know what's on this week")), []);
  assert.deepEqual(
    frameCopyProblems(frame("See your points and your rank, on top of it all")),
    [],
  );
});

test("framing refuses captures that don't match the frames one for one", () => {
  const slugs = STORE_FRAMES.map((f) => f.slug);
  assert.deepEqual(composeProblems(slugs), []);
  assert.equal(
    composeProblems(slugs.slice(1)).length,
    1,
    "a frame with no capture",
  );
  assert.equal(
    composeProblems([...slugs].reverse()).length,
    1,
    "captures in another order",
  );
});

test("every lifted card lands inside its frame, and a card moved up to fit leaves a blanked spot", () => {
  for (const layout of FRAME_LAYOUTS) {
    const { height: H } = layout.preset.viewport;
    const html = stripHtml(layout, "/tmp/raw");
    const sections = html.split('<section class="frame">').slice(1);
    assert.equal(sections.length, STORE_FRAMES.length);
    for (const [i, section] of sections.entries()) {
      const { slug, callout } = STORE_FRAMES[i];
      const card = section.match(
        /class="callout" style="width:[\d.]+px;height:([\d.]+)px;top:([\d.-]+)px/,
      );
      assert.equal(
        Boolean(card),
        Boolean(callout),
        `${layout.preset.name} ${slug}: card`,
      );
      if (!card) continue;
      const [h, top] = [Number(card[1]), Number(card[2])];
      assert.ok(
        top >= 0 && top + h <= H,
        `${layout.preset.name} ${slug}: card runs off the frame`,
      );
      const hole = section.match(/class="hole" style="top:([\d.]+)px/);
      if (hole)
        assert.ok(
          Number(hole[1]) > top,
          `${layout.preset.name} ${slug}: hole above the card`,
        );
    }
  }
  // The Play frame is short enough that the check-in card must move up, so the
  // hole path is live there and not only on paper.
  const play = FRAME_LAYOUTS.find((l) => l.preset === GOOGLE_PLAY_PRESET);
  assert.ok(stripHtml(play, "/tmp/raw").includes('class="hole"'));
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
  assert.equal(
    html.match(/<section class="frame">/g).length,
    STORE_FRAMES.length,
  );
  assert.match(
    html,
    new RegExp(
      `width: ${GOOGLE_PLAY_PRESET.viewport.width * STORE_FRAMES.length}px`,
    ),
  );
});
