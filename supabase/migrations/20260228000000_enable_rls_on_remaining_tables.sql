-- Enable RLS on tables that were missed in the initial migration.
-- With RLS enabled and no permissive policies, only the service_role
-- key (used by the API) can access these tables. The anon key gets
-- zero rows back, which is the desired default-deny posture.

alter table users enable row level security;
alter table chapters enable row level security;
alter table push_tokens enable row level security;
alter table user_settings enable row level security;
