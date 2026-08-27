-- Frapp — demo chapter seed for marketing / showcase screenshots.
--
-- Populates one fictional chapter with realistic-looking activity so the web
-- dashboard and mobile app render populated screens instead of empty states.
--
-- Everything here is invented. No real member data, no real chapter.
-- Re-runnable: it deletes the demo chapter (cascade) and rebuilds it.
--
--   docker exec -i supabase_db_Frapp psql -U postgres -d postgres < scripts/demo/demo-seed.sql

BEGIN;

\set chapter_id '''c0ffee00-0000-4000-8000-000000000001'''

DELETE FROM chapters WHERE id = :chapter_id;
-- chapters -> users is ON DELETE SET NULL, so the demo people outlive the
-- cascade and collide on re-run. Remove them explicitly by their id prefix.
DELETE FROM users WHERE id::text LIKE 'c0ffee00-0000-4000-8000-1000%';

-- ── Chapter ──────────────────────────────────────────────────────────────────
-- Signet house accent (gold), not the legacy royal-blue column default.
INSERT INTO chapters (id, name, university, org_archetype, accent_color,
                      subscription_status, enabled_modules, created_at)
VALUES (:chapter_id, 'Beta Theta Omega', 'Westfield University', 'ifc', '#EFB63B',
        'active',
        '{"chat":true,"members":true,"announcements":true,"audit-log":true,
          "chapter-settings":true,"events":true,"tasks":true,"points":true,
          "hours":true,"dues":true,"polls":true,"rush":true,"backwork":true,
          "documents":true,"reports":true,"onboarding":true,"geofences":true,
          "academics":true,"philanthropy":true,"risk":true,"billing":true}'::jsonb,
        now() - interval '14 months');

-- ── Roles ────────────────────────────────────────────────────────────────────
INSERT INTO roles (id, chapter_id, name, permissions, is_system, display_order, system_key)
VALUES
 ('c0ffee00-0000-4000-8000-0000000000a1', :chapter_id, 'President',      ARRAY['*'], true, 1, 'president'),
 ('c0ffee00-0000-4000-8000-0000000000a2', :chapter_id, 'Treasurer',      ARRAY['billing:view','billing:manage','points:adjust','points:view_all','polls:view_all','members:view','reports:export','events:create','events:update'], true, 2, 'treasurer'),
 ('c0ffee00-0000-4000-8000-0000000000a3', :chapter_id, 'Vice President', ARRAY['members:view','polls:view_all'], true, 3, 'vice_president'),
 ('c0ffee00-0000-4000-8000-0000000000a4', :chapter_id, 'Secretary',      ARRAY['members:view','polls:view_all'], true, 4, 'secretary'),
 ('c0ffee00-0000-4000-8000-0000000000a5', :chapter_id, 'Member',         ARRAY['members:view','backwork:upload','service:log','polls:create'], true, 5, 'member'),
 ('c0ffee00-0000-4000-8000-0000000000a6', :chapter_id, 'New Member',     ARRAY['members:view','backwork:upload'], true, 6, 'new_member'),
 ('c0ffee00-0000-4000-8000-0000000000a7', :chapter_id, 'Alumni',         ARRAY['members:view'], true, 7, 'alumni');

COMMIT;


BEGIN;
\set cid '''c0ffee00-0000-4000-8000-000000000001'''

-- ── People ───────────────────────────────────────────────────────────────────
-- 26 invented members. `supabase_auth_id` is a plain uuid here (no FK to
-- auth.users); the one real login is patched in afterwards by demo-login.mjs.
CREATE TEMP TABLE roster (
  n int, uid uuid, name text, email text, grad int, city text, company text,
  role_key text, bio text
) ON COMMIT DROP;

