/**
 * The proportion bar — one recipe, because there were three spellings of it
 * and all three were wrong for some chapter.
 *
 * `apps/web` drew this shape twice and the reference draws it twice more, and
 * no two agreed on the track:
 *
 * | Where | Track |
 * | --- | --- |
 * | `chat/renderers/poll-card.tsx` (slice 3) | `bg-input` |
 * | `polls/polls-page.tsx` (before this slice) | `bg-secondary` |
 * | canvas s10 / s22 | `--popover` |
 *
 * `--secondary` holds `--card`'s value, so `/polls` was washing a colour over
 * itself and shipped **no track at all** (1.000:1) — the alias trap
 * `components/shared/elevation-contrast.spec.ts` exists to catch. Two live
 * spellings of one recipe is also what the cutover rule forbids, so this
 * module is the recipe and both call sites import it.
 *
 * **The interesting half is that the obvious fix was also wrong.** Adopting
 * chat's `bg-input` looked right — it measures 1.540:1 against `--card`, a
 * real groove, and it was the spelling a shipped slice had already reviewed.
 * But a meter has two relationships, not one, and the fill is the chapter
 * accent. Measured against `--primary` across all 19 seeds, a `bg-input` track
 * collides with the dark-red chapters: **1.017:1 under `#800000`**, because a
 * white wash at 14% happens to land almost exactly where a maroon `accent-9`
 * lands. A chapter branded maroon shipped a bar whose fill was invisible
 * against its own groove — in chat, today.
 *
 * So the track is **`--background`: a recess, not a raise.** Worst case across
 * every seed and both containers:
 *
 * | Track | Fill vs track, worst | Track vs container, worst |
 * | --- | --- | --- |
 * | `bg-input` | 1.015 | 1.540 |
 * | `bg-border` | 1.133 | 1.253 |
 * | `bg-popover` | 1.444 | **1.000** (inside a dialog) |
 * | `bg-accent-subtle` | 1.512 | **1.001** (inside a dialog) |
 * | **`bg-background`** | **1.774** | 1.133 |
 *
 * It wins on the relationship that carries the data by a wide margin, and it
 * is the only candidate that cannot invert: `--background` is the *bottom* of
 * the surface ladder, so it sits below whatever container the meter is placed
 * in — a card, an elevated `SheetContent`, anything. That is `components.md`
 * §10's rule read downwards. `bg-popover` and `bg-accent-subtle` both fail it
 * outright inside a dialog, which is the same 1.000:1 washout in a new place.
 *
 * A groove that recedes is also the honest reading of "elevation is luminance"
 * (`foundations.md` §10): the filled part of a meter is raised, so the empty
 * part is the floor showing through.
 *
 * **This does not override the reference.** The boards draw the track at
 * `--popover`, and references beat docs on visuals — but the Canvas header
 * says the demo tenant runs the house-gold accent, so every meter on the
 * board is drawn against one light seed, where `--popover` works. The dark
 * seeds the engine also serves are not drawn. The geometry the board does
 * settle — full-round track and fill, accent-filled — is transcribed
 * unchanged; only the track tone is decided by measurement.
 *
 * **The bar is never the only signal.** Even at 1.774:1 the fill is under
 * README §6's 3:1 non-text floor for the darkest seeds, and at this ladder
 * nothing can clear it (`components.md` §2 concedes the same for row states).
 * So the fill carries emphasis, not information: both call sites print the
 * count and percentage as text beside the bar, and the bar itself is
 * `aria-hidden`. Do not drop that text on the grounds that the bar shows it.
 *
 * The fill is the chapter accent, which the reference draws (`#EFB63B` on both
 * meters) and §5 sanctions — a tally is an accent-worthy *stat*, not a status,
 * so "a status badge is never the chapter accent" does not reach it.
 *
 * Heights are exported rather than baked in, the same split
 * `components/shared/table-controls.ts` uses for its two field heights: the
 * paint is written once and the two contexts name their density, instead of
 * re-spelling the paint to change one number.
 */
const TRACK = "w-full overflow-hidden rounded-full bg-background";

/** Standalone card — `/polls`. */
export const meterTrackClassName = `h-1.5 ${TRACK}`;

/** In-flow inside a message card, where the row is already dense — chat. */
export const meterTrackDenseClassName = `h-1 ${TRACK}`;

export const meterFillClassName = "h-full rounded-full bg-primary";
