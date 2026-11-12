"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search, Undo2 } from "lucide-react";
import {
  feetToMeters,
  metersToFeet,
  outlineCenter,
  type ZonePoint,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedChoice } from "@/components/ui/segmented";
import { searchPlaces, type PlaceResult } from "@/lib/maps/map-provider";
import { cn } from "@/lib/utils";
import { clampRadius, type ZoneDraft } from "@/components/geofences/zone-shape";
import type { ZoneMapFocus } from "@/components/geofences/zone-map";

/*
  MapLibre is about a megabyte and needs the browser (WebGL, workers), so it
  loads only when an officer opens a zone, never with Chapter settings.
*/
const ZoneMap = dynamic(
  () => import("@/components/geofences/zone-map").then((m) => m.ZoneMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-full min-h-[320px] w-full animate-pulse rounded-[14px] border border-border bg-card" />
    ),
  },
);

type Props = {
  draft: ZoneDraft;
  onChange: (next: ZoneDraft) => void;
  otherZones: readonly { id: string; coordinates: ZonePoint[] | null }[];
  /** The chapter's campus, searched once when there is nothing else to open on. */
  campus?: string | null;
  /** Called with a picked place's name, so an empty Name can take it. */
  onPlacePicked?: (place: PlaceResult) => void;
  disabled?: boolean;
  /** The save check's sentence, shown under the map when the shape isn't done. */
  error?: string | null;
};

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Where a study zone is: search for the place, then draw it as a circle
 * (a pin and a radius) or trace its outline. Google Maps' "measure distance"
 * and Life360's place circles are the patterns an officer already knows: a
 * search box over the map, a pin, a draggable edge.
 *
 * The map fills the space beside the form, and below it on a narrow window.
 */