INSERT INTO roster (n, name, grad, city, company, role_key, bio) VALUES
 (1,'Marcus Ellison',2026,'Westfield, OH','Ridgeline Capital','president','Chapter president. Mechanical engineering, intramural soccer captain.'),
 (2,'Devin Okafor',2026,'Columbus, OH','Northlight Analytics','treasurer','Treasurer. Finance major, runs the chapter budget and the dues ledger.'),
 (3,'Ryan Castellano',2027,'Pittsburgh, PA','—','vice_president','VP of member development.'),
 (4,'Aaron Whitfield',2027,'Cleveland, OH','—','secretary','Secretary. Keeps the minutes, hates that he likes spreadsheets.'),
 (5,'Julian Reyes',2026,'Chicago, IL','Brightpath','member',NULL),
 (6,'Cole Bennett',2027,'Ann Arbor, MI','—','member',NULL),
 (7,'Nate Sorensen',2028,'Madison, WI','—','member',NULL),
 (8,'Elias Brandt',2027,'Westfield, OH','—','member',NULL),
 (9,'Trevor Nakamura',2026,'Seattle, WA','Cascade Robotics','member',NULL),
 (10,'Owen Delacroix',2028,'New Orleans, LA','—','member',NULL),
 (11,'Sam Abernathy',2027,'Indianapolis, IN','—','member',NULL),
 (12,'Miles Guerrero',2028,'Austin, TX','—','member',NULL),
 (13,'Isaac Lindqvist',2026,'Minneapolis, MN','Halden Group','member',NULL),
 (14,'Dominic Farrell',2027,'Buffalo, NY','—','member',NULL),
 (15,'Andre Boateng',2028,'Toronto, ON','—','member',NULL),
 (16,'Grant Mackenzie',2027,'Denver, CO','—','member',NULL),
 (17,'Theo Vasquez',2028,'Phoenix, AZ','—','member',NULL),
 (18,'Wyatt Kohler',2026,'Cincinnati, OH','Vantage Health','member',NULL),
 (19,'Simon Adeyemi',2029,'Atlanta, GA','—','new_member',NULL),
 (20,'Jonah Pritchard',2029,'Louisville, KY','—','new_member',NULL),
 (21,'Rafael Moreno',2029,'San Diego, CA','—','new_member',NULL),
 (22,'Bennett Chao',2029,'Boston, MA','—','new_member',NULL),
 (23,'Luca Ferretti',2029,'Newark, NJ','—','new_member',NULL),
 (24,'Charles Whitmore III',2019,'New York, NY','Whitmore & Pace','alumni','Alumni advisor, house corporation board.'),
 (25,'Peter Osei',2018,'Washington, DC','Federal Reserve','alumni',NULL),
 (26,'Daniel Kirkpatrick',2021,'Charlotte, NC','Anchor Logistics','alumni',NULL);

UPDATE roster SET
  uid   = ('c0ffee00-0000-4000-8000-1000' || lpad(n::text, 8, '0'))::uuid,
  email = lower(regexp_replace(split_part(name,' ',1),'[^a-z]','','gi')) || '.' ||
          lower(regexp_replace(split_part(name,' ',2),'[^a-z]','','gi')) || '@westfield.edu';

INSERT INTO users (id, supabase_auth_id, email, display_name, graduation_year,
                   current_city, current_company, bio, active_chapter_id, created_at)
SELECT uid, ('c0ffee00-0000-4000-8000-2000' || lpad(n::text, 8, '0'))::uuid,
       email, name, grad,
       NULLIF(city,'—'), NULLIF(company,'—'), bio, :cid,
       make_timestamptz(grad - 3, CASE WHEN grad >= 2029 THEN 1 ELSE 9 END, 5, 12, 0, 0)
FROM roster;

INSERT INTO members (user_id, chapter_id, role_ids, has_completed_onboarding, created_at)
SELECT r.uid, :cid, ARRAY[ro.id], true,
       make_timestamptz(r.grad - 3, CASE WHEN r.grad >= 2029 THEN 1 ELSE 9 END, 5, 12, 0, 0)
FROM roster r
JOIN roles ro ON ro.chapter_id = :cid AND ro.system_key = r.role_key;

COMMIT;


BEGIN;
\set cid '''c0ffee00-0000-4000-8000-000000000001'''

DROP TABLE IF EXISTS u;
-- `n` is the roster number, read back out of the uuid it was encoded into.
-- Deriving it from created_at ordering instead would silently re-map every
-- downstream reference the moment join dates stop being monotonic in n.
CREATE TEMP TABLE u AS
  SELECT us.id, us.display_name, right(us.id::text, 8)::int AS n
  FROM users us WHERE us.active_chapter_id = :cid;

-- ── Events ───────────────────────────────────────────────────────────────────
-- Times are anchored to midnight, not to `now()`, so events land on the hour
-- the way a real calendar does. Seeding them as `now() + interval` stamps the
-- run time's minutes and seconds onto every row (7:35:51 PM), which reads as
-- test data in a screenshot.
INSERT INTO events (id, chapter_id, name, description, location, start_time, end_time,
                    point_value, is_mandatory, created_at)
SELECT e.id::uuid, :cid, e.name, e.descr, e.loc,
       date_trunc('day', now()) + (e.day_offset * interval '1 day') + (e.start_hour * interval '1 hour'),
       date_trunc('day', now()) + (e.day_offset * interval '1 day') + (e.start_hour * interval '1 hour')
         + (e.mins * interval '1 minute'),
       e.pts, e.mandatory, now() - (e.created_days_ago * interval '1 day')
