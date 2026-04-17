"use client";

import { useMemo, useState } from "react";
import { Loader2, MapPin, Plus, Power, PowerOff, Trash2 } from "lucide-react";
import {
  useCreateGeofence,
  useDeleteGeofence,
  useGeofences,
  useUpdateGeofence,
} from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/shared/async-states";
import { Can } from "@/components/shared/can";
import { useToast } from "@/hooks/use-toast";
import { asArray, getErrorMessage } from "@/lib/utils";

type Geofence = {
  id: string;
  chapter_id: string;
  name: string;
  coordinates: { lat: number; lng: number }[] | null;
  is_active: boolean;
  minutes_per_point: number;
  points_per_interval: number;
  min_session_minutes: number;
  created_at: string;
};

/**
 * Parses a textarea of "lat,lng" lines into a polygon ring. Polygons need at
 * least three distinct vertices. We intentionally don't close the ring for
 * the user — the API treats the vertex list as an open polygon and closes
 * it during point-in-polygon checks.
 */
function parseCoordinates(input: string): {
  ok: true;
  coordinates: { lat: number; lng: number }[];
} | { ok: false; error: string } {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 3) {
    return { ok: false, error: "Polygons need at least three vertices." };
  }
  const coordinates: { lat: number; lng: number }[] = [];
  for (const line of lines) {
    const parts = line.split(/[,\s]+/).filter(Boolean);
    if (parts.length < 2) {
      return {
        ok: false,
        error: `"${line}" is not a valid "lat, lng" pair.`,
      };
    }
    const lat = Number(parts[0]);
    const lng = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return {
        ok: false,
        error: `"${line}" is not a valid "lat, lng" pair.`,
      };
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return {
        ok: false,
        error: `"${line}" is outside valid lat/lng ranges.`,
      };
    }
    coordinates.push({ lat, lng });
  }
  return { ok: true, coordinates };
}

function formatCoordinates(
  coordinates: { lat: number; lng: number }[] | null,
): string {
  if (!coordinates) return "";
  return coordinates.map((c) => `${c.lat}, ${c.lng}`).join("\n");
}

