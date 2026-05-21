create schema if not exists admin;

create table if not exists admin.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  owner_id uuid references auth.users(id) on delete set null,
  region text not null default 'us-east-1',
  supabase_ref text unique,
  schema_name text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists admin.tenants (
  id uuid primary key,
  name text not null,
  owner_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists admin.project_members (
  project_id uuid not null references admin.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

alter table auth.users add column if not exists project_id uuid references admin.projects(id) on delete set null;
alter table auth.refresh_tokens add column if not exists project_id uuid references admin.projects(id) on delete set null;
alter table storage.buckets add column if not exists project_id uuid references admin.projects(id) on delete set null;
alter table storage.files add column if not exists project_id uuid references admin.projects(id) on delete set null;

grant usage on schema admin to service_role;
grant select, insert, update, delete on admin.projects to service_role;
grant select, insert, update, delete on admin.tenants to service_role;
grant select, insert, update, delete on admin.project_members to service_role;