export function ZonePicker({
  draft,
  onChange,
  otherZones,
  campus,
  onPlacePicked,
  disabled = false,
  error,
}: Props) {
  const searchId = useId();
  const radiusId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searchState, setSearchState] = useState<
    "idle" | "loading" | "empty" | "error"
  >("idle");
  const [highlight, setHighlight] = useState(0);
  const [focus, setFocus] = useState<ZoneMapFocus | null>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const focusKey = useRef(0);

  // Search near what the chapter already has, so "library" means theirs.
  const near = useMemo(
    () =>
      draft.center ??
      outlineCenter(draft.points) ??
      outlineCenter(otherZones.flatMap((zone) => zone.coordinates ?? [])) ??
      undefined,
    [draft.center, draft.points, otherZones],
  );

  // A first zone with nothing to open on: find the campus and go there.
  const nothingToOpenOn =
    !draft.center &&
    draft.points.length === 0 &&
    !otherZones.some((zone) => (zone.coordinates?.length ?? 0) >= 3);
  useEffect(() => {
    if (!nothingToOpenOn || !campus?.trim()) return;
    const controller = new AbortController();
    searchPlaces(campus, { signal: controller.signal })
      .then((places) => {
        const first = places[0];
        if (!first) return;
        focusKey.current += 1;
        setFocus({ center: first, key: focusKey.current });
      })
      .catch(() => undefined);
    return () => controller.abort();
    // Once, on open: later edits are the officer's to steer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function changeQuery(next: string) {
    setQuery(next);
    if (next.trim().length < 2) {
      setResults([]);
      setSearchState("idle");
    } else {
      setSearchState("loading");
    }
  }

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchPlaces(q, { near, signal: controller.signal })
        .then((places) => {
          setResults(places);
          setHighlight(0);
          setSearchState(places.length ? "idle" : "empty");
        })
        .catch((cause: unknown) => {
          if ((cause as Error)?.name === "AbortError") return;
          setResults([]);
          setSearchState("error");
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // `near` moves as the officer draws; a new search waits for new words.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function pick(place: PlaceResult) {
    focusKey.current += 1;
    setFocus({ center: place, key: focusKey.current });
    setQuery("");
    setResults([]);
    setSearchState("idle");
    // A circle centers on the place; an outline is traced by hand around it.
    if (draft.mode === "circle") {
      onChange({ ...draft, center: { lat: place.lat, lng: place.lng } });
    }
    onPlacePicked?.(place);
  }

  // The radius field is in feet; the draft is in meters.
  // A drag on the map moves the radius; the field follows it.
  const [radiusDraft, setRadiusDraft] = useState(() =>
    String(Math.round(metersToFeet(draft.radius_m))),
  );
  const [radiusShown, setRadiusShown] = useState(draft.radius_m);
  if (radiusShown !== draft.radius_m) {
    setRadiusShown(draft.radius_m);
    setRadiusDraft(String(Math.round(metersToFeet(draft.radius_m))));
  }
  function commitRadius() {
    const feet = Number(radiusDraft);
    if (!Number.isFinite(feet) || radiusDraft.trim() === "") {
      setRadiusDraft(String(Math.round(metersToFeet(draft.radius_m))));
      return;
    }
    const meters = Math.round(clampRadius(feetToMeters(feet)));
    setRadiusDraft(String(Math.round(metersToFeet(meters))));
    if (meters !== Math.round(draft.radius_m)) {
      onChange({ ...draft, radius_m: meters });
    }
  }

  const showList = results.length > 0 || searchState !== "idle";
  const hint =
    draft.mode === "circle"
      ? draft.center
        ? "Drag the pin to move it, or the white dot to resize."
        : "Search for the place, or click the map to drop the pin."
      : draft.points.length === 0
        ? "Click each corner of the building in turn."
        : draft.points.length < 3
          ? `${draft.points.length} of at least 3 corners. Keep clicking.`
          : `${draft.points.length} corners. Drag one to move it, right-click to remove it.`;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Label htmlFor={searchId} className="sr-only">
            Find a place
          </Label>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id={searchId}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              results[highlight] ? `${listId}-${highlight}` : undefined
            }
            autoComplete="off"
            className="pl-9"
            placeholder="Find a building or address"
            value={query}
            disabled={disabled}
            onChange={(event) => changeQuery(event.target.value)}
            // Clicking the map instead closes the list; a pick lands first
            // because the options act on mousedown.
            onBlur={() => {
              setResults([]);
              setSearchState("idle");
            }}
            onKeyDown={(event) => {
              if (!results.length) return;
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight((i) => Math.min(results.length - 1, i + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight((i) => Math.max(0, i - 1));
              } else if (event.key === "Enter") {
                // Inside the zone form: Enter picks, it doesn't submit.
                event.preventDefault();
                const place = results[highlight];
                if (place) pick(place);
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setResults([]);
                setSearchState("idle");
              }
            }}
          />
          {showList ? (
            <ul
              id={listId}
              role="listbox"
              aria-label="Places"
              className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-[12px] border border-border bg-popover py-1 shadow-lg"
            >
              {searchState === "loading" && results.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  Searching...
                </li>
              ) : searchState === "empty" ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  No places match. Try the street address.
                </li>
              ) : searchState === "error" ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                  Search isn&apos;t answering. Click the map instead.
                </li>
              ) : null}
              {results.map((place, index) => (
                <li
                  key={place.id}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === highlight}
                  onMouseDown={(event) => {
                    // Before the input blurs, so the pick lands.
                    event.preventDefault();
                    pick(place);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex cursor-pointer flex-col px-3 py-1.5",
                    index === highlight && "bg-card-hover",
                  )}
                >
                  <span className="truncate text-sm text-foreground">
                    {place.name}
                  </span>
                  {place.detail ? (
                    <span className="truncate text-caption text-muted-foreground">
                      {place.detail}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <SegmentedChoice
          label="Zone shape"
          value={draft.mode}
          disabled={disabled}
          onChange={(mode) => onChange({ ...draft, mode })}
          options={[
            { value: "circle", label: "Circle" },
            { value: "outline", label: "Outline" },
          ]}
        />
      </div>

      <div className="relative min-h-[320px] flex-1">
        {mapUnavailable ? (
          <div className="flex h-full min-h-[320px] items-center justify-center rounded-[14px] border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            The map couldn&apos;t load. Check your connection and reopen the
            zone.
          </div>
        ) : (
          <ZoneMap
            draft={draft}
            onChange={onChange}
            otherZones={otherZones}
            focus={focus}
            disabled={disabled}
            onUnavailable={() => setMapUnavailable(true)}
          />
        )}
      </div>

      <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2">
        {draft.mode === "circle" ? (
          <div className="flex items-center gap-2">
            <Label htmlFor={radiusId} className="text-sm font-medium">
              Radius
            </Label>
            <Input
              id={radiusId}
              inputMode="numeric"
              className="h-9 w-24 pointer-coarse:h-11"
              value={radiusDraft}
              disabled={disabled}
              aria-describedby={`${radiusId}-unit`}
              onChange={(event) =>
                setRadiusDraft(event.target.value.replace(/[^\d]/g, ""))
              }
              onBlur={commitRadius}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRadius();
                }
              }}
            />
            <span id={`${radiusId}-unit`} className="text-sm text-muted-foreground">
              ft
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || draft.points.length === 0}
              onClick={() =>
                onChange({ ...draft, points: draft.points.slice(0, -1) })
              }
            >
              <Undo2 className="h-4 w-4" aria-hidden />
              Undo corner
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || draft.points.length === 0}
              onClick={() => onChange({ ...draft, points: [] })}
            >
              Clear
            </Button>
          </div>
        )}
        <p
          className={cn(
            "min-w-0 flex-1 text-caption",
            error ? "text-destructive" : "text-muted-foreground",
          )}
          role={error ? "alert" : undefined}
        >
          {error ?? hint}
        </p>
      </div>
      <p className="text-caption text-muted-foreground">
        Leave some room around the building: phones drift 50 to 150 ft
        indoors.
      </p>
    </div>
  );
}
