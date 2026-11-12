"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
} from "maplibre-gl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection } from "geojson";
import {
  destinationPoint,
  distanceMeters,
  type ZonePoint,
} from "@repo/validation";
import { MAP_STYLE_URL } from "@/lib/maps/map-provider";
import { readableDarkStyle } from "@/lib/maps/readable-dark-style";
import {
  clampRadius,
  draftPolygon,
  type ZoneDraft,
} from "@/components/geofences/zone-shape";

/*
  MapLibre finds its worker next to its own module at runtime, which a bundle
  moves. Naming the file with `new URL(..., import.meta.url)` makes the
  bundler emit it and hand back its served URL.
*/
let workerUrlSet = false;
function ensureWorkerUrl() {
  if (workerUrlSet) return;
  setWorkerUrl(
    new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href,
  );
  workerUrlSet = true;
}

export type ZoneMapFocus = {
  center: ZonePoint;
  /** Changes on every request, so the same place can be flown to twice. */
  key: number;
};

type OtherZone = { id: string; coordinates: ZonePoint[] | null };

type Props = {
  draft: ZoneDraft;
  onChange: (next: ZoneDraft) => void;
  /** The chapter's other zones, drawn faintly so a new one isn't drawn on top. */
  otherZones: readonly OtherZone[];
  /** Fly here: a search result, or the campus on first open. */
  focus: ZoneMapFocus | null;
  disabled?: boolean;
  /** Told when the map can't draw (no WebGL, tiles unreachable). */
  onUnavailable?: () => void;
};

const DRAFT_SOURCE = "zone-draft";
const OTHERS_SOURCE = "zone-others";
/** The continental US, for a chapter with no zones and no campus found yet. */
const FALLBACK_VIEW = { center: [-96, 38] as [number, number], zoom: 3 };
/** Close enough to see a building and its doors. */
const PLACE_ZOOM = 17;

function ring(points: readonly ZonePoint[]): [number, number][] {
  const coords = points.map((p) => [p.lng, p.lat] as [number, number]);
  const first = coords[0];
  return coords.length >= 3 && first ? [...coords, first] : coords;
}

function draftFeatures(draft: ZoneDraft): FeatureCollection {
  const polygon = draftPolygon(draft);
  const features: Feature[] = [];
  if (polygon.length >= 3) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [ring(polygon)] },
    });
  } else if (polygon.length === 2) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: ring(polygon) },
    });
  }
  return { type: "FeatureCollection", features };
}

function otherFeatures(zones: readonly OtherZone[]): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones
      .filter((zone) => (zone.coordinates?.length ?? 0) >= 3)
      .map((zone) => ({
        type: "Feature",
        properties: { id: zone.id },
        geometry: {
          type: "Polygon",
          coordinates: [ring(zone.coordinates ?? [])],
        },
      })),
  };
}

function boundsOf(points: readonly ZonePoint[]): LngLatBounds | null {
  if (points.length === 0) return null;
  const bounds = new LngLatBounds();
  for (const p of points) bounds.extend([p.lng, p.lat]);
  return bounds;
}

/** The chapter accent, read off the page so a chapter's color carries. */
function accentColor(): string {
  if (typeof window === "undefined") return "#DDB844";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  return value || "#DDB844";
}

function handle(kind: "vertex" | "center" | "radius", label: string) {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", label);
  el.dataset.zoneHandle = kind;
  el.className =
    kind === "radius"
      ? "h-3.5 w-3.5 cursor-ew-resize rounded-full border-2 border-background bg-foreground shadow"
      : kind === "center"
        ? "h-4 w-4 cursor-grab rounded-full border-2 border-background bg-primary shadow"
        : "h-3 w-3 cursor-grab rounded-full border-2 border-background bg-primary shadow";
  return el;
}