FROM (VALUES
 ('c0ffee00-0000-4000-8000-3000000000e1','Chapter Meeting','Weekly chapter. Attendance is mandatory for actives.','Chapter House — Great Room',  2, 19,  90, 10, true,  20),
 ('c0ffee00-0000-4000-8000-3000000000e2','Alumni Networking Night','Dinner and panel with alumni from finance, law, and engineering.','Westfield Union — Ballroom B', 5, 19, 120, 15, false, 18),
 ('c0ffee00-0000-4000-8000-3000000000e3','Philanthropy 5K Setup','Course marshals, registration table, water stations.','Riverfront Park',           9,  7, 300, 25, false, 15),
 ('c0ffee00-0000-4000-8000-3000000000e4','New Member Education','Week 6 — chapter history and ritual.','Chapter House — Library',                   3, 20,  60, 10, false, 12),
 ('c0ffee00-0000-4000-8000-3000000000e5','Intramural Championship','Soccer final vs. Sigma house.','West Rec Fields',                               6, 17,  90,  5, false, 10),
 ('c0ffee00-0000-4000-8000-3000000000e6','Exec Board Sync','Officer standup ahead of chapter.','Chapter House — Study',                            1, 17,  60,  0, false,  9),
 ('c0ffee00-0000-4000-8000-3000000000e7','Recruitment Info Night','Open house for prospective members.','Chapter House',                          12, 19, 120, 15, false,  8),
 ('c0ffee00-0000-4000-8000-3000000000f1','Chapter Meeting','Weekly chapter.','Chapter House — Great Room',                                        -5, 19,  90, 10, true,  30),
 ('c0ffee00-0000-4000-8000-3000000000f2','Highway Cleanup','Adopt-a-highway, mile markers 41–43.','Route 9 North',                                -9,  9, 240, 20, false, 30),
 ('c0ffee00-0000-4000-8000-3000000000f3','Founders Day Banquet','Formal dinner with the house corporation.','Westfield Hotel — Grand Hall',      -16, 18, 180, 15, true,  45),
 ('c0ffee00-0000-4000-8000-3000000000f4','Chapter Meeting','Weekly chapter.','Chapter House — Great Room',                                       -12, 19,  90, 10, true,  40),
 ('c0ffee00-0000-4000-8000-3000000000f5','Blood Drive','Co-hosted with the Red Cross.','Westfield Union — Room 210',                             -22, 11, 360, 20, false, 50)
) AS e(id, name, descr, loc, day_offset, start_hour, mins, pts, mandatory, created_days_ago);

-- The upcoming Chapter Meeting carries a check-in zone; the rest do not.
--
-- `events.check_in_zone` is opt-in per event, and the mobile scanner (s18)
-- binds its "your location is the real check" line to `hasCheckInZone` rather
-- than drawing it unconditionally — a zone-less event would otherwise make a
-- security claim about a check that is not running. Seeding exactly one zoned
-- event keeps both branches of that screen reachable in a demo stack.
--
-- The polygon sits beside the Chapter House study geofence below, so the whole
-- fictional chapter stays in one invented place.
UPDATE events
   SET check_in_zone = '[{"lat":41.0788,"lng":-81.5232},{"lat":41.0794,"lng":-81.5232},{"lat":41.0794,"lng":-81.5226},{"lat":41.0788,"lng":-81.5226}]'::jsonb,
       check_in_zone_name = 'Great Room'
 WHERE id = 'c0ffee00-0000-4000-8000-3000000000e1';

-- Attendance on past events: most present, a few excused/absent.
INSERT INTO event_attendance (event_id, user_id, status, check_in_time, marked_by, created_at)
SELECT e.id, u.id,
       CASE WHEN (u.n + length(e.name)) % 11 = 0 THEN 'ABSENT'
            WHEN (u.n + length(e.name)) % 7  = 0 THEN 'EXCUSED'
            ELSE 'PRESENT' END,
       e.start_time + interval '4 minutes',
       (SELECT id FROM u WHERE n = 1),
       e.start_time
FROM events e CROSS JOIN u
WHERE e.chapter_id = :cid AND e.start_time < now() AND u.n <= 23;

-- A check-in already in progress on the one upcoming zoned event.
--
-- The host screen (s22) reads its "N checked in" from `countCheckedIn`, which
-- counts PRESENT and LATE rows only. With attendance seeded on past events
-- alone that tile reads a permanent "0 checked in", which is a real state but
-- not a representative one — it is the frame before anybody has scanned. These
-- rows put the screen mid-meeting instead, which is when an officer is actually
-- looking at it.
INSERT INTO event_attendance (event_id, user_id, status, check_in_time, marked_by, created_at)
SELECT e.id, u.id, 'PRESENT', now() - (u.n * interval '20 seconds'),
       (SELECT id FROM u WHERE n = 1), now()
FROM events e CROSS JOIN u
WHERE e.id = 'c0ffee00-0000-4000-8000-3000000000e1' AND u.n <= 14;

-- ── Tasks ────────────────────────────────────────────────────────────────────
INSERT INTO tasks (chapter_id, title, description, assignee_id, created_by, due_date,
                   status, point_reward, completed_at, created_at)
SELECT :cid, t.title, t.descr,
       (SELECT id FROM u WHERE n = t.assignee),
       (SELECT id FROM u WHERE n = 1),
       (current_date + t.due_offset)::date, t.status, t.pts,
       CASE WHEN t.status = 'COMPLETED' THEN now() - interval '2 days' ELSE NULL END,
       now() - interval '11 days'
