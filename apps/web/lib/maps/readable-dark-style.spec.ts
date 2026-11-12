import type { LayerSpecification, StyleSpecification } from "maplibre-gl";
import { describe, expect, it } from "vitest";
import { readableDarkStyle } from "@/lib/maps/readable-dark-style";

/** The stock layers this cares about, trimmed to what it reads. */
function stockStyle(): StyleSpecification {
  return {
    version: 8,
    sources: { openmaptiles: { type: "vector", url: "https://x/planet" } },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "rgb(12,12,12)" },
      },
      {
        id: "building",
        type: "fill",
        source: "openmaptiles",
        "source-layer": "building",
        paint: { "fill-antialias": true, "fill-color": "rgb(10,10,10)" },
      },
      {
        id: "highway_name_other",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "transportation_name",
        paint: { "text-color": "rgba(80, 78, 78, 1)" },
      },
      {
        id: "place_city",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
        paint: { "text-color": "rgb(101,101,101)" },
      },
      {
        id: "something_new",
        type: "background",
        paint: { "background-color": "red" },
      },
    ],
  };
}

function layer(style: StyleSpecification, id: string) {
  return style.layers.find((l) => l.id === id) as
    (LayerSpecification & { paint?: Record<string, unknown> }) | undefined;
}

/** Relative luminance of a #rrggbb color, 0 to 1. */
function luminance(hex: unknown): number {
  const value = String(hex);
  const channels = [1, 3, 5].map((i) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

describe("readableDarkStyle", () => {
  it("draws buildings lighter than the ground, with an edge", () => {
    const style = readableDarkStyle(stockStyle());
    const ground = layer(style, "background")?.paint?.["background-color"];
    const building = layer(style, "building")?.paint;
    expect(luminance(building?.["fill-color"])).toBeGreaterThan(
      luminance(ground) * 1.5,
    );
    expect(building?.["fill-outline-color"]).toBeDefined();
    // Keeps the stock paint it doesn't override.
    expect(building?.["fill-antialias"]).toBe(true);
  });

  it("brightens road and place names", () => {
    const style = readableDarkStyle(stockStyle());
    for (const id of ["highway_name_other", "place_city"]) {
      expect(
        luminance(layer(style, id)?.paint?.["text-color"]),
      ).toBeGreaterThan(0.3);
    }
  });

  it("adds building and place names under the road names, once", () => {
    const once = readableDarkStyle(stockStyle());
    const twice = readableDarkStyle(once);
    const ids = twice.layers.map((l) => l.id);
    expect(ids.filter((id) => id === "poi_name")).toHaveLength(1);
    expect(ids.indexOf("poi_name")).toBe(ids.indexOf("highway_name_other") - 1);
  });

  it("leaves layers it doesn't know as they are", () => {
    const style = readableDarkStyle(stockStyle());
    expect(layer(style, "something_new")?.paint).toEqual({
      "background-color": "red",
    });
  });

  it("does not change the style it was given", () => {
    const stock = stockStyle();
    readableDarkStyle(stock);
    expect(stock).toEqual(stockStyle());
  });
});