export function GeofencesAdminPage() {
  const { toast } = useToast();
  const geofencesQuery = useGeofences();
  const createGeofence = useCreateGeofence();
  const updateGeofence = useUpdateGeofence();
  const deleteGeofence = useDeleteGeofence();

  const geofences = useMemo(
    () => asArray<Geofence>(geofencesQuery.data),
    [geofencesQuery.data],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState({
    name: "",
    coordinates: "",
    minutes_per_point: "30",
    points_per_interval: "1",
    min_session_minutes: "15",
  });

  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    coordinates: string;
    minutes_per_point: string;
    points_per_interval: string;
    min_session_minutes: string;
  }>({
    name: "",
    coordinates: "",
    minutes_per_point: "",
    points_per_interval: "",
    min_session_minutes: "",
  });

  const editTarget = useMemo(
    () => geofences.find((g) => g.id === editTargetId) ?? null,
    [geofences, editTargetId],
  );

  function openEditor(geofence: Geofence) {
    setEditTargetId(geofence.id);
    setEditDraft({
      name: geofence.name,
      coordinates: formatCoordinates(geofence.coordinates),
      minutes_per_point: String(geofence.minutes_per_point ?? 30),
      points_per_interval: String(geofence.points_per_interval ?? 1),
      min_session_minutes: String(geofence.min_session_minutes ?? 15),
    });
  }

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseCoordinates(createDraft.coordinates);
    if (!parsed.ok) {
      toast({
        title: "Fix the polygon",
        description: parsed.error,
        variant: "destructive",
      });
      return;
    }
    try {
      await createGeofence.mutateAsync({
        name: createDraft.name.trim(),
        coordinates: parsed.coordinates,
        is_active: true,
        minutes_per_point: Math.max(1, Number(createDraft.minutes_per_point)),
        points_per_interval: Math.max(
          1,
          Number(createDraft.points_per_interval),
        ),
        min_session_minutes: Math.max(
          1,
          Number(createDraft.min_session_minutes),
        ),
      });
      toast({
        title: "Study zone created",
        description: `${createDraft.name} is now live for study sessions.`,
      });
      setCreateOpen(false);
      setCreateDraft({
        name: "",
        coordinates: "",
        minutes_per_point: "30",
        points_per_interval: "1",
        min_session_minutes: "15",
      });
    } catch (error) {
      toast({
        title: "Couldn't create study zone",
        description: getErrorMessage(
          error,
          "Retry or confirm geofences:manage.",
        ),
        variant: "destructive",
      });
    }
  }

  async function submitEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTarget) return;
    const parsed = parseCoordinates(editDraft.coordinates);
    if (!parsed.ok) {
      toast({
        title: "Fix the polygon",
        description: parsed.error,
        variant: "destructive",
      });
      return;
    }
    try {
      await updateGeofence.mutateAsync({
        id: editTarget.id,
        body: {
          name: editDraft.name.trim(),
          coordinates: parsed.coordinates,
          minutes_per_point: Math.max(1, Number(editDraft.minutes_per_point)),
          points_per_interval: Math.max(
            1,
            Number(editDraft.points_per_interval),
          ),
          min_session_minutes: Math.max(
            1,
            Number(editDraft.min_session_minutes),
          ),
        },
      });
      toast({
        title: "Study zone updated",
        description: `${editDraft.name} saved.`,
      });
      setEditTargetId(null);
    } catch (error) {
      toast({
        title: "Couldn't save study zone",
        description: getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    }
  }

  async function toggleActive(geofence: Geofence) {
    try {
      await updateGeofence.mutateAsync({
        id: geofence.id,
        body: { is_active: !geofence.is_active },
      });
      toast({
        title: geofence.is_active ? "Study zone disabled" : "Study zone enabled",
        description: `${geofence.name} is ${
          geofence.is_active ? "hidden from" : "available to"
        } study sessions.`,
      });
    } catch (error) {
      toast({
        title: "Couldn't update study zone",
        description: getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    }
  }

  async function handleDelete(geofence: Geofence) {
    const confirmed = window.confirm(
      `Delete "${geofence.name}"? Active sessions inside this zone will be expired on the next heartbeat.`,
    );
    if (!confirmed) return;
    try {
      await deleteGeofence.mutateAsync(geofence.id);
      toast({
        title: "Study zone deleted",
        description: `${geofence.name} was removed.`,
      });
    } catch (error) {
      toast({
        title: "Couldn't delete study zone",
        description: getErrorMessage(error, "Retry in a moment."),
        variant: "destructive",
      });
    }
  }

  if (geofencesQuery.isPending) {
    return <LoadingState message="Loading study zones..." />;
  }

  if (geofencesQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load study zones"
        description="Confirm your chapter access and retry."
        onRetry={() => void geofencesQuery.refetch()}
      />
    );
  }

  return (
    <Can
      permission="geofences:manage"
      deniedFallback={
        <div style={{ minHeight: 160 }}>
          <Card>
            <CardHeader>
              <CardTitle>Study zones</CardTitle>
              <CardDescription>
                Managing study zones requires the{" "}
                <code>geofences:manage</code> permission. Ask your chapter
                president to grant access.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      }
      fallback={
        <div style={{ minHeight: 160 }}>
          <Card>
            <CardHeader>
              <CardTitle>Study zones</CardTitle>
              <CardDescription>Checking your chapter permissions…</CardDescription>
            </CardHeader>
          </Card>
        </div>
      }
    >
      <div className="space-y-6">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Study zones
            </h2>
            <p className="text-sm text-muted-foreground">
              Draw a polygon from GPS coordinates, set the reward rate, and
              members can start tracked study sessions when they&apos;re
              inside the zone.
            </p>
          </div>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                New study zone
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create a study zone</DialogTitle>
                <DialogDescription>
                  Paste at least three lat/lng vertices (one per line).
                  Polygons close automatically on the server.
                </DialogDescription>
              </DialogHeader>
              <form
                id="geofence-create-form"
                className="space-y-4"
                onSubmit={submitCreate}
              >
                <div className="grid gap-1">
                  <Label htmlFor="gf-name">Name</Label>
                  <Input
                    id="gf-name"
                    value={createDraft.name}
                    onChange={(event) =>
                      setCreateDraft((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }))
                    }
                    placeholder="Main library"
                    required
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="gf-coords">Vertices (one per line)</Label>
                  <Textarea
                    id="gf-coords"
                    value={createDraft.coordinates}
                    onChange={(event) =>
                      setCreateDraft((prev) => ({
                        ...prev,
                        coordinates: event.target.value,
                      }))
                    }
                    rows={6}
                    placeholder={`30.286, -97.740\n30.287, -97.740\n30.287, -97.739`}
                    required
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1">
                    <Label htmlFor="gf-minutes-per-point">
                      Minutes per point
                    </Label>
                    <Input
                      id="gf-minutes-per-point"
                      type="number"
                      min={1}
                      value={createDraft.minutes_per_point}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({
                          ...prev,
                          minutes_per_point: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="gf-points-per-interval">
                      Points per interval
                    </Label>
                    <Input
                      id="gf-points-per-interval"
                      type="number"
                      min={1}
                      value={createDraft.points_per_interval}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({
                          ...prev,
                          points_per_interval: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="gf-min-session">Min session (min)</Label>
                    <Input
                      id="gf-min-session"
                      type="number"
                      min={1}
                      value={createDraft.min_session_minutes}
                      onChange={(event) =>
                        setCreateDraft((prev) => ({
                          ...prev,
                          min_session_minutes: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </form>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  disabled={createGeofence.isPending}
                >
                  Cancel
                </Button>
                <Button
                  form="geofence-create-form"
                  type="submit"
                  disabled={createGeofence.isPending}
                >
                  {createGeofence.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Create study zone
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </header>

        {geofences.length === 0 ? (
          <EmptyState
            title="No study zones yet"
            description="Create your first zone to let members start tracked study sessions for points."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {geofences.map((zone) => (
              <Card key={zone.id} className="border-border">
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      {zone.name}
                    </CardTitle>
                    <CardDescription>
                      {zone.points_per_interval} pt every{" "}
                      {zone.minutes_per_point} min · min{" "}
                      {zone.min_session_minutes} min session
                    </CardDescription>
                  </div>
                  <Badge variant={zone.is_active ? "default" : "outline"}>
                    {zone.is_active ? "Active" : "Disabled"}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 text-xs font-mono text-muted-foreground">
                    {zone.coordinates && zone.coordinates.length > 0 ? (
                      <ul>
                        {zone.coordinates.map((c, idx) => (
                          <li key={idx}>
                            {c.lat.toFixed(6)}, {c.lng.toFixed(6)}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>No coordinates recorded.</p>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openEditor(zone)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void toggleActive(zone)}
                  >
                    {zone.is_active ? (
                      <PowerOff className="h-4 w-4" />
                    ) : (
                      <Power className="h-4 w-4" />
                    )}
                    {zone.is_active ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleDelete(zone)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}

        <Dialog
          open={Boolean(editTarget)}
          onOpenChange={(open) => {
            if (!open) setEditTargetId(null);
          }}
        >
          <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit study zone</DialogTitle>
              <DialogDescription>
                Coordinates replace the full polygon on save.
              </DialogDescription>
            </DialogHeader>
            {editTarget ? (
              <form
                id="geofence-edit-form"
                className="space-y-4"
                onSubmit={submitEdit}
              >
                <div className="grid gap-1">
                  <Label htmlFor="gf-edit-name">Name</Label>
                  <Input
                    id="gf-edit-name"
                    value={editDraft.name}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }))
                    }
                    required
                  />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="gf-edit-coords">Vertices</Label>
                  <Textarea
                    id="gf-edit-coords"
                    value={editDraft.coordinates}
                    onChange={(event) =>
                      setEditDraft((prev) => ({
                        ...prev,
                        coordinates: event.target.value,
                      }))
                    }
                    rows={6}
                    required
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1">
                    <Label htmlFor="gf-edit-mpp">Minutes per point</Label>
                    <Input
                      id="gf-edit-mpp"
                      type="number"
                      min={1}
                      value={editDraft.minutes_per_point}
                      onChange={(event) =>
                        setEditDraft((prev) => ({
                          ...prev,
                          minutes_per_point: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="gf-edit-ppi">Points per interval</Label>
                    <Input
                      id="gf-edit-ppi"
                      type="number"
                      min={1}
                      value={editDraft.points_per_interval}
                      onChange={(event) =>
                        setEditDraft((prev) => ({
                          ...prev,
                          points_per_interval: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="gf-edit-min">Min session (min)</Label>
                    <Input
                      id="gf-edit-min"
                      type="number"
                      min={1}
                      value={editDraft.min_session_minutes}
                      onChange={(event) =>
                        setEditDraft((prev) => ({
                          ...prev,
                          min_session_minutes: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
              </form>
            ) : null}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEditTargetId(null)}
                disabled={updateGeofence.isPending}
              >
                Cancel
              </Button>
              <Button
                form="geofence-edit-form"
                type="submit"
                disabled={updateGeofence.isPending}
              >
                {updateGeofence.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Save changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </Can>
  );
}
