# Demo data & screenshots

How to fill a local stack with a realistic chapter and capture screenshots of it —
for demos, design review, or marketing stills.

Everything here is invented. The seed contains no real chapter and no real member
data; the chapter name and roster live at the top of the seed file and are meant
to be edited.

## Seed the demo chapter

```bash
scripts/cloud-sandbox-up.sh     # or your usual local Supabase bring-up
scripts/demo/setup-demo.sh
```

`setup-demo.sh` loads [`scripts/demo/demo-seed.sql`](../../scripts/demo/demo-seed.sql)
and then creates (or re-points) the demo login. It is idempotent — re-running
rebuilds the chapter from scratch.

It seeds one chapter (**Beta Theta Omega**, Westfield University, all modules on,
Signet gold accent) with 26 members across the seven system roles, 12 events with
attendance, 14 tasks, service hours in every review state, a points ledger, dues
config plus paid/open invoices, five chat channels with conversation, three polls
with vote spreads, study geofences and sessions, documents, and a backwork archive.

Sign in at <http://localhost:3000/sign-in> as:

```
marcus.ellison@westfield.edu / DemoShowcase!2026
```

Override with `DEMO_EMAIL` / `DEMO_PASSWORD` if you want different credentials.

### Re-seeding drops the auth link

`chapters → users` is `ON DELETE SET NULL`, so the demo people survive the chapter
cascade and the seed deletes them explicitly by id prefix. The Supabase auth user
outlives both, which is why `setup-demo.sh` re-points `users.supabase_auth_id`
after every seed rather than only on first run.

## Capture screenshots

With the stack seeded and running (`npm run dev:stack`, or API on `:3001` and a
built web app on `:3000`):

```bash
node scripts/demo/capture-screenshots.mjs   # web dashboard  -> screenshots/web/
node scripts/demo/capture-mobile.mjs        # mobile         -> screenshots/mobile-*/
```