FROM (VALUES
 ('Book the banquet hall deposit','Confirm the Westfield Hotel contract and wire the 25% deposit.',2,3,'IN_PROGRESS',15),
 ('Submit risk management form','Fall semester social event registration, due to the Office of Greek Life.',3,1,'TODO',10),
 ('Order philanthropy 5K shirts','260 shirts, sizes S–XXL. Vendor quote already approved.',5,6,'IN_PROGRESS',15),
 ('Update the composite photo list','Every active + new member, headshot deadline is Friday.',4,4,'TODO',10),
 ('Reconcile October dues ledger','Match Stripe payouts against the invoice list.',2,-1,'COMPLETED',20),
 ('Post chapter meeting minutes','Upload to Documents and pin in #announcements.',4,-3,'COMPLETED',5),
 ('Schedule alumni panel speakers','Four alumni confirmed, need a fifth from engineering.',3,8,'TODO',15),
 ('Fix the house laundry room door','House manager to get two quotes.',8,2,'OVERDUE',10),
 ('Renew intramural team registration','Basketball roster locks at the end of the month.',9,12,'TODO',5),
 ('Draft spring budget proposal','Line items for social, philanthropy, and house improvements.',2,20,'TODO',25),
 ('Collect new member bios','For the chapter website and the Founders Day program.',19,4,'IN_PROGRESS',10),
 ('Inventory the chapter room','Chairs, AV, ritual materials. Report to exec.',11,7,'TODO',10),
 ('Confirm 5K route permit','City parks department, application already filed.',5,4,'IN_PROGRESS',15),
 ('Send alumni newsletter','Q4 edition — 5K recap and Founders Day photos.',24,10,'TODO',10)
) AS t(title, descr, assignee, due_offset, status, pts);

COMMIT;


BEGIN;
\set cid '''c0ffee00-0000-4000-8000-000000000001'''
DROP TABLE IF EXISTS u;
-- `n` is the roster number, read back out of the uuid it was encoded into.
-- Deriving it from created_at ordering instead would silently re-map every
-- downstream reference the moment join dates stop being monotonic in n.
CREATE TEMP TABLE u AS
  SELECT us.id, us.display_name, right(us.id::text, 8)::int AS n
  FROM users us WHERE us.active_chapter_id = :cid;

-- ── Service hours ────────────────────────────────────────────────────────────
INSERT INTO service_entries (chapter_id, user_id, date, duration_minutes, description,
                             status, reviewed_by, points_awarded, created_at)
SELECT :cid, (SELECT id FROM u WHERE n = s.who), (current_date - s.days_ago)::date,
       s.mins, s.descr, s.status,
       CASE WHEN s.status <> 'PENDING' THEN (SELECT id FROM u WHERE n = 1) END,
       s.status = 'APPROVED', now() - (interval '1 day' * s.days_ago)
FROM (VALUES
 (5,3,240,'Adopt-a-highway cleanup, Route 9 North','APPROVED'),
 (6,3,240,'Adopt-a-highway cleanup, Route 9 North','APPROVED'),
 (7,4,180,'Food bank sorting shift, Westfield Community Pantry','APPROVED'),
 (8,6,120,'Habitat for Humanity build day','APPROVED'),
 (9,6,120,'Habitat for Humanity build day','APPROVED'),
 (10,8,300,'Special Olympics regional meet — event staff','APPROVED'),
 (11,11,90,'Campus blood drive volunteer','APPROVED'),
 (12,13,150,'Elementary school reading buddies','APPROVED'),
 (13,2,60,'Alumni phone-a-thon','APPROVED'),
 (14,1,180,'Riverfront park trash pickup','PENDING'),
 (15,2,120,'Soup kitchen dinner service','PENDING'),
 (16,4,240,'Animal shelter dog walking + kennel cleaning','PENDING'),
 (17,5,90,'Campus sustainability fair booth','PENDING'),
 (19,7,45,'Tutoring at the Westfield Boys & Girls Club','REJECTED')
) AS s(who, days_ago, mins, descr, status);

-- ── Points ───────────────────────────────────────────────────────────────────
INSERT INTO point_transactions (chapter_id, user_id, amount, category, description, created_at)
SELECT :cid, u.id,
       CASE c.cat WHEN 'ATTENDANCE' THEN 10 WHEN 'SERVICE' THEN 20
                  WHEN 'ACADEMIC' THEN 15 WHEN 'STUDY' THEN 5
                  WHEN 'FINE' THEN -15 ELSE 10 END,
       c.cat, c.descr,
       now() - (interval '1 day' * ((u.n * 3 + c.i * 5) % 45))
FROM u CROSS JOIN (VALUES
 (1,'ATTENDANCE','Chapter meeting attendance'),
 (2,'SERVICE','Approved service hours'),
 (3,'ACADEMIC','Semester GPA above 3.5'),
 (4,'STUDY','Logged study hours'),
 (5,'ATTENDANCE','Founders Day Banquet')
) AS c(i, cat, descr)
WHERE u.n <= 23 AND (u.n + c.i) % 3 <> 0;

INSERT INTO point_transactions (chapter_id, user_id, amount, category, description, created_at)
SELECT :cid, id, -15, 'FINE', 'Missed mandatory chapter meeting', now() - interval '6 days'
FROM u WHERE n IN (12, 17, 21);

