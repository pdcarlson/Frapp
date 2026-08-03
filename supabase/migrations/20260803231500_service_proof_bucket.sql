-- Service-hour proof storage bucket (FRA-49).
--
-- spec/behavior/service-hours.md stores proof uploads under
-- chapters/{chapter_id}/service/... . Proof objects get their own private
-- bucket (matching the one-bucket-per-domain layout: chat, backwork,
-- branding, documents, profiles) so the API can mint signed upload/download
-- URLs against a chapter-scoped prefix. The bucket is private with no
-- storage RLS policies: every client interaction goes through API-issued
-- signed URLs, which do not consult RLS, and direct client access stays
-- denied by default.
insert into storage.buckets (id, name, public)
values ('service', 'service', false)
on conflict (id) do nothing;
