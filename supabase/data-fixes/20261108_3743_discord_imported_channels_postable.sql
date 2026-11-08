-- Data fix #3743: make the channels earlier Discord imports created postable.
--
-- Before #3697 the import wizard sent every new channel read-only, so every
-- chat_channels row an import created has is_read_only = true, and only an
-- `announcements:post` holder can post there. #3697 (PR #3750) fixed new
-- imports only. This repairs the channels already created, on frapp-prod.
--
-- The list was read from prod on 2026-11-08 (discord_import_created_channels
-- joined to chat_channels). Only two imports had created channels, both bot
-- imports of the same guild, 34 channels each, all read-only. Their scans
-- predate read_only_in_discord, so the stay-read-only call is by name:
-- `announcements-bro`, the one announcements-style channel, stays read-only in
-- both chapters and is not listed below. The other 33 per chapter flip.
-- Paul approved this list on 2026-11-08:
-- https://github.com/pdcarlson/Frapp/issues/3743#issuecomment-6727191930
--
-- Scope: an explicit list of channel ids. Each row must still match its
-- chapter, its name, and the import that created it, or it is skipped.
-- Idempotent: it only touches rows still read-only, so a re-run updates 0.
-- Expect 66 rows on the first run (33 per chapter) and 0 after that.
--
-- Hosted projects are changed only with the owner's approval. This file
-- records the statement that was applied; it is not a migration.