-- ── Dues + invoices ──────────────────────────────────────────────────────────
INSERT INTO chapter_dues_config (chapter_id, cadence, active_amount_cents,
                                 new_member_amount_cents, alumni_amount_cents,
                                 installments_allowed, installment_count,
                                 late_fee_cents, grace_days, scholarship_pool_cents)
VALUES (:cid, 'per_semester', 145000, 189000, 0, true, 3, 5000, 10, 250000);

INSERT INTO financial_invoices (chapter_id, user_id, title, description, amount,
                                status, due_date, paid_at, created_at)
SELECT :cid, u.id, 'Fall 2026 Chapter Dues',
       'Semester dues — covers house operations, national fees, and social budget.',
       CASE WHEN u.n BETWEEN 19 AND 23 THEN 189000 ELSE 145000 END,
       CASE WHEN u.n % 7 = 0 THEN 'OPEN' WHEN u.n % 11 = 0 THEN 'OPEN' ELSE 'PAID' END,
       (current_date - 4)::date,
       CASE WHEN u.n % 7 <> 0 AND u.n % 11 <> 0 THEN now() - (interval '1 day' * (u.n % 20 + 5)) END,
       now() - interval '38 days'
FROM u WHERE u.n <= 23;

INSERT INTO financial_invoices (chapter_id, user_id, title, description, amount,
                                status, due_date, created_at)
SELECT :cid, u.id, 'Formal Ticket — Winter Semiformal', 'Bus, venue, and dinner.',
       8500, 'OPEN', (current_date + 16)::date, now() - interval '5 days'
FROM u WHERE u.n <= 23 AND u.n % 4 = 0;

COMMIT;


BEGIN;
\set cid '''c0ffee00-0000-4000-8000-000000000001'''
DROP TABLE IF EXISTS u;
-- `n` is the roster number, read back out of the uuid it was encoded into.
-- Deriving it from created_at ordering instead would silently re-map every
-- downstream reference the moment join dates stop being monotonic in n.
CREATE TEMP TABLE u AS
  SELECT us.id, us.display_name, right(us.id::text, 8)::int AS n
  FROM users us WHERE us.active_chapter_id = :cid;

-- ── Chat ─────────────────────────────────────────────────────────────────────
INSERT INTO chat_channel_categories (id, chapter_id, name, display_order) VALUES
 ('c0ffee00-0000-4000-8000-4000000000c1', :cid, 'Chapter', 1),
 ('c0ffee00-0000-4000-8000-4000000000c2', :cid, 'Committees', 2);

INSERT INTO chat_channels (id, chapter_id, name, description, type, category_id, is_read_only, created_at) VALUES
 ('c0ffee00-0000-4000-8000-4000000000b1', :cid, 'announcements', 'Officer announcements. Read-only.', 'PUBLIC', 'c0ffee00-0000-4000-8000-4000000000c1', true,  now() - interval '14 months'),
 ('c0ffee00-0000-4000-8000-4000000000b2', :cid, 'general',       'Everything else.',                  'PUBLIC', 'c0ffee00-0000-4000-8000-4000000000c1', false, now() - interval '14 months'),
 ('c0ffee00-0000-4000-8000-4000000000b3', :cid, 'philanthropy',  '5K planning and philanthropy committee.', 'PUBLIC', 'c0ffee00-0000-4000-8000-4000000000c2', false, now() - interval '7 months'),
 ('c0ffee00-0000-4000-8000-4000000000b4', :cid, 'intramurals',   'Game times, rosters, trash talk.',  'PUBLIC', 'c0ffee00-0000-4000-8000-4000000000c2', false, now() - interval '9 months'),
 ('c0ffee00-0000-4000-8000-4000000000b5', :cid, 'exec',          'Officer coordination.',             'ROLE_GATED', 'c0ffee00-0000-4000-8000-4000000000c1', false, now() - interval '12 months');

INSERT INTO chat_messages (channel_id, sender_id, content, type, created_at)
SELECT m.chan::uuid, (SELECT id FROM u WHERE n = m.who), m.body, 'TEXT',
       now() - (interval '1 minute' * m.mins_ago)