/**
 * The map an officer draws a study zone on. Circle: click to drop the pin,
 * drag the pin to move it and the white dot to size it. Outline: click each
 * corner in turn, drag a corner to move it, right-click a corner to remove it.
 *
 * Controlled: it draws `draft` and reports every edit through `onChange`, so
 * the form beside it (the radius field, Undo, the save check) and the map
 * never disagree.
 */
export function ZoneMap({
  draft,
  onChange,
  otherZones,
  focus,
  disabled = false,
  onUnavailable,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);

  // The latest props for the map's own listeners, which are bound once.
  // Declared first, so it lands before the effects below read it.
  const latest = useRef({ draft, onChange, disabled });
  useLayoutEffect(() => {
    latest.current = { draft, onChange, disabled };
  });

  // What the map opens on: the shape being edited, else the other zones.
  const initialRef = useRef({ draft, otherZones });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let map: MapLibreMap;
    try {
      ensureWorkerUrl();
      map = new MapLibreMap({
        container,
        style: MAP_STYLE_URL,
        // The stock dark style buries buildings and names; this re-inks it.
        transformStyle: (_previous, next) => readableDarkStyle(next),
        center: FALLBACK_VIEW.center,
        zoom: FALLBACK_VIEW.zoom,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
    } catch {
      // No WebGL, most often: say so instead of an empty box.
      onUnavailable?.();
      return;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.doubleClickZoom.disable();
    // A click places a point, so the pointer says so; panning is still a drag.
    map.getCanvas().style.cursor = "crosshair";

    const { draft: first, otherZones: others } = initialRef.current;
    const opening =
      boundsOf(draftPolygon(first)) ??
      boundsOf(others.flatMap((zone) => zone.coordinates ?? []));
    if (opening) {
      map.fitBounds(opening, { padding: 48, maxZoom: PLACE_ZOOM, duration: 0 });
    }

    // Before the first load, an error is the style or tiles not arriving (a
    // network block, the service down): the map is unavailable. After it, a
    // tile that fails at the edge of the view is noise.
    let loaded = false;
    map.on("error", () => {
      if (!loaded) onUnavailable?.();
    });

    map.on("load", () => {
      loaded = true;
      const accent = accentColor();
      map.addSource(OTHERS_SOURCE, {
        type: "geojson",
        data: otherFeatures([]),
      });
      map.addLayer({
        id: "zone-others-fill",
        type: "fill",
        source: OTHERS_SOURCE,
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.06 },
      });
      map.addLayer({
        id: "zone-others-line",
        type: "line",
        source: OTHERS_SOURCE,
        paint: {
          "line-color": "#ffffff",
          "line-opacity": 0.35,
          "line-width": 1,
          "line-dasharray": [2, 2],
        },
      });
      map.addSource(DRAFT_SOURCE, {
        type: "geojson",
        data: draftFeatures(latest.current.draft),
      });
      map.addLayer({
        id: "zone-draft-fill",
        type: "fill",
        source: DRAFT_SOURCE,
        paint: { "fill-color": accent, "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: "zone-draft-line",
        type: "line",
        source: DRAFT_SOURCE,
        paint: { "line-color": accent, "line-width": 2 },
      });
      setReady(true);
    });

    map.on("click", (event) => {
      const { draft: current, onChange: emit, disabled: off } = latest.current;
      if (off) return;
      const point = {
        lat: Number(event.lngLat.lat.toFixed(7)),
        lng: Number(event.lngLat.lng.toFixed(7)),
      };
      if (current.mode === "circle") {
        emit({ ...current, center: point });
      } else {
        emit({ ...current, points: [...current.points, point] });
      }
    });

    return () => {
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // Bound once: the map lives as long as the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The other zones, once the style is in.
  useEffect(() => {
    const source = mapRef.current?.getSource(OTHERS_SOURCE) as
      GeoJSONSource | undefined;
    source?.setData(otherFeatures(otherZones));
  }, [otherZones, ready]);

  // The shape and its handles, on every edit.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(DRAFT_SOURCE) as GeoJSONSource | undefined)?.setData(
      draftFeatures(draft),
    );

    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];
    const add = (marker: Marker) => {
      marker.addTo(map);
      markersRef.current.push(marker);
    };

    if (draft.mode === "circle" && draft.center) {
      const center = draft.center;
      const centerMarker = new Marker({
        element: handle("center", "Zone center. Drag to move."),
        draggable: !disabled,
      }).setLngLat([center.lng, center.lat]);
      const edge = destinationPoint(center, draft.radius_m, 90);
      const radiusMarker = new Marker({
        element: handle("radius", "Zone edge. Drag to resize."),
        draggable: !disabled,
      }).setLngLat([edge.lng, edge.lat]);

      centerMarker.on("drag", () => {
        const at = centerMarker.getLngLat();
        const next = { lat: at.lat, lng: at.lng };
        const nextEdge = destinationPoint(
          next,
          latest.current.draft.radius_m,
          90,
        );
        radiusMarker.setLngLat([nextEdge.lng, nextEdge.lat]);
        (map.getSource(DRAFT_SOURCE) as GeoJSONSource | undefined)?.setData(
          draftFeatures({ ...latest.current.draft, center: next }),
        );
      });
      centerMarker.on("dragend", () => {
        const at = centerMarker.getLngLat();
        latest.current.onChange({
          ...latest.current.draft,
          center: {
            lat: Number(at.lat.toFixed(7)),
            lng: Number(at.lng.toFixed(7)),
          },
        });
      });
      const radiusFrom = () => {
        const at = radiusMarker.getLngLat();
        return clampRadius(
          distanceMeters(center, { lat: at.lat, lng: at.lng }),
        );
      };
      radiusMarker.on("drag", () => {
        (map.getSource(DRAFT_SOURCE) as GeoJSONSource | undefined)?.setData(
          draftFeatures({ ...latest.current.draft, radius_m: radiusFrom() }),
        );
      });
      radiusMarker.on("dragend", () => {
        latest.current.onChange({
          ...latest.current.draft,
          radius_m: Math.round(radiusFrom()),
        });
      });
      // A click on a handle is not a click on the map: the pin stays put.
      for (const marker of [centerMarker, radiusMarker]) {
        marker
          .getElement()
          .addEventListener("click", (event) => event.stopPropagation());
      }
      add(centerMarker);
      add(radiusMarker);
    }

    if (draft.mode === "outline") {
      draft.points.forEach((point, index) => {
        const element = handle(
          "vertex",
          `Corner ${index + 1}. Drag to move, right-click to remove.`,
        );
        element.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          if (latest.current.disabled) return;
          const current = latest.current.draft;
          latest.current.onChange({
            ...current,
            points: current.points.filter((_, i) => i !== index),
          });
        });
        // A click on a corner is not a click on the map: no new corner.
        element.addEventListener("click", (event) => event.stopPropagation());
        const marker = new Marker({ element, draggable: !disabled }).setLngLat([
          point.lng,
          point.lat,
        ]);
        const moved = () => {
          const at = marker.getLngLat();
          const points = [...latest.current.draft.points];
          points[index] = {
            lat: Number(at.lat.toFixed(7)),
            lng: Number(at.lng.toFixed(7)),
          };
          return { ...latest.current.draft, points };
        };
        marker.on("drag", () => {
          (map.getSource(DRAFT_SOURCE) as GeoJSONSource | undefined)?.setData(
            draftFeatures(moved()),
          );
        });
        marker.on("dragend", () => latest.current.onChange(moved()));
        add(marker);
      });
    }
  }, [draft, ready, disabled]);

  // Fly to a place the officer picked.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.flyTo({
      center: [focus.center.lng, focus.center.lat],
      zoom: Math.max(map.getZoom(), PLACE_ZOOM),
      duration: 800,
    });
  }, [focus]);

  return (
    <div
      ref={containerRef}
      data-testid="zone-map"
      className="h-full min-h-[320px] w-full overflow-hidden rounded-[14px] border border-border bg-card"
    />
  );
}
