import type {
  LayerSpecification,
  StyleSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import { signetDarkTokens } from "@repo/theme/signet";

/**
 * OpenFreeMap's `dark` style, re-inked so an officer can find a building on
 * it without leaning in.
 *
 * As served, the style is a near-black poster: buildings (rgb 10) are darker
 * than the ground (rgb 12), minor roads sit 12 steps above it, labels are
 * rgb 80 to 101, and it names no buildings or places on campus (only towns
 * and suburbs). Picking a study zone means finding one building, so this
 * follows what Google Maps and Apple Maps do in dark mode instead: ground
 * darkest, buildings a clear step lighter with an edge, roads lighter again
 * by importance, water and green space faintly tinted, and building and place
 * names (the library, the union) in readable gray.
 *
 * The grays carry the same faint violet as Signet's surface ladder (the
 * owner's 2026-11-19 ladder, spec/ui/design-system/foundations.md §2; before
 * that they were neutral like the neutral ladder), so the map reads as part of
 * the app rather than a gray poster set into it. The ground is `--surface-1`,
 * a notch above Signet's base so the map reads as a surface, and every other
 * gray leans the way the ladder does: green a touch low, blue a touch high.
 * Labels lean less, as the ladder's text tokens do.
 *
 * Colors are paint overrides keyed by the style's layer ids and types. A
 * layer that stops existing upstream, or changes type, is left stock, so an
 * OpenFreeMap update degrades to the stock look instead of breaking the map.
 * This is written against OpenFreeMap's layer ids and its `openmaptiles`
 * source: swapping MAP_STYLE_URL to another provider means redoing it.
 */

/** Ground, buildings, roads: each step lighter than the one under it. */
const GROUND = signetDarkTokens.color.surface.surface1;

const INK = {
  ground: GROUND,
  green: "#162019",
  water: "#141d27",
  building: "#2c2a32",
  buildingEdge: "#4a4850",
  path: "#312f37",
  minor: "#3b3941",
  majorCasing: "#5e5c64",
  major: "#4c4a52",
  motorwayCasing: "#6c6a72",
  motorway: "#58565e",
  rail: "#3b3941",
  roadLabel: "#b6b4ba",
  placeLabel: "#a5a3a9",
  poiLabel: "#d4d2d8",
  halo: GROUND,
} as const;

type Paint = Record<string, unknown>;
type Override = {
  /** The stock layer's type; a layer of another type is left alone. */
  type: LayerSpecification["type"];
  paint: Paint;
  /** Stock paint properties to drop, such as a pattern that hides the color. */
  drop?: readonly string[];
};

const line = (paint: Paint): Override => ({ type: "line", paint });
const fill = (paint: Paint): Override => ({ type: "fill", paint });
const label = (color: string): Override => ({
  type: "symbol",
  paint: {
    "text-color": color,
    "text-halo-color": INK.halo,
    "text-halo-width": 1.5,
  },
});

const OVERRIDES: Record<string, Override> = {
  background: {
    type: "background",
    paint: { "background-color": INK.ground },
  },
  water: fill({ "fill-color": INK.water }),
  waterway: line({ "line-color": INK.water }),
  water_name: label("#7a8794"),
  landuse_park: fill({ "fill-color": INK.green }),
  // The stock wood pattern is drawn for a light map and hides the color.
  landcover_wood: {
    type: "fill",
    paint: { "fill-color": INK.green },
    drop: ["fill-pattern"],
  },
  building: fill({
    "fill-color": INK.building,
    "fill-outline-color": INK.buildingEdge,
  }),
  road_area_pier: fill({ "fill-color": INK.ground }),
  road_pier: line({ "line-color": INK.ground }),
  highway_path: line({ "line-color": INK.path, "line-opacity": 1 }),
  highway_minor: line({ "line-color": INK.minor, "line-opacity": 1 }),
  highway_major_casing: line({ "line-color": INK.majorCasing }),
  highway_major_inner: line({ "line-color": INK.major }),
  highway_major_subtle: line({ "line-color": INK.major }),
  highway_motorway_casing: line({ "line-color": INK.motorwayCasing }),
  highway_motorway_inner: line({
    "line-color": [
      "interpolate",
      ["linear"],
      ["zoom"],
      5.8,
      "hsla(0,0%,85%,0.53)",
      6,
      INK.motorway,
    ],
  }),
  highway_motorway_subtle: line({ "line-color": INK.motorway }),
  railway: line({ "line-color": INK.rail }),
  railway_minor: line({ "line-color": INK.rail }),
  railway_transit: line({ "line-color": INK.rail }),
  railway_dashline: line({ "line-color": INK.ground }),
  railway_minor_dashline: line({ "line-color": INK.ground }),
  railway_transit_dashline: line({ "line-color": INK.ground }),
  highway_name_other: label(INK.roadLabel),
  highway_name_motorway: label(INK.roadLabel),
};

/** Every `place_*` label (town, suburb, village...). */
const PLACE_LABEL = label(INK.placeLabel);

const POI_LAYER_ID = "poi_name";

/**
 * Names of buildings and places (a library, a dining hall, a quad), from the
 * same tiles. The stock dark style draws none. Text only, no icons: the
 * sprite's icons are drawn for a light map.
 */
const POI_LAYER: SymbolLayerSpecification = {
  id: POI_LAYER_ID,
  type: "symbol",
  source: "openmaptiles",
  "source-layer": "poi",
  minzoom: 15,
  filter: [
    "all",
    ["match", ["geometry-type"], ["MultiPoint", "Point"], true, false],
    ["has", "name"],
    // Busier places appear first, quieter ones as the officer zooms in.
    ["<=", ["get", "rank"], ["step", ["zoom"], 6, 16, 20, 17, 1000]],
  ],
  layout: {
    "text-field": ["coalesce", ["get", "name_en"], ["get", "name"]],
    "text-font": ["Noto Sans Regular"],
    "text-size": ["interpolate", ["linear"], ["zoom"], 15, 11, 18, 13],
    "text-max-width": 8,
    "text-padding": 4,
  },
  paint: {
    "text-color": INK.poiLabel,
    "text-halo-color": INK.halo,
    "text-halo-width": 1.5,
  },
};

function overrideFor(layer: LayerSpecification): Override | undefined {
  if (layer.type === "symbol" && layer.id.startsWith("place_")) {
    return PLACE_LABEL;
  }
  return OVERRIDES[layer.id];
}

function withPaint(layer: LayerSpecification): LayerSpecification {
  const override = overrideFor(layer);
  // A changed type would make the paint invalid, and MapLibre refuses the
  // whole style for one invalid property.
  if (!override || override.type !== layer.type) return layer;
  const paint: Paint = {
    ...(layer as { paint?: Paint }).paint,
    ...override.paint,
  };
  for (const key of override.drop ?? []) delete paint[key];
  return { ...layer, paint } as LayerSpecification;
}

export function readableDarkStyle(
  style: StyleSpecification,
): StyleSpecification {
  const layers = style.layers.map(withPaint);
  if (
    style.sources.openmaptiles &&
    !layers.some((layer) => layer.id === POI_LAYER_ID)
  ) {
    // Under road and place names, so a street name wins a collision.
    const at = layers.findIndex((layer) => layer.id === "highway_name_other");
    layers.splice(at === -1 ? layers.length : at, 0, POI_LAYER);
  }
  return { ...style, layers };
}