FROM (VALUES
 ('c0ffee00-0000-4000-8000-4000000000b2', 3, 'anyone know if the chapter room is free tonight? trying to get a study group together', 412),
 ('c0ffee00-0000-4000-8000-4000000000b2', 7, 'should be open after 8, exec is in there until then', 400),
 ('c0ffee00-0000-4000-8000-4000000000b2', 3, 'perfect, thanks', 396),
 ('c0ffee00-0000-4000-8000-4000000000b2',11, 'reminder that composite headshots are Friday at 4 in the great room. wear the navy blazer', 240),
 ('c0ffee00-0000-4000-8000-4000000000b2', 5, 'do we need the tie too or just the blazer', 236),
 ('c0ffee00-0000-4000-8000-4000000000b2',11, 'tie too. chapter colors if you have one', 233),
 ('c0ffee00-0000-4000-8000-4000000000b2', 9, 'grabbing coffee before the 5k meeting if anyone wants in', 95),
 ('c0ffee00-0000-4000-8000-4000000000b2',14, 'im in, meet at the corner spot?', 91),
 ('c0ffee00-0000-4000-8000-4000000000b2', 9, 'yep see you in 10', 88),
 ('c0ffee00-0000-4000-8000-4000000000b2', 2, 'dues reminder went out this morning — if you already paid you can ignore it, the batch went to everyone', 44),
 ('c0ffee00-0000-4000-8000-4000000000b2', 6, 'confirmed mine cleared last week, thanks Devin', 39),
 ('c0ffee00-0000-4000-8000-4000000000b2',17, 'is the laundry room door fixed yet or still jammed', 22),
 ('c0ffee00-0000-4000-8000-4000000000b2', 8, 'two quotes in, house manager is picking one this week', 18),
 ('c0ffee00-0000-4000-8000-4000000000b2',12, 'who is bringing the canopy tent saturday', 9),
 ('c0ffee00-0000-4000-8000-4000000000b2', 5, 'i have it in my trunk already', 4)
) AS m(chan, who, body, mins_ago);

INSERT INTO chat_messages (channel_id, sender_id, content, type, is_pinned, pinned_at, created_at)
SELECT m.chan::uuid, (SELECT id FROM u WHERE n = m.who), m.body, 'TEXT', m.pinned,
       CASE WHEN m.pinned THEN now() - (interval '1 hour' * m.hrs) END,
       now() - (interval '1 hour' * m.hrs)
FROM (VALUES
 ('c0ffee00-0000-4000-8000-4000000000b1', 1, 'Chapter meeting moved to Wednesday at 6 this week — the Great Room is booked Tuesday for the alumni panel. Attendance is still mandatory.', true, 30),
 ('c0ffee00-0000-4000-8000-4000000000b1', 2, 'Fall dues are posted. Payment plans are available in three installments — set one up in the app before the grace period ends.', true, 76),
 ('c0ffee00-0000-4000-8000-4000000000b1', 4, 'Minutes from the last chapter meeting are up in Documents → Meeting Minutes.', false, 120),
 ('c0ffee00-0000-4000-8000-4000000000b3',15, 'Registration is at 412 runners. We are 88 off the record.', false, 5),
 ('c0ffee00-0000-4000-8000-4000000000b3', 5, 'Shirt order goes in Friday — final count by Thursday night please.', false, 20),
 ('c0ffee00-0000-4000-8000-4000000000b4',13, 'Soccer final is Saturday 5pm on West Rec. Bring both jerseys.', false, 8),
 ('c0ffee00-0000-4000-8000-4000000000b4',18, 'Undefeated season on the line, do not be late', false, 6),
 ('c0ffee00-0000-4000-8000-4000000000b5', 1, 'Budget proposal draft is in the shared folder. Comments by Sunday.', false, 14),
 ('c0ffee00-0000-4000-8000-4000000000b5', 2, 'Added the line items for house improvements. Numbers are conservative.', false, 11)
) AS m(chan, who, body, pinned, hrs);

-- ── Study geofences + sessions ───────────────────────────────────────────────
INSERT INTO study_geofences (id, chapter_id, name, coordinates, is_active,
                             minutes_per_point, points_per_interval, min_session_minutes)
VALUES
 ('c0ffee00-0000-4000-8000-5000000000d1', :cid, 'Hargrove Library — 3rd Floor',
  '[{"lat":41.0812,"lng":-81.5190},{"lat":41.0816,"lng":-81.5190},{"lat":41.0816,"lng":-81.5183},{"lat":41.0812,"lng":-81.5183}]'::jsonb,
  true, 60, 5, 30),
 ('c0ffee00-0000-4000-8000-5000000000d2', :cid, 'Chapter House Study Room',
  '[{"lat":41.0790,"lng":-81.5225},{"lat":41.0793,"lng":-81.5225},{"lat":41.0793,"lng":-81.5220},{"lat":41.0790,"lng":-81.5220}]'::jsonb,
  true, 60, 5, 30),
 ('c0ffee00-0000-4000-8000-5000000000d3', :cid, 'Engineering Commons',
  '[{"lat":41.0845,"lng":-81.5162},{"lat":41.0849,"lng":-81.5162},{"lat":41.0849,"lng":-81.5156},{"lat":41.0845,"lng":-81.5156}]'::jsonb,
  true, 60, 5, 30);

INSERT INTO study_sessions (chapter_id, user_id, geofence_id, status, start_time, end_time,
                            total_foreground_minutes, points_awarded, created_at)
SELECT :cid, u.id,
       (ARRAY['c0ffee00-0000-4000-8000-5000000000d1','c0ffee00-0000-4000-8000-5000000000d2','c0ffee00-0000-4000-8000-5000000000d3']::uuid[])[1 + (u.n + g.i) % 3],
       'COMPLETED',
       now() - (interval '1 day' * ((u.n + g.i) % 21)) - interval '4 hours',
       now() - (interval '1 day' * ((u.n + g.i) % 21)) - interval '4 hours' + (interval '1 minute' * (45 + (u.n * 7 + g.i * 13) % 120)),
       45 + (u.n * 7 + g.i * 13) % 120, true,
       now() - (interval '1 day' * ((u.n + g.i) % 21))
