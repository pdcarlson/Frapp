-- chapter_documents metadata: mime type, size, document type, effective date.
--
-- `chapter_documents` has carried only id/chapter_id/title/description/folder/
-- storage_path/uploaded_by/created_at since the initial schema (#716). That is
-- too thin for the AI corpus retrieval design (ADR-13 §13): recency decay at
-- retrieval time needs a currency signal distinct from upload time, and the
-- prompt's provenance metadata needs more than a title.
--
-- Four columns, all nullable additive — existing rows get NULL, no backfill
-- possible or needed (the source values were never captured). Upload and
-- confirm-upload flows populate them going forward.
--
-- `document_type` is deliberately free text rather than a checked enum, unlike
-- `backwork_resources.assignment_type`: this table spans open-ended
-- organizational content (bylaws, budgets, minutes, forms, ...) and inventing
-- a fixed taxonomy is a product decision this migration does not make.
alter table chapter_documents
  add column content_type text,
  add column byte_size bigint,
  add column document_type text,
  -- Distinct from `created_at` (upload time). User-supplied where it matters
  -- (bylaws, policies) rather than inferred — an inferred date that's wrong
  -- is worse for recency decay than no date at all.
  add column effective_date date,
  add constraint chapter_documents_byte_size_nonneg
    check (byte_size is null or byte_size >= 0);
