import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LAUNCH_BACKGROUND, LAUNCH_EMBLEM_SIZE } from "./launch-look";

const appJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../app.json"), "utf8"),
) as { expo: { plugins: unknown[] } };

const splash = (
  appJson.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
  ) as [string, { image: string; backgroundColor: string; imageWidth: number }]
)[1];

describe("the launch logo draws what the native splash draws (#5449)", () => {
  it("on the splash's background", () => {
    expect(LAUNCH_BACKGROUND).toBe(splash.backgroundColor);
  });

  it("at the splash's size", () => {
    expect(LAUNCH_EMBLEM_SIZE).toBe(splash.imageWidth);
  });

  it("from the splash's own image", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "launch-look.ts"),
      "utf8",
    );
    const required = /require\("([^"]+)"\)/.exec(source)?.[1];
    expect(required && path.resolve(__dirname, required)).toBe(
      path.resolve(__dirname, "../..", splash.image),
    );
  });
});
