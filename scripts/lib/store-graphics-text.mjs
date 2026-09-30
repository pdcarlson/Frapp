/**
 * The text half of the feature graphic, run as a child process by
 * `renderTexts` in `store-graphics.mjs`. Not a module to import.
 *
 * It exists as its own process because fontconfig reads `FONTCONFIG_FILE`
 * once, at its first use in a process, and keeps that config for the life of
 * the process. The parent starts this one with the hermetic config already in
 * its environment, so every render here sees only the vendored Figtree,
 * whatever the parent or the host did before.
 *
 * stdin: JSON { faces: [path, ...], texts: [{ text, font, fontfile, color }] }
 * stdout: JSON [{ png: base64, width, height }], one per text, in order
 */
import sharp from "sharp";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const { faces, texts } = JSON.parse(input);

// `sharp` registers a `fontfile` on the render that names it. Register every
// face before the first real render, so no font lookup ever runs with a face
// missing.
for (const fontfile of faces) {
  await sharp({ text: { text: "x", font: "Figtree 12", fontfile } })
    .png()
    .toBuffer();
}

const out = [];
for (const { text, font, fontfile, color } of texts) {
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="${color}">${text}</span>`,
      font,
      fontfile,
      rgba: true,
      dpi: 72, // 1pt = 1px, so a font size is a pixel size
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  out.push({
    png: data.toString("base64"),
    width: info.width,
    height: info.height,
  });
}
process.stdout.write(JSON.stringify(out));