FROM u CROSS JOIN generate_series(1,3) AS g(i)
WHERE u.n <= 23 AND (u.n + g.i) % 4 <> 0;

INSERT INTO study_sessions (chapter_id, user_id, geofence_id, status, start_time,
                            last_heartbeat_at, total_foreground_minutes, created_at)
SELECT :cid, id, 'c0ffee00-0000-4000-8000-5000000000d1', 'ACTIVE',
       now() - interval '52 minutes', now() - interval '30 seconds', 52, now() - interval '52 minutes'
FROM u WHERE n IN (6, 14, 20);

-- ── Documents ────────────────────────────────────────────────────────────────
INSERT INTO chapter_document_folders (chapter_id, name, sort_order) VALUES
 (:cid,'Meeting Minutes',1),(:cid,'Bylaws & Governance',2),(:cid,'Finance',3),
 (:cid,'Recruitment',4),(:cid,'Risk Management',5);

INSERT INTO chapter_documents (chapter_id, title, description, folder, storage_path, uploaded_by, created_at)
SELECT :cid, d.title, d.descr, d.folder,
       'demo/' || lower(regexp_replace(d.title,'[^a-zA-Z0-9]+','-','g')) || '.pdf',
       (SELECT id FROM u WHERE n = d.who), now() - (interval '1 day' * d.days)
FROM (VALUES
 ('Chapter Bylaws (Revised 2026)','Adopted at the spring business meeting.','Bylaws & Governance',1,120),
 ('Chapter Meeting Minutes — Week 9','Approved.','Meeting Minutes',4,5),
 ('Chapter Meeting Minutes — Week 8','Approved.','Meeting Minutes',4,12),
 ('Chapter Meeting Minutes — Week 7','Approved.','Meeting Minutes',4,19),
 ('Fall 2026 Operating Budget','Approved by exec and the house corporation.','Finance',2,60),
 ('Dues Payment Plan Policy','Installments, grace period, and late fee schedule.','Finance',2,58),
 ('Risk Management Policy','Social event guidelines and sober monitor rotation.','Risk Management',3,90),
 ('Event Registration Form (Blank)','Submit to the Office of Greek Life 14 days out.','Risk Management',3,88),
 ('Recruitment Handbook','Conversation guides, bid process, and timeline.','Recruitment',3,45),
 ('New Member Education Curriculum','Eight-week schedule with learning objectives.','Recruitment',3,44)
) AS d(title, descr, folder, who, days);

COMMIT;


-- ── Polls + backwork ─────────────────────────────────────────────────────────
BEGIN;
\set cid '''c0ffee00-0000-4000-8000-000000000001'''
DROP TABLE IF EXISTS u;
CREATE TEMP TABLE u AS
  SELECT us.id, us.display_name, right(us.id::text, 8)::int AS n
  FROM users us WHERE us.active_chapter_id = :cid;

