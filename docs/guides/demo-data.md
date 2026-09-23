# Demo data & screenshots

How to fill a Supabase project with a realistic chapter: the local stack, for
demos, design review and marketing stills, and a hosted project, for the account
App Review signs in to.

Everything here is invented. The seed contains no real chapter and no real member
data. Every address is on `example.com` except the login's, which is whatever
`DEMO_EMAIL` names: the App Review login's own, for `--reviewer`
([`spec/engineering.md`](../../spec/engineering.md): no real identifiers in seed
data). The chapter name and roster live at the top of the seed file.

## Seed the demo chapter

```bash
scripts/cloud-sandbox-up.sh     # or your usual local Supabase bring-up
scripts/demo/setup-demo.sh
```

`setup-demo.sh` drives [`scripts/demo/seed-demo.mjs`](../../scripts/demo/seed-demo.mjs)
against the local stack: it creates (or updates) the demo login, loads
[`scripts/demo/demo-seed.sql`](../../scripts/demo/demo-seed.sql), and uploads a
placeholder PDF for every document and backwork row. It is idempotent: re-running
rebuilds the chapter from scratch. It refuses any non-loopback `SUPABASE_URL`;
[Seed a hosted project](#seed-a-hosted-project) covers those.

It seeds one chapter (**Beta Theta Omega**, Westfield University, all modules on,
Signet gold accent) with 26 members across the seven system roles, 12 events with
attendance, 16 tasks (two of them the demo login's own), service hours in every
review state, a points ledger, dues config plus paid/open invoices, five chat
channels with conversation, three polls with vote spreads, study geofences and
sessions, ten documents, and an eleven-item backwork archive. Every document and
backwork row opens: its file is a one-page PDF saying it is demo content.

Sign in at <http://localhost:3000/sign-in> as:

```
marcus.ellison@example.com / DemoShowcase!2026
```

That password belongs to the local stack alone. It is committed here, so
`seed-demo.mjs` refuses it for any hosted project. Override either value with
`DEMO_EMAIL` / `DEMO_PASSWORD`.

### How the login stays linked

Sign-in matches a Supabase auth user to its `users` row on
`users.supabase_auth_id` alone, so a login whose auth id matches no seeded row
signs in as a brand-new user in no chapter, with no error anywhere. The seed
therefore links roster #1 to the `auth.users` row with the login's email itself,
inside its own transaction. That is also why the login has to exist *before* the
seed runs, and why re-seeding needs no separate re-link: the chapter cascade and
the delete-by-id-prefix remove the old rows, and the rebuild links the new one.

It links only a login that `seed-demo.mjs auth` created for the same chapter,
which it marks in the account's `app_metadata`. An account with the right email
but no marker (a real person's, or one added by hand in the Supabase dashboard)
is left alone on a hosted project: `auth` refuses to touch it, and `--reviewer`
refuses to seed. On the local stack `auth` adopts it instead, resetting its
password to the local one and marking it, since a local account with the
roster's email is an earlier demo login; `sql` run on its own leaves it unlinked. If
the login signed in before the seed linked it (`verify` run early, or the app
opened), the API created a `users` row with no chapter for it; the next seed
removes that row and links the login properly.

## Seed a hosted project

The App Review account is this seed, applied to production with `--reviewer`,
under its own chapter identity. Staging takes the same commands, which is how the
path is tested before production sees it.

`--reviewer` differs from the local chapter in exactly what
[`apps/mobile/store/README.md` § Seed the reviewer's chapter](../../apps/mobile/store/README.md#seed-the-reviewers-chapter)
asks for: no invoice on the reviewer (so the Dues tab shows no Pay control and no
Stripe footer), and one direct message from the treasurer into the reviewer, since
chat home hides its DIRECT section while the list is empty.

**Chapter identity is `--namespace`.** Eight hex characters prefix every id the
seed writes, so two demo chapters in one project never collide. The App Review
chapter is `a9900000`; the local marketing chapter is `c0ffee00`, and
`--reviewer` refuses it.

**The four commands**, in order. `sql` only prints; the other three talk to the
project's HTTP APIs, so nothing here needs Docker or a database connection string.

| Step | Command | Needs |
| --- | --- | --- |
| 1. Login | `seed-demo.mjs auth --namespace a9900000` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DEMO_EMAIL`, `DEMO_PASSWORD` |
| 2. Seed | `seed-demo.mjs sql --namespace a9900000 --reviewer` | `DEMO_EMAIL`; prints SQL for `psql`, the SQL editor or an MCP `execute_sql` |
| 3. Files | `seed-demo.mjs storage --namespace a9900000` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| 4. Check | `seed-demo.mjs verify --namespace a9900000 --reviewer --api-url <api>` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DEMO_EMAIL`, `DEMO_PASSWORD` |

`npx infisical run --env=<slug> --path=/ -- node scripts/demo/seed-demo.mjs …`
supplies the three Supabase values for the environment named. The Infisical slug
for production is `prod`.

**Guards**, each refusing before it changes anything:

- `DEMO_PASSWORD` has no default. On a hosted project it must be at least 12
  characters and must not be the local stack's committed one.
- `auth` changes an existing hosted account only if this script created it for
  the same namespace (a marker in its `app_metadata`), and the seed links only a
  marked login. Anything else could be a real person's account. The marker cannot
  catch a typo in an address that has **no** account yet: `auth` creates, confirms
  and marks that one like the intended one, and the seed then makes whoever owns
  that inbox the demo chapter's president. Check the address `auth` prints before
  you seed.
- `verify` refuses the committed local password on a hosted project too, so a
  login that accepts it cannot pass.
- `auth` and `storage` refuse production unless `DEMO_ALLOW_PRODUCTION=true`,
  the same fence `DB_RESTORE_ALLOW_PRODUCTION` puts on a restore. The production
  ref comes from [`.github/environments.json`](../../.github/environments.json).
- The seed refuses to link a login whose earlier `users` row anything still
  references (a membership, rows in a chapter it has left), and `--reviewer`
  refuses to run at all until a marked login exists. The seed and `sql --remove`
  also refuse while any seeded account has rows that deleting it would cascade
  through or fail on once the demo chapter is gone: a membership in, or anything
  written to, another chapter (the App Review login founding one, say). A
  reference that would only be nulled, such as a directory request, does not
  count. Either way the whole seed is one transaction, so a failed re-seed leaves the chapter it
  was replacing exactly as it was.

### Production (App Review)

Writing this fictional chapter to `frapp-prod` is the owner's decision, and the
steps below need production access that agent sessions do not have
([#2309](https://github.com/pdcarlson/Frapp/issues/2309)). Set the login's two
values first, keeping the password out of shell history, in a terminal you close
when you are done: `setup-demo.sh` and the capture scripts read the same two
variables, so a later local run in that shell would pick up the production login.

```bash
export DEMO_EMAIL=<the App Review login's email>
read -rs DEMO_PASSWORD && export DEMO_PASSWORD
```

1. **Create the login.** `DEMO_ALLOW_PRODUCTION=true npx infisical run --env=prod --path=/ -- node scripts/demo/seed-demo.mjs auth --namespace a9900000`.
   Use this, not the Supabase dashboard: the seed links only a login this
   command created.
2. **Seed.** `node scripts/demo/seed-demo.mjs sql --namespace a9900000 --reviewer > "${TMPDIR:-/tmp}/reviewer.sql"`,
   then paste that file into the `frapp-prod` SQL editor, or run
   `psql "<frapp-prod connection string>" -v ON_ERROR_STOP=1 -f "${TMPDIR:-/tmp}/reviewer.sql"`.
   Write it outside the repo and delete it afterwards: it carries the login's
   email, and nothing ignores a `.sql` file at the repo root.
   An agent can apply it through Supabase MCP `execute_sql` once you approve.
3. **Upload the files.** `DEMO_ALLOW_PRODUCTION=true npx infisical run --env=prod --path=/ -- node scripts/demo/seed-demo.mjs storage --namespace a9900000`.
4. **Check it.** `npx infisical run --env=prod --path=/ -- node scripts/demo/seed-demo.mjs verify --namespace a9900000 --reviewer --api-url https://api.frapp.live`.
   Every line reads `OK`, ending `verify: every check passed`. It fails a stale
   chapter too: once the Chapter Meeting two days after the seed, its one event
   with a check-in zone, has started, it says to re-seed.
5. **Hand it over.** App Store Connect → App Review Information → Sign-In
   Required: the login's email and password.

**Re-seed before every submission.** Events are dated relative to the day the
seed runs, so a chapter seeded weeks earlier shows no upcoming events. Re-run
steps 2 to 4. The login and its password persist, and `storage` overwrites the
same objects in place: document ids are fixed, so each run names the same files.

**To remove a demo chapter**, apply `sql --remove` first: it prints the chapter
and user deletes, and it is the step that can refuse (a seeded account with rows in
another chapter), so stop there if it does. Then `storage --remove` (every object
under `chapters/<chapter id>/` in every bucket, which includes anything the reviewer
uploaded, such as a chat photo; it cannot be undone, so it refuses while the chapter
row still exists), then `auth --remove` (only a login this script created).

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

`node scripts/demo/capture-mobile.mjs --app-store` is the other mode: the App
Store set, at the store's size, into `screenshots/app-store/`, with no Ask or
Dues shot and a hard stop if any Ask surface is on screen. It needs the Expo
server started **without** `EXPO_PUBLIC_ASK_ENABLED`. The procedure, and which
size and why, are in
[`mobile.md` § 6.4](../internal/ops/deployment/mobile.md#64-app-store-screenshots).

Output lands in `screenshots/`, which is **gitignored**. There is no sanctioned
home for generated marketing binaries
([`DOCUMENTATION_CONVENTIONS.md`](../internal/DOCUMENTATION_CONVENTIONS.md#where-a-fact-lives)
forbids inventing a top-level folder), so regenerate them rather than
committing them.

Prefer a production build (`npm run build -w apps/web && npm run start -w apps/web`)
over `next dev` — the dev overlay badge otherwise sits in the corner of every shot.

### Seven things that will waste your afternoon

**Browse `localhost`, never `127.0.0.1`.** The API's CORS allowlist
(`apps/api/src/interface/http/cors.options.ts`) names `http://localhost:3000` and `http://localhost:3002`.
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
EXPO_PUBLIC_WEB_SECURE_STORE=1
# Marketing/demo capture only. Leave it out for the App Store set.
EXPO_PUBLIC_ASK_ENABLED=1
```

`EXPO_PUBLIC_ASK_ENABLED` turns on Ask (s17). Its answers come from the
synthetic keyword table in `lib/ask/corpus.ts`, not from a model or the API —
the screen is real, the answers are demo copy. `lib/ask/corpus.ts` explains why
that is acceptable: nothing in the repo sets the flag, and an EAS `production`
build refuses to evaluate its config when it is on (`apps/mobile/app.config.js`).

**The flag is for the marketing and demo capture only.** The default run shoots
`02-ask-answer` and so needs it. The App Store set (`--app-store`) must run
with it **unset**: the store binary has no Ask, so with the flag off the app
draws no ✦ pill ([#2259](https://github.com/pdcarlson/Frapp/issues/2259)), and
the preset refuses to write anything if it finds one. `EXPO_PUBLIC_*` values are
inlined when Metro transforms the bundle, so between the two modes remove the line
and restart Expo with `--clear`.

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