`capture-mobile.mjs` drives the running Expo web build, so start it first
(`npx expo start --web --port 3002` from `apps/mobile`) with the environment in
[Mobile setup](#mobile-setup). It signs in as the demo president and shoots the
signed-in screens at 3x into `screenshots/mobile-app/`; `SKIP_REFERENCE=1` skips
the design-board pass into `screenshots/mobile-reference/`.

Output lands in `screenshots/`, which is **gitignored**. There is no sanctioned
home for generated marketing binaries
([`DOCUMENTATION_CONVENTIONS.md`](../internal/DOCUMENTATION_CONVENTIONS.md) hard
rule 1 forbids a new top-level docs folder), so regenerate them rather than
committing them.

Prefer a production build (`npm run build -w apps/web && npm run start -w apps/web`)
over `next dev` — the dev overlay badge otherwise sits in the corner of every shot.

### Seven things that will waste your afternoon

**Browse `localhost`, never `127.0.0.1`.** The API's CORS allowlist
(`apps/api/src/main.ts`) names `http://localhost:3000` and `http://localhost:3002`.
From the numeric origin every browser call fails preflight, and the dashboard
renders its empty states — which looks exactly like "the seed didn't work" rather
than a CORS failure.

**The active chapter is client state.** `activeChapterId` lives in a
zustand/persist store that only `useSelectChapter` writes, so a fresh sign-in
leaves it `null` and every chapter-scoped query stays `enabled: false`. The API
auto-resolves single-chapter users from the JWT claim, so the _server_ is fine and
the _screen_ is empty. `capture-screenshots.mjs` seeds the store key directly.

**Mobile web needs one flag before it can sign in.** `apps/mobile` stores both
the Supabase session and the API token exclusively in `expo-secure-store`, whose
web build is literally `export default {}`
(`node_modules/expo-secure-store/build/ExpoSecureStore.web.js`). Left alone the
token never persists on web and every authenticated call 401s, which is why
these screens used to come from the design board instead of the app.
[`apps/mobile/lib/secure-store.web.ts`](../../apps/mobile/lib/secure-store.web.ts)
swaps in a `localStorage` adapter, but only when
`EXPO_PUBLIC_WEB_SECURE_STORE=1` — see [Mobile setup](#mobile-setup) below.
Without it every route redirects to `/sign-in`, and the capture script's
landed-route assertion fails the screen rather than saving a mislabelled image.

That flag must never be set for a hosted build: `localStorage` is readable by
any script on the origin, so it is a demo-stack affordance and not a web
credential store. Nothing ships mobile-web today — [`apps/mobile/eas.json`](../../apps/mobile/eas.json)
builds native only, [`render.yaml`](../../render.yaml) serves just the API, and
`apps/mobile` has no Vercel project — so it has no deployed surface to be
switched on for.

**And signed out, only `/sign-in` renders.** `(auth)/_layout.tsx` routes
`/welcome`, `/join`, `/chapter-picker` and `/create-chapter` by _gate
destination_, not by URL, so visiting any of them without a session redirects to
`/sign-in`. They look capturable and are not — an earlier version of the capture
script listed three of them and produced three byte-identical copies of the
sign-in screen under three different names. `capture-mobile.mjs` now asserts the
landed route matches the requested one and fails the route rather than saving a
mislabelled image; keep that assertion if you add a route back.

**Run Expo web on port 3002.** It is the port already in the API's CORS allowlist:
`npx expo start --web --port 3002` from `apps/mobile`.

**Running Expo web breaks `check-types` afterwards, but only locally.** Starting
the web build generates an `expo-env.d.ts` and a `.expo/types/` directory in the
app root. Both are gitignored, so CI never has them — but
[`apps/mobile/tsconfig.json`](../../apps/mobile/tsconfig.json) `include`s both,
and the generated `expo-env.d.ts` is a `/// <reference types="expo/types" />`
that pulls the web type surface in, where `cursor` is a plain CSS `string`
rather than React Native's `CursorValue`. From then on `npm run check-types -w apps/mobile`
reports overload errors on `<View>`s whose style array carries a `typeRole()`
spread (`components/tasks/new-task-sheet.tsx` is the one that trips first), and
`npm ci` does not clear them because the files are not dependencies. Delete the
two generated paths and the errors go with them. They are an artifact of the
capture, not a defect — do not "fix" the flagged component.

**Capture from a freshly seeded chapter.** Opening a channel marks it read, and
`ChannelRow` drops both the unread badge and the elevated card treatment for a
read row — so a second capture run photographs a chat home whose `#general` has
gone flat and empty. `capture-mobile.mjs` shoots s04 before it opens the thread,
which keeps a single run self-consistent; across runs, re-run `setup-demo.sh`
first.

<a id="mobile-setup"></a>

### Mobile setup

`scripts/cloud-sandbox-up.sh` writes `apps/api/.env.local` and
`apps/web/.env.local` but not `apps/mobile/.env.local`. Write that one by hand
(it is gitignored), taking the anon key from `apps/api/.env.local`:

```bash
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY from apps/api/.env.local>
EXPO_PUBLIC_API_URL=http://localhost:3001
EXPO_PUBLIC_ASK_ENABLED=1
EXPO_PUBLIC_WEB_SECURE_STORE=1
```

`EXPO_PUBLIC_ASK_ENABLED` turns on Ask (s17). Its answers come from the
synthetic keyword table in `lib/ask/corpus.ts`, not from a model or the API —
the screen is real, the answers are demo copy. `lib/ask/flag.ts` explains why
that is acceptable behind a flag no shipped build sets.

Two API-side values matter for the check-in screens:

- `EVENT_CHECK_IN_TOKEN_SECRET` in `apps/api/.env.local`. Unset, the mint route
  503s and s22 renders "Code unavailable" instead of a QR. Any non-empty string
  works locally.
- The demo seed marks exactly one event (`Chapter Meeting`) with a
  `check_in_zone`, which is what makes the scanner's geofence line render. The
  other events deliberately have none, so both branches of
  [`apps/mobile/app/(tabs)/check-in.tsx`](<../../apps/mobile/app/(tabs)/check-in.tsx>)
  stay reachable.

### Sandbox Chromium

The cloud sandbox ships a pinned Chromium that may not match the revision the
repo's Playwright expects. Point at it instead of downloading another (never run
`playwright install` here):

```bash
CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
  node scripts/demo/capture-screenshots.mjs
```

## Known defect in the design reference board

[`spec/ui/design-system/reference/canvas-screens.dc.html`](../../spec/ui/design-system/reference/canvas-screens.dc.html)
was committed with its non-ASCII characters **double-encoded through cp1252** —
`✦` (`e2 9c a6`) is stored as `âœ¦` (`c3a2 c593 c2a6`), and likewise every `·` and
em dash. Verified against the raw bytes, not inferred from a render.

`capture-mobile.mjs` repairs this in the DOM at capture time so it does not land in
the images. **The file on disk is still corrupt** and wants its own fix; the same
board also references `./support.js` and `./ios-frame.jsx`, neither of which is
committed next to it, so the capture script supplies the device frame and the
vendored Figtree face itself.
