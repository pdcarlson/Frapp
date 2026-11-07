/**
 * The line under an event that checks members in by location, on web's event
 * panel and mobile's event details alike. It names the place, never the
 * shape: web used to print the polygon's corner count ("4 points"), which
 * read as a points reward two lines below the event's real one
 * (principles.md P2.2).
 */
export function checkInZoneLine(zoneName: string | null | undefined): string {
  const name = zoneName?.trim();
  return name
    ? `Check in from inside the ${name} zone.`
    : "Check in from the event location.";
}
