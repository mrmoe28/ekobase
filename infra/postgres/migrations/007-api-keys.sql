-- 007-api-keys.sql
-- Project-scoped API keys for external app connections.

begin;

create table if not exists admin.api_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references admin.projects(id) on delete cascade,
  name text not null,
  key_hash text not null unique,
  scopes text[] not null default '{read,write}',
  last_used_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists api_keys_project_id_idx on admin.api_keys (project_id);

-- Prevent duplicate active names within a project (optional uniqueness, commented by default)
-- create unique index if not exists api_keys_project_name_uniq on admin.api_keys (project_id, name) where revoked = false;

grant usage on schema admin to service_role;
grant select, insert, update, delete on admin.api_keys to service_role;

commit;