-- A poll is a chat_message of type POLL; the question and options live in
-- `metadata`, and each ballot is a poll_votes row (see PollMetadata).
INSERT INTO chat_messages (id, channel_id, sender_id, content, type, metadata, created_at)
SELECT p.id::uuid, 'c0ffee00-0000-4000-8000-4000000000b2',
       (SELECT id FROM u WHERE n = p.who), p.question, 'POLL',
       jsonb_build_object(
         'question', p.question,
         'options', p.options::jsonb,
         'choice_mode', p.mode,
         -- Explicit UTC + literal Z. `to_char(..., 'OF')` emits "+00", which is
         -- not valid ISO 8601, and the dashboard renders an unparseable close
         -- date as "Closes —".
         'expires_at',
         to_char((now() + (p.expires_days * interval '1 day')) AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
       now() - (p.hours_ago * interval '1 hour')
FROM (VALUES
 ('c0ffee00-0000-4000-8000-6000000000a1', 1, 'Formal venue — which one?',
  '["Westfield Hotel — Grand Hall","The Riverhouse","Lakeside Country Club"]', 'single', 6, 30),
 ('c0ffee00-0000-4000-8000-6000000000a2', 3, 'Philanthropy 5K shirt color',
  '["Chapter navy","Heather grey","Gold"]', 'single', 3, 18),
 ('c0ffee00-0000-4000-8000-6000000000a3', 2, 'Which committees do you want to serve on next term?',
  '["Recruitment","Philanthropy","Risk","Alumni relations","Intramurals"]', 'multi', 10, 50)
) AS p(id, who, question, options, mode, expires_days, hours_ago);

-- Spread ballots deterministically so each poll shows a real distribution.
INSERT INTO poll_votes (message_id, user_id, option_index, created_at)
SELECT p.id::uuid, u.id, (u.n * p.spread) % p.opts, now() - interval '4 hours'
FROM u CROSS JOIN (VALUES
 ('c0ffee00-0000-4000-8000-6000000000a1', 4, 3),
 ('c0ffee00-0000-4000-8000-6000000000a2', 5, 3),
 ('c0ffee00-0000-4000-8000-6000000000a3', 7, 5)
) AS p(id, spread, opts)
WHERE u.n <= 23 AND (u.n + p.spread) % 5 <> 0
ON CONFLICT DO NOTHING;

INSERT INTO backwork_departments (id, chapter_id, code, name) VALUES
 ('c0ffee00-0000-4000-8000-70000000d001', :cid, 'MATH', 'Mathematics'),
 ('c0ffee00-0000-4000-8000-70000000d002', :cid, 'CHEM', 'Chemistry'),
 ('c0ffee00-0000-4000-8000-70000000d003', :cid, 'ECON', 'Economics'),
 ('c0ffee00-0000-4000-8000-70000000d004', :cid, 'MGMT', 'Management'),
 ('c0ffee00-0000-4000-8000-70000000d005', :cid, 'PHYS', 'Physics');

INSERT INTO backwork_professors (id, chapter_id, name) VALUES
 ('c0ffee00-0000-4000-8000-70000000f001', :cid, 'Dr. H. Lindgren'),
 ('c0ffee00-0000-4000-8000-70000000f002', :cid, 'Dr. P. Anand'),
 ('c0ffee00-0000-4000-8000-70000000f003', :cid, 'Prof. M. Calloway'),
 ('c0ffee00-0000-4000-8000-70000000f004', :cid, 'Dr. S. Underwood');

INSERT INTO backwork_resources (chapter_id, department_id, course_number, professor_id,
                                uploader_id, title, year, semester, assignment_type,
                                assignment_number, document_variant, storage_path,
                                file_hash, is_redacted, created_at)
SELECT :cid, b.dept::uuid, b.course, b.prof::uuid, (SELECT id FROM u WHERE n = b.who),
       b.title, b.yr, b.sem, b.atype, b.anum, b.variant,
       'demo/backwork/' || lower(regexp_replace(b.title,'[^a-zA-Z0-9]+','-','g')) || '.pdf',
       -- Dedup key in the real upload path; a stable digest of the demo title
       -- keeps the seed re-runnable without colliding across rows.
       encode(sha256(b.title::bytea), 'hex'),
       true, now() - (b.days * interval '1 day')
FROM (VALUES
 ('c0ffee00-0000-4000-8000-70000000d001','MATH 2010','c0ffee00-0000-4000-8000-70000000f001', 5,'Calculus II — Midterm 1',2025,'Fall','Midterm',1,'Student Copy',40),
 ('c0ffee00-0000-4000-8000-70000000d001','MATH 2010','c0ffee00-0000-4000-8000-70000000f001', 5,'Calculus II — Midterm 2',2025,'Fall','Midterm',2,'Answer Key',36),
 ('c0ffee00-0000-4000-8000-70000000d001','MATH 2010','c0ffee00-0000-4000-8000-70000000f001', 8,'Calculus II — Final',2025,'Fall','Final Exam',NULL,'Student Copy',30),
 ('c0ffee00-0000-4000-8000-70000000d002','CHEM 1100','c0ffee00-0000-4000-8000-70000000f002', 6,'General Chemistry — Exam 1',2026,'Spring','Exam',1,'Student Copy',28),
 ('c0ffee00-0000-4000-8000-70000000d002','CHEM 1100','c0ffee00-0000-4000-8000-70000000f002', 6,'General Chemistry — Lab Practical',2026,'Spring','Lab',3,'Blank Copy',24),
 ('c0ffee00-0000-4000-8000-70000000d003','ECON 2020','c0ffee00-0000-4000-8000-70000000f003',11,'Macroeconomics — Study Guide',2026,'Spring','Study Guide',NULL,'Student Copy',20),
 ('c0ffee00-0000-4000-8000-70000000d003','ECON 2020','c0ffee00-0000-4000-8000-70000000f003',11,'Macroeconomics — Midterm',2026,'Spring','Midterm',1,'Answer Key',19),
 ('c0ffee00-0000-4000-8000-70000000d004','MGMT 3300','c0ffee00-0000-4000-8000-70000000f004',13,'Organizational Behavior — Case Notes',2026,'Spring','Notes',NULL,'Student Copy',14),
 ('c0ffee00-0000-4000-8000-70000000d004','MGMT 3300','c0ffee00-0000-4000-8000-70000000f004', 2,'Organizational Behavior — Final',2025,'Fall','Final Exam',NULL,'Student Copy',12),
 ('c0ffee00-0000-4000-8000-70000000d005','PHYS 1500','c0ffee00-0000-4000-8000-70000000f001', 9,'Physics I — Problem Sets 1–6',2025,'Fall','Homework',NULL,'Answer Key',9),
 ('c0ffee00-0000-4000-8000-70000000d005','PHYS 1500','c0ffee00-0000-4000-8000-70000000f001', 9,'Physics I — Exam 2',2026,'Spring','Exam',2,'Student Copy',5)
) AS b(dept, course, prof, who, title, yr, sem, atype, anum, variant, days);

COMMIT;
