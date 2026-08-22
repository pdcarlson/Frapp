# Signet: Buildpad answers (NestJS, Supabase, SaaS pitch)

Drafts for the three Buildpad questions on Signet (Frapp). Paste as-is or edit.

---

## 1. Why NestJS for the API instead of staying in Next.js?

The ops platform was one Next.js app doing everything. Pages, API routes, auth, all in the same repo with no real separation, which is a big part of why the architecture got bad enough that I had to do the 11,000+ line refactor.

The thing that actually pushed NestJS was mobile. Signet is mobile first. The phone app is where brothers actually live and the web dashboard is really for officers. If the API is Next route handlers on Vercel, then my Expo app is a client of my website's deployment, and every mobile release is downstream of whether the web deploy is healthy that day. I already lived that with the Appwrite and Vercel mess. So the API needed to be its own deployable, and it is. It's a Docker container on Render, web and landing are on Vercel, and they can fail independently of each other.

The second thing was that I'd just spent 11,000 lines learning Clean Architecture in ITWS 4500 and I wanted somewhere to actually put it. Next.js doesn't really have an opinion about that. NestJS ships modules and dependency injection out of the box, so the layering isn't a convention I have to keep enforcing on myself, it's just the framework. The API is literally interface/ then application/ then infrastructure/ then domain/ right now. 32 modules, 30 controllers, 37 services.

Third was guards, and this is the one I'd defend hardest. Every protected route runs the same three guard chain: validate the Supabase JWT, verify the caller actually belongs to the chapter, check the permission. That's three decorators on a controller. In Next.js every route handler is its own function and you have to remember to call your middleware in each one, and the one you forget is a cross tenant data leak. I didn't want the multi-tenant boundary to depend on me remembering.

Fourth, NestJS generates the OpenAPI spec off the controllers, I generate the typed client from that, and web and mobile both import the same package. One contract, two clients. If I change a response shape, both apps stop compiling instead of one of them quietly breaking in production.

The last one is background jobs, and this one is directly from the ops platform. There are 4 cron jobs running in the API right now: auto marking people absent after an event, invoice reminders, task reminders, and expiring old reports out of storage. That needs a process that's actually alive. On the old app the notification scheduling was the exact thing that fell over when the database spun down, and everybody got a pile of mistimed pings at once when it came back. I'd rather that live in a long running container I own than in a serverless function.

The cost is real. It's more infrastructure to run and the API is ~75,000 lines now, which is bigger than the web app. I think that's the right trade for something three clients have to share.

---

## 2. What was wrong with Appwrite that made you move to Supabase?

It wasn't one specific Appwrite feature that was broken. It was that I couldn't get underneath any of it.

Every failure I had on the ops platform was infrastructure I had no access to. The free tier compute couldn't cold start the app, so deployments would pass and then the site would time out. The free tier storage was too small for backwork, so I bolted an S3 bucket onto the side. The database would spin down every 7 days and I'd have to log into the Appwrite UI and click a button to bring it back, and the first time it happened I didn't notice for ~48 hours. Then the DNS cert thing between Appwrite and Vercel blew up and there was nothing in my repo I could change to fix it. That's the part that actually decided it for me. There was no file I could edit.

Supabase is just Postgres, and that's most of the reason right there. The schema is 43 migration files sitting in supabase/migrations in the repo, and I can run the whole stack on my laptop in Docker and reproduce anything. Nothing load bearing lives in a dashboard I configured once and then forgot about.

It also let me write things I couldn't have written before. There's a custom access token hook, which is a Postgres function that stamps the user's active chapter into every JWT that gets issued, so tenant context comes off a signed token instead of a header the client sets. Invoice payments go through an RPC that does the compare and set on the invoice status and the ledger insert in one transaction, so a duplicate Stripe webhook can't double record a payment. That's correctness enforced by the database. In Appwrite I would have been doing all of that in application code and hoping.

And it collapsed a provider. Auth, storage, realtime and the database all come from Supabase now, so the separate S3 bucket is gone.

I'll be honest that I'm still on three providers. Supabase for data, Render for the API, Vercel for web and landing. But each one owns exactly one layer now instead of all three being glued to each other, and none of them own the data. If Supabase ever became the problem it's a pg_dump and a new connection string, not a rewrite. That was not true of Appwrite.

The other thing I took out of that whole mess is that I never got paged. The database was down for 48 hours and I found out because brothers mentioned it. Sentry is in the stack now and actually getting error monitoring working is on the list before beta, not after.

---

## 3. Is the multi-tenant SaaS pitch real, or is it your chapter with SaaS ambitions on the roadmap?

The plumbing is real. The business isn't yet.

What's actually built: multi-tenancy is not a roadmap item, it's in the schema. Nearly every table carries a chapter_id. The active chapter comes out of a JWT claim, and if the request header disagrees with the claim the request gets rejected instead of the header winning. There's an end to end suite that tries to read across chapters and proves it gets 403s, and every repository has to have either a tenant scope test or a written down reason why it doesn't, enforced by a test that walks the directory. So nobody can quietly add a repository that leaks, including me.

Stripe is wired for real too. Checkout, customer portal, webhooks with a durable idempotency table so a redelivery after a deploy doesn't get processed twice, and subscription status actually gates writes inside the guard. An incomplete chapter can only write to the free routes, past_due gets a 3 day grace window, canceled goes read only. Member dues run on PaymentIntents separately from the chapter's own subscription, and that route is deliberately exempt from the subscription lock because collecting dues is how a broke chapter recovers. There's also a free wedge on purpose: 10 controllers have routes marked @FreeTier() so chat, members and invites all work before a chapter pays anything. That's a go to market decision that already exists in code.

What's not real: there are zero chapters on it. Including mine. The target is beta with Tau Nu in ~2 weeks.

The price isn't set either. The billing spec has the AI allowance sizing written in as TBD pending pricing analysis, which is exactly as far as I've gotten on it.

And the AI part, which is honestly the actual differentiation now, isn't built. There is no ai module in the API at all. The Ask screen on mobile answers out of a hardcoded keyword table behind an off by default flag, so the screen itself is real and reviewable against the design, but nothing is retrieving anything and no API backs it.

The README line about replacing Discord, OmegaFi and Life360 is old positioning and I need to update it. The branding research moved me off that, because "nicer UI for Greek life" is a crowded lane and everybody is already fishing in it. The angle now is the AI one, tagline is "Ask your chapter anything." The README just hasn't caught up.

There's a known gap in checkout I should name too. It passes the customer email instead of the stored Stripe customer id, so a second checkout mints a brand new Stripe customer and orphans the old subscription somewhere the app can't see or cancel it. Right now the web UI only offers checkout while a chapter is incomplete to route around that, but that's a UX guard and not a real boundary, so it's still open to anyone hitting the API directly.

The reason it's built multi-tenant from day one anyway is the other lesson from the ops platform. I built that thing for one chapter and it was so specific to us that there was no version of it that took a second chapter without a rewrite. I didn't want to do that twice, and retrofitting tenancy onto a live app is miserable, so I'd rather carry the complexity now while there's nobody on it.

But calling it SaaS today would be lying. It's a product with real billing code and no customers.

The honest blocker before my own chapter even moves over is a Discord import so they don't lose their history. That's a requirement, not a nice to have. Guys are not going to abandon years of messages to use my thing.
