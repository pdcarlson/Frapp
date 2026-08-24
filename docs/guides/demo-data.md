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

Output lands in `screenshots/`, which is **gitignored**. There is no sanctioned
home for generated marketing binaries
([`DOCUMENTATION_CONVENTIONS.md`](../internal/DOCUMENTATION_CONVENTIONS.md) hard
rule 1 forbids a new top-level docs folder), so regenerate them rather than
committing them.

Prefer a production build (`npm run build -w apps/web && npm run start -w apps/web`)
over `next dev` — the dev overlay badge otherwise sits in the corner of every shot.

### Four things that will waste your afternoon

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

**Mobile web cannot sign in.** `apps/mobile` stores both the Supabase session and
the API token exclusively in `expo-secure-store`, whose web build is literally
`export default {}` (`node_modules/expo-secure-store/build/ExpoSecureStore.web.js`).
On web the token never persists and every authenticated call 401s. So
`capture-mobile.mjs` captures only the pre-auth screens from the running Expo app
and takes the signed-in screens from the committed design reference board instead
— it keeps them in separate folders because they are not the same kind of evidence.
Real signed-in mobile screenshots need a simulator or device.

**Run Expo web on port 3002.** It is the port already in the API's CORS allowlist:
`npx expo start --web --port 3002` from `apps/mobile`.

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