with fix (chapter_id, import_id, channel_id, channel_name) as (
  values
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '11b7dff7-4bc6-4240-82fa-da2f69b68c30'::uuid, 'academics'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '99be12ce-eaff-4bf3-92f7-7058847b932e'::uuid, 'anyone'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, 'eb8dd102-47f3-44ef-a4f1-95c764a7ca71'::uuid, 'bars'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '5550e626-5270-45af-b4c0-086e71124f45'::uuid, 'chapter-agenda'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '61a7bf0f-6384-46ab-ad1a-16439881a1f5'::uuid, 'chapter-minutes'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '68094153-8c78-409f-b7c0-8c15ed7bd591'::uuid, 'committee-info'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '9e91cdf0-1147-487f-aab2-2c7bc537ba6c'::uuid, 'corresponding-committee'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '0ad6bf43-536a-4132-b37a-51d976fb1960'::uuid, 'dinguses-only'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '5edd449a-cb65-4b59-b759-f0588c06702d'::uuid, 'everyone-at-rpi'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '776920cc-5122-4f89-b000-4cd149be8c7a'::uuid, 'fantasy-fiji'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '9a0736ed-a1c7-49bc-99f0-95242b77976e'::uuid, 'finance'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '21c745bd-6cb5-489f-8778-12c9addf08d4'::uuid, 'flicks'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '786010eb-3e32-4ed3-8baf-6a4abadb1384'::uuid, 'grad-relations-awards'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, 'ca3fbfe4-a767-4729-81f9-a6cd139dbc37'::uuid, 'grads-only'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '2d6f2f1f-bfa9-4daf-b16b-d90d2404bd66'::uuid, 'housing'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '9e18d879-e928-4bbc-8b92-f37e3a004896'::uuid, 'ifc'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, 'e70be5b8-750d-44eb-a9bb-ee478827f446'::uuid, 'links'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '66c83a39-b04d-480d-ae9c-7e9a55a3a6e9'::uuid, 'minecraft'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, 'c626c768-8fb1-4dba-a997-5a46c07266a8'::uuid, 'nm-edu'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, 'dad816b4-3c9a-4d91-be83-c2af44097fd3'::uuid, 'public-relations-and-web'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '7e0d247f-54ae-42d2-8d13-fbad077dee99'::uuid, 'quotes'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '2bf5decb-885c-40e8-b87c-c8e7e0e163bd'::uuid, 'recording-committee'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '0e50c630-a7bb-4f81-bd0b-81fa708caf39'::uuid, 'recruitment-committee'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, 'aec11047-7daa-4083-aae6-1e393058f86d'::uuid, 'risk'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '897d761f-1f38-4bc5-b103-2e50502e90c7'::uuid, 'scholarship'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '24d97c54-536c-4085-a510-1a88a9733dce'::uuid, 'senior-week'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '57f56f97-d63e-4b5c-ab95-703172258d0e'::uuid, 'sensitive'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, 'd7d54912-d9eb-4c8f-8847-f6500a3a1ae2'::uuid, 'stewardship'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '3d5850c1-c172-4114-b2fe-9acea899e94c'::uuid, 'stonks'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, '127322f6-4c46-494b-8a3b-e8a743b90b4a'::uuid, 'treasurer-committee'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, 'c49cb9de-f6fd-4716-a1f7-b2f9c15da1a7'::uuid, 'video-games'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, 'ad848d39-6545-4e80-a8b5-5a9d696c6b37'::uuid, 'wellness'),
  ('05321de3-aa3d-466c-94ff-790a9a7c7753'::uuid, 'b071647d-215b-4a8e-a2a5-39eece57547f'::uuid, 'b6854fc1-31ad-4def-b962-1864eb4a6ba9'::uuid, 'workparty'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '69d81710-99fd-4d96-a6a9-5c8a84c30357'::uuid, 'academics'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '30fd2b7e-dbee-4320-9a75-8a5482fa2c61'::uuid, 'anyone'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '1f6621cb-b5c5-48cf-846c-d43806d30e8b'::uuid, 'bars'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '4fbbdb27-e859-40da-9045-169364864de7'::uuid, 'chapter-agenda'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, 'cae0ef05-4c3d-4793-9eb0-d488072479fd'::uuid, 'chapter-minutes'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '8fdab473-7603-4171-970a-6143f5145832'::uuid, 'committee-info'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '6134b303-519e-439f-b5e8-b21138c93237'::uuid, 'corresponding-committee'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '08e1fbe9-6594-4e90-9add-4c8436424918'::uuid, 'dinguses-only'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '78effeda-801c-46ba-8f8d-2bc388c58b97'::uuid, 'everyone-at-rpi'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '4a895221-ed83-46a8-ab7e-496713f245f4'::uuid, 'fantasy-fiji'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '51ee0a35-5552-452c-9cdc-895fc5f03675'::uuid, 'finance'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '4dd4fdd7-1629-41d8-bf32-c2190a815c95'::uuid, 'flicks'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '68c354dc-19c1-43ea-a970-01cc07e987d3'::uuid, 'grad-relations-awards'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, 'ba7a6156-d8b5-4489-a048-9bfea1ecb02e'::uuid, 'grads-only'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '5d5b4187-48f2-471a-bd11-361d0875c5c8'::uuid, 'housing'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, 'febac995-3e87-46f2-8ab3-824bbe0d9852'::uuid, 'ifc'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '5391d7a7-5329-4f39-ba1c-a6a059300110'::uuid, 'links'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '3b637c4a-c552-4688-88dd-34cb11fc5c4f'::uuid, 'minecraft'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, 'cdab767f-1bcd-48fe-92eb-300266f464b3'::uuid, 'nm-edu'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '3e960eac-1f2a-46cf-9184-182bed6ee115'::uuid, 'public-relations-and-web'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '714f5264-f7ff-44f1-9c2d-8ff63a04eee5'::uuid, 'quotes'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, 'd0f9c1cf-95b6-42ce-9d73-83e3081ffc9f'::uuid, 'recording-committee'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '717ccdc3-9beb-4598-a490-1d5f5cb2b75d'::uuid, 'recruitment-committee'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '1fc1d23e-4021-43ba-b3f8-f4437f973952'::uuid, 'risk'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '0844bb6b-92ed-4133-b366-09ae90efc013'::uuid, 'scholarship'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, 'a595ef1f-0d3b-4ad8-bcd9-5f3cf9de371e'::uuid, 'senior-week'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '61633bb4-3f39-4c25-9a19-45da31a31036'::uuid, 'sensitive'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, 'a1257ef5-f2c8-4b5e-a4e9-678da2a34430'::uuid, 'stewardship'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '46a0d154-a52e-49cf-9f3b-43894b1b9f56'::uuid, 'stonks'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, 'bba67aa0-d634-4ed8-9525-4dae40df6da3'::uuid, 'treasurer-committee'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '92514d3f-d2b3-4206-b3e1-0d4a72c0e688'::uuid, 'video-games'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, 'd75fbb38-4007-4c18-86e4-194f0e29a156'::uuid, 'wellness'),
  ('37a00bcc-100f-4c6d-9d20-cee2396a43e5'::uuid, 'a231ab3a-79e3-48fa-88ca-4a985a9001e2'::uuid, '045dd7d7-882d-48d9-bcd4-7ee260002f69'::uuid, 'workparty')
)
update public.chat_channels c
set is_read_only = false
from fix
where c.id = fix.channel_id
  and c.chapter_id = fix.chapter_id
  and c.name = fix.channel_name
  and c.is_read_only = true
  and exists (
    select 1
    from public.discord_import_created_channels icc
    join public.discord_imports d on d.id = icc.import_id
    where icc.channel_id = c.id
      and icc.import_id = fix.import_id
      and d.chapter_id = fix.chapter_id
  )
returning c.chapter_id, c.id, c.name, c.is_read_only;
